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
 * Render an inclusive range of (0-based) pages of a PDF to PNG bytes in a single
 * Ghostscript invocation, returning a map keyed by 0-based page index. Batching
 * several pages per call amortizes Ghostscript's startup and PDF parsing, which
 * dominate a single-page render. `alpha` selects the device: `pngalpha` keeps
 * the page background transparent (so the diff can tell "no content" from
 * "content" via the alpha channel), while `png16m` renders opaque. Decoding to
 * RGBA is left to the caller (the diff workers) so it can run off this thread.
 */
export async function renderPageRangePng(
  pdf: Uint8Array,
  firstIndex: number,
  lastIndex: number,
  dpi: number,
  alpha: boolean,
): Promise<Map<number, Uint8Array<ArrayBuffer>>> {
  const device = alpha ? "pngalpha" : "png16m";
  const first = firstIndex + 1; // Ghostscript page numbers are 1-based.
  const last = lastIndex + 1;

  // `%d` in the output pattern is the 1-based index of the page *within this
  // run* (it restarts at 1 regardless of -dFirstPage), so the k-th output maps
  // back to absolute page (first + k - 1).
  const pageCount = last - first + 1;
  const names: string[] = [];
  for (let k = 1; k <= pageCount; k++) names.push(`out-${k}.png`);

  const sRender = perf.span("pdf.gsRender_ms");
  const { exitCode, outputFiles } = await gs({
    args: [
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-dFirstPage=${first}`,
      `-dLastPage=${last}`,
      `-sDEVICE=${device}`,
      `-r${dpi}`,
      "-dTextAlphaBits=4",
      "-dGraphicsAlphaBits=4",
      "-sOutputFile=out-%d.png",
      INPUT_VM_PATH,
    ],
    inputFiles: { [INPUT_VM_PATH]: pdf },
    outputFilePaths: names,
  });
  sRender.stop();
  if (exitCode !== 0) {
    throw new Error(
      `gs render failed (pages ${first}-${last}, exit ${exitCode})`,
    );
  }
  const result = new Map<number, Uint8Array<ArrayBuffer>>();
  for (let k = 1; k <= pageCount; k++) {
    const png = outputFiles[`out-${k}.png`];
    if (!png) {
      throw new Error(`gs render produced no output (page ${first + k - 1})`);
    }
    result.set(firstIndex + (k - 1), png);
  }
  perf.incr("pdf.gsCalls");
  perf.incr("pdf.pagesRendered", pageCount);
  return result;
}
