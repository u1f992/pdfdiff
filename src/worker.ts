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
  const view =
    src instanceof Uint8Array || src instanceof Uint8ClampedArray
      ? src
      : Uint8Array.from(src as ArrayLike<number>);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

async function processPage(index: number): Promise<PageResultMessage> {
  const [pageA, pageB, pageMask] = (await Promise.all([
    index < pdfA.countPages()
      ? pageToImage(pdfA.loadPage(index), opts.dpi, opts.alpha)
      : createEmptyImage(1, 1),
    index < pdfB.countPages()
      ? pageToImage(pdfB.loadPage(index), opts.dpi, opts.alpha)
      : createEmptyImage(1, 1),
    index < pdfMask.countPages()
      ? pageToImage(pdfMask.loadPage(index), opts.dpi, opts.alpha)
      : createEmptyImage(1, 1),
  ])) as [JimpInstance, JimpInstance, JimpInstance];

  const {
    diff: diffLayer,
    addition,
    deletion,
    modification,
  } = drawDifference(pageA, pageB, pageMask, opts.pallet, opts.align);
  const diff = composeLayers(pageA.width, pageA.height, [
    [pageA, 0.2],
    [pageB, 0.2],
    [diffLayer, 1],
  ]);

  return {
    type: "pageResult",
    index,
    a: {
      width: pageA.width,
      height: pageA.height,
      data: toTransferable(pageA.bitmap.data),
    },
    b: {
      width: pageB.width,
      height: pageB.height,
      data: toTransferable(pageB.bitmap.data),
    },
    diff: {
      width: diff.width,
      height: diff.height,
      data: toTransferable(diff.bitmap.data),
    },
    addition,
    deletion,
    modification,
  };
}

self.addEventListener(
  "message",
  async (e: MessageEvent<InitMessage | PageMessage>) => {
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
  },
);
