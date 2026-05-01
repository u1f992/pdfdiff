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
  isValidAlignStrategy,
  type AlignStrategy,
} from "./image.ts";
import { withIndex } from "./iterable.ts";
import { pageToImage } from "./pdf.ts";
import { parseHex, formatHex } from "./rgba-color.ts";
import type { JimpInstance } from "./jimp.ts";

export { withIndex, isValidAlignStrategy, parseHex, formatHex };

type Options = {
  dpi: number;
  alpha: boolean;
  mask: Uint8Array | undefined;
  align: AlignStrategy;
  pallet: Pallet;
};

type Result = {
  a: JimpInstance;
  b: JimpInstance;
  diff: JimpInstance;
  addition: [number, number][];
  deletion: [number, number][];
  modification: [number, number][];
};

export const defaultOptions: Options = {
  dpi: 150,
  alpha: true,
  mask: undefined,
  align: "resize",
  pallet: {
    addition: [0x4c, 0xae, 0x4f, 0xff],
    deletion: [0xff, 0x57, 0x24, 0xff],
    modification: [0xff, 0xc1, 0x05, 0xff],
  },
};

export async function* visualizeDifferences(
  a: Uint8Array,
  b: Uint8Array,
  options: Partial<Omit<Options, "pallet"> & { pallet: Partial<Pallet> }>,
) {
  const mergedOptions = {
    dpi: options?.dpi ?? defaultOptions.dpi,
    alpha: options?.alpha ?? defaultOptions.alpha,
    mask: options?.mask ?? defaultOptions.mask,
    align: options?.align ?? defaultOptions.align,
    pallet: {
      addition: options?.pallet?.addition ?? defaultOptions.pallet.addition,
      deletion: options?.pallet?.deletion ?? defaultOptions.pallet.deletion,
      modification:
        options?.pallet?.modification ?? defaultOptions.pallet.modification,
    },
  };

  const pdfA = mupdf.PDFDocument.openDocument(a, "application/pdf");
  const pdfB = mupdf.PDFDocument.openDocument(b, "application/pdf");
  const pdfMask =
    typeof mergedOptions.mask !== "undefined"
      ? mupdf.PDFDocument.openDocument(mergedOptions.mask, "application/pdf")
      : new mupdf.PDFDocument();

  const maxPages = Math.max(
    pdfA.countPages(),
    pdfB.countPages(),
    pdfMask.countPages(),
  );

  async function processPage(pageIndex: number) {
    const [pageA, pageB, pageMask] = await Promise.all([
      pageIndex < pdfA.countPages()
        ? pageToImage(
            pdfA.loadPage(pageIndex),
            mergedOptions.dpi,
            mergedOptions.alpha,
          )
        : createEmptyImage(1, 1),
      pageIndex < pdfB.countPages()
        ? pageToImage(
            pdfB.loadPage(pageIndex),
            mergedOptions.dpi,
            mergedOptions.alpha,
          )
        : createEmptyImage(1, 1),
      pageIndex < pdfMask.countPages()
        ? pageToImage(
            pdfMask.loadPage(pageIndex),
            mergedOptions.dpi,
            mergedOptions.alpha,
          )
        : createEmptyImage(1, 1),
    ]);

    const {
      diff: diffLayer,
      addition,
      deletion,
      modification,
    } = drawDifference(
      pageA,
      pageB,
      pageMask,
      mergedOptions.pallet,
      mergedOptions.align,
    );
    const diff = composeLayers(pageA.width, pageA.height, [
      [pageA, 0.2],
      [pageB, 0.2],
      [diffLayer, 1],
    ]);
    return { a: pageA, b: pageB, diff, addition, deletion, modification };
  }

  try {
    for (let i = 0; i < maxPages; i++) {
      yield (await processPage(i)) as Result;
    }
  } finally {
    pdfA.destroy();
    pdfB.destroy();
    pdfMask.destroy();
  }
}
