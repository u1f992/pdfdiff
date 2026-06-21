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

import { gs } from "@u1f992/gs-wasm";

import { perf } from "./perf.ts";

/*
 * Pages are rendered with Ghostscript (gs-wasm). Each gs() invocation spins up
 * its own worker and Ghostscript instance, so we render one page per call and
 * let the caller drive concurrency (e.g. by rendering A/B/mask together and by
 * running multiple page workers).
 *
 * Ghostscript (via the `web-worker` package) must be invoked from a context
 * that can itself spawn a worker. In Node's `web-worker` this is only the main
 * thread, so rendering happens on the main thread and the resulting PNG bytes
 * are handed off to the diff workers for decoding. The PDF is placed in
 * Ghostscript's in-memory FS as `input.pdf` and the page is read back as a PNG.
 */
const INPUT_VM_PATH = "input.pdf";
const OUTPUT_VM_PATH = "out.png";

/**
 * Count the pages of a PDF using Ghostscript's `pdfpagecount`. Runs with
 * `-dNODISPLAY` (no rendering) so it is cheap relative to a page render.
 */
export async function countPages(pdf: Uint8Array): Promise<number> {
  const span = perf.span("pdf.countPages_ms");
  const out: number[] = [];
  const { exitCode } = await gs({
    args: [
      "-q",
      "-dNODISPLAY",
      "-dNOSAFER",
      "-c",
      `(${INPUT_VM_PATH}) (r) file runpdfbegin pdfpagecount = quit`,
    ],
    inputFiles: { [INPUT_VM_PATH]: pdf },
    onStdout: (charCode) => {
      if (charCode !== null) out.push(charCode);
    },
  });
  span.stop();
  if (exitCode !== 0) {
    throw new Error(`gs countPages failed (exit ${exitCode})`);
  }
  const text = String.fromCharCode(...out).trim();
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`gs countPages: unexpected output ${JSON.stringify(text)}`);
  }
  return n;
}

/**
 * Render a single (0-based) page of a PDF to PNG bytes. `alpha` selects the
 * Ghostscript device: `pngalpha` keeps the page background transparent (so the
 * diff can tell "no content" from "content" via the alpha channel), while
 * `png16m` renders opaque. Decoding to RGBA is left to the caller (the diff
 * workers) so it can be parallelized off this thread.
 */
export async function renderPagePng(
  pdf: Uint8Array,
  index: number,
  dpi: number,
  alpha: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const device = alpha ? "pngalpha" : "png16m";
  const page = index + 1; // Ghostscript page numbers are 1-based.

  const sRender = perf.span("pdf.gsRender_ms");
  const { exitCode, outputFiles } = await gs({
    args: [
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-dFirstPage=${page}`,
      `-dLastPage=${page}`,
      `-sDEVICE=${device}`,
      `-r${dpi}`,
      "-dTextAlphaBits=4",
      "-dGraphicsAlphaBits=4",
      `-sOutputFile=${OUTPUT_VM_PATH}`,
      INPUT_VM_PATH,
    ],
    inputFiles: { [INPUT_VM_PATH]: pdf },
    outputFilePaths: [OUTPUT_VM_PATH],
  });
  sRender.stop();
  if (exitCode !== 0) {
    throw new Error(`gs render failed (page ${page}, exit ${exitCode})`);
  }
  const png = outputFiles[OUTPUT_VM_PATH];
  if (!png) {
    throw new Error(`gs render produced no output (page ${page})`);
  }
  return png;
}
