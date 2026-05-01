/*
 * Copyright (C) 2025  Koutaro Mukai
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as mupdf from "mupdf";

import { type Pallet } from "./diff.ts";
import { alignSize, createEmptyImage, type AlignStrategy } from "./image.ts";
import type { JimpInstance } from "./jimp.ts";
import { pageToImage } from "./pdf.ts";
import { perf, type Counters } from "./perf.ts";
import { type RGBAColor } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import createWasmModule, { type MainModule } from "./wasm/core.js";

export type InitMessage = {
  type: "init";
  aBytes: Uint8Array;
  bBytes: Uint8Array;
  maskBytes: Uint8Array | null;
  dpi: number;
  alpha: boolean;
  pallet: Pallet;
  align: AlignStrategy;
};

export type PageMessage = {
  type: "page";
  index: number;
};

export type LoadedMessage = {
  type: "loaded";
};

export type ReadyMessage = {
  type: "ready";
};

export type PageResultMessage = {
  type: "pageResult";
  index: number;
  a: { width: number; height: number; data: ArrayBuffer };
  b: { width: number; height: number; data: ArrayBuffer };
  diff: { width: number; height: number; data: ArrayBuffer };
  addition: ArrayBuffer;
  deletion: ArrayBuffer;
  modification: ArrayBuffer;
  perf?: Counters | undefined;
};

export type ErrorMessage = {
  type: "error";
  message: string;
};

type WasmProcessResult = {
  overlay: Uint8Array<ArrayBuffer>;
  addition: Int32Array<ArrayBuffer>;
  deletion: Int32Array<ArrayBuffer>;
  modification: Int32Array<ArrayBuffer>;
};

let pdfA: mupdf.Document;
let pdfB: mupdf.Document;
let pdfMask: mupdf.Document;
let opts: {
  dpi: number;
  alpha: boolean;
  pallet: Pallet;
  align: AlignStrategy;
};

let wasm: MainModule | null = null;
async function getWasm(): Promise<MainModule> {
  if (!wasm) wasm = await createWasmModule();
  return wasm;
}

function packColor([r, g, b, a]: RGBAColor): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

async function processPage(index: number): Promise<PageResultMessage> {
  const sLoad = perf.span("worker.pageToImageAll_ms");
  const [pageA, pageB, pageMaskOrNull] = (await Promise.all([
    index < pdfA.countPages()
      ? pageToImage(pdfA.loadPage(index), opts.dpi, opts.alpha)
      : createEmptyImage(1, 1),
    index < pdfB.countPages()
      ? pageToImage(pdfB.loadPage(index), opts.dpi, opts.alpha)
      : createEmptyImage(1, 1),
    index < pdfMask.countPages()
      ? pageToImage(pdfMask.loadPage(index), opts.dpi, opts.alpha)
      : Promise.resolve(null),
  ])) as [JimpInstance, JimpInstance, JimpInstance | null];
  sLoad.stop();

  const sAlign = perf.span("worker.alignSize_ms");
  let aAligned: JimpInstance;
  let bAligned: JimpInstance;
  let maskAligned: JimpInstance | null;
  if (pageMaskOrNull !== null) {
    [aAligned, bAligned, maskAligned] = alignSize(
      [pageA, pageB, pageMaskOrNull],
      opts.align,
    );
  } else {
    [aAligned, bAligned] = alignSize([pageA, pageB], opts.align);
    maskAligned = null;
  }
  sAlign.stop();

  const width = aAligned.width;
  const height = aAligned.height;
  const aData = aAligned.bitmap.data;
  const bData = bAligned.bitmap.data;
  const maskData = maskAligned !== null ? maskAligned.bitmap.data : null;

  const sProcess = perf.span("worker.processPage_ms");
  const wasmModule = await getWasm();
  const result = wasmModule.processPage(
    aData,
    bData,
    maskData,
    width,
    height,
    packColor(opts.pallet.addition),
    packColor(opts.pallet.deletion),
    packColor(opts.pallet.modification),
  ) as WasmProcessResult | number;
  if (typeof result === "number") {
    throw new Error(`wasm processPage failed: ${result}`);
  }
  sProcess.stop();

  const sXfer = perf.span("worker.toTransferable_ms");
  const aBuf = sliceBackingBuffer(aData);
  const bBuf = sliceBackingBuffer(bData);
  const dBuf = sliceBackingBuffer(result.overlay);
  const addBuf = sliceBackingBuffer(result.addition);
  const delBuf = sliceBackingBuffer(result.deletion);
  const modBuf = sliceBackingBuffer(result.modification);
  sXfer.stop();
  perf.incr("worker.pages");

  let pagePerf: Counters | undefined;
  if (perf.enabled) {
    pagePerf = perf.dump();
    perf.reset();
  }

  return {
    type: "pageResult",
    index,
    a: { width, height, data: aBuf },
    b: { width, height, data: bBuf },
    diff: { width, height, data: dBuf },
    addition: addBuf,
    deletion: delBuf,
    modification: modBuf,
    perf: pagePerf,
  };
}

self.addEventListener(
  "message",
  async (e: MessageEvent<InitMessage | PageMessage>) => {
    try {
      const msg = e.data;
      if (msg.type === "init") {
        pdfA = mupdf.PDFDocument.openDocument(msg.aBytes, "application/pdf");
        pdfB = mupdf.PDFDocument.openDocument(msg.bBytes, "application/pdf");
        pdfMask = msg.maskBytes
          ? mupdf.PDFDocument.openDocument(msg.maskBytes, "application/pdf")
          : new mupdf.PDFDocument();
        opts = {
          dpi: msg.dpi,
          alpha: msg.alpha,
          pallet: msg.pallet,
          align: msg.align,
        };
        if (pdfA.countPages() > 0) pdfA.loadPage(0).destroy();
        await getWasm();
        const ready: ReadyMessage = { type: "ready" };
        self.postMessage(ready);
      } else if (msg.type === "page") {
        const result = await processPage(msg.index);
        self.postMessage(result, [
          result.a.data,
          result.b.data,
          result.diff.data,
          result.addition,
          result.deletion,
          result.modification,
        ]);
      }
    } catch (err) {
      const errorMsg: ErrorMessage = {
        type: "error",
        message:
          err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
      };
      self.postMessage(errorMsg);
    }
  },
);

const loaded: LoadedMessage = { type: "loaded" };
self.postMessage(loaded);
