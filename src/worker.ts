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

import { drawDifference, type Pallet } from "./diff.ts";
import {
  composeLayers,
  createEmptyImage,
  type AlignStrategy,
} from "./image.ts";
import type { JimpInstance } from "./jimp.ts";
import { pageToImage } from "./pdf.ts";
import { perf, type Counters } from "./perf.ts";

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
  addition: [number, number][];
  deletion: [number, number][];
  modification: [number, number][];
  perf?: Counters | undefined;
};

export type ErrorMessage = {
  type: "error";
  message: string;
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

function toTransferable(
  src: Buffer | Uint8Array | Uint8ClampedArray | number[],
): ArrayBuffer {
  if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
    return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
  }
  return Uint8Array.from(src as ArrayLike<number>).buffer;
}

async function processPage(index: number): Promise<PageResultMessage> {
  const sLoad = perf.span("worker.pageToImageAll_ms");
  const [pageA, pageB, pageMask] = (await Promise.all([
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

  const sDiff = perf.span("worker.drawDifference_ms");
  const {
    diff: diffLayer,
    addition,
    deletion,
    modification,
    hasDiff,
  } = drawDifference(pageA, pageB, pageMask, opts.pallet, opts.align);
  sDiff.stop();

  const sCompose = perf.span("worker.composeLayers_ms");
  const layers: [JimpInstance, number][] = [
    [pageA, 0.2],
    [pageB, 0.2],
  ];
  if (hasDiff) layers.push([diffLayer, 1]);
  const diff = composeLayers(pageA.width, pageA.height, layers);
  sCompose.stop();

  const sXfer = perf.span("worker.toTransferable_ms");
  const aBuf = toTransferable(pageA.bitmap.data);
  const bBuf = toTransferable(pageB.bitmap.data);
  const dBuf = toTransferable(diff.bitmap.data);
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
    a: { width: pageA.width, height: pageA.height, data: aBuf },
    b: { width: pageB.width, height: pageB.height, data: bBuf },
    diff: { width: diff.width, height: diff.height, data: dBuf },
    addition,
    deletion,
    modification,
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
        const ready: ReadyMessage = { type: "ready" };
        self.postMessage(ready);
      } else if (msg.type === "page") {
        const result = await processPage(msg.index);
        self.postMessage(result, [
          result.a.data,
          result.b.data,
          result.diff.data,
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
