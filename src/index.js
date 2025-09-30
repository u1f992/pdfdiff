// @ts-check

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

import * as jimp from "jimp";
/** @typedef {jimp.JimpInstance} JimpInstance */
import * as mupdf from "mupdf";
import Worker from "web-worker";

/** @typedef {import("./diff.js").Pallet} Pallet */
import { createEmptyImage, isValidAlignStrategy } from "./image.js";
/** @typedef {import("./image.js").AlignStrategy} AlignStrategy */
import { withIndex } from "./iterable.js";
import { pageToImage } from "./pdf.js";
import { parseHex, formatHex } from "./rgba-color.js";
/** @typedef {import("./rgba-color.js").RGBAColor} RGBAColor */

export { withIndex, isValidAlignStrategy, parseHex, formatHex };

/**
 * @typedef {{ dpi: number; alpha: boolean; mask?: Uint8Array; align: AlignStrategy; pallet: Partial<Readonly<Pallet>> }} VisualizeDifferencesOptions
 * @satisfies {Readonly<VisualizeDifferencesOptions>}
 */
export const defaultOptions = Object.freeze({
  dpi: 150,
  alpha: true,
  mask: undefined,
  align: "resize",
  pallet: Object.freeze({
    addition: Object.freeze(
      /** @type {RGBAColor} */ ([0x4c, 0xae, 0x4f, 0xff]),
    ),
    deletion: Object.freeze(
      /** @type {RGBAColor} */ ([0xff, 0x57, 0x24, 0xff]),
    ),
    modification: Object.freeze(
      /** @type {RGBAColor} */ ([0xff, 0xc1, 0x05, 0xff]),
    ),
  }),
});

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @param {Partial<VisualizeDifferencesOptions>} [options]
 * @typedef {{ a: JimpInstance, b: JimpInstance, diff: JimpInstance, addition: [number, number][], deletion: [number, number][], modification: [number, number][] }} VisualizeDifferencesResult
 * @returns {AsyncIterable<VisualizeDifferencesResult>}
 */
export async function* visualizeDifferences(a, b, options) {
  /** @satisfies {VisualizeDifferencesOptions} */
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

  /**
   * @param {number} pageIndex
   * @returns {Promise<VisualizeDifferencesResult>}
   */
  async function processPage(pageIndex) {
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

    // NOTE: getBufferはcopyなので、Workerに移譲した後もa, bを使用して問題ない
    // https://github.com/jimp-dev/jimp/blob/b6b0e418a5f1259211a133b20cddb4f4e5c25679/packages/core/src/index.ts#L444
    const [bufA, bufB, bufMask] = await Promise.all([
      pageA
        .getBuffer(jimp.JimpMime.png)
        .then((buf) => new Uint8Array(buf).buffer),
      pageB
        .getBuffer(jimp.JimpMime.png)
        .then((buf) => new Uint8Array(buf).buffer),
      pageMask
        .getBuffer(jimp.JimpMime.png)
        .then((buf) => new Uint8Array(buf).buffer),
    ]);

    const { bufDiff, addition, deletion, modification } =
      await /** @type {Promise<{ bufDiff: ArrayBuffer } & Pick<VisualizeDifferencesResult, "addition" | "deletion" | "modification">>} */ (
        new Promise((resolve) => {
          const url = new URL("./worker.js", import.meta.url);
          const worker = new Worker(url, { type: "module" });
          worker.addEventListener("message", (e) => {
            resolve(e.data);
            worker.terminate();
          });
          worker.postMessage(
            {
              bufA,
              bufB,
              bufMask,
              pallet: mergedOptions.pallet,
              align: mergedOptions.align,
            },
            [bufA, bufB, bufMask],
          );
        })
      );
    const diff = await jimp.Jimp.fromBuffer(bufDiff);
    return { a: pageA, b: pageB, diff, addition, deletion, modification };
  }

  // ページ処理を並列発行し、順序を保証して出力
  const concurrency = navigator.hardwareConcurrency;
  const pending = /** @type {Promise<VisualizeDifferencesResult>[]} */ ([]);
  let nextPageToProcess = 0;
  let nextPageToYield = 0;

  while (nextPageToYield < maxPages) {
    // プールに空きがあれば新しいページ処理を追加
    while (nextPageToProcess < maxPages && pending.length < concurrency) {
      pending.push(processPage(nextPageToProcess));
      nextPageToProcess++;
    }

    // 次に出力すべきページのPromiseを待つ
    const result = await pending[0];
    pending.shift();
    yield result;
    nextPageToYield++;
  }
}
