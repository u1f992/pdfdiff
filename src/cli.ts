#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { Worker as ThreadWorker } from "node:worker_threads";

import type { EncodeJob, EncodeReply } from "./cli-png-worker.ts";
import {
  isValidAlignStrategy,
  defaultOptions,
  withIndex,
  parseHex,
  formatHex,
  visualizeDifferences,
  perf,
  PdfBuilder,
  renderDiffPage,
  renderSideBySidePage,
} from "./index.ts";
import type { JimpInstance } from "./jimp.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import { VERSION } from "./version.ts";

class PngWriterPool {
  private readonly workers: ThreadWorker[] = [];
  private readonly idle: ThreadWorker[] = [];
  private readonly waiting: Array<(w: ThreadWorker) => void> = [];

  constructor(size: number, scriptUrl: URL) {
    for (let i = 0; i < size; i++) {
      const w = new ThreadWorker(scriptUrl);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  private acquire(): Promise<ThreadWorker> {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    return new Promise<ThreadWorker>((resolve) => this.waiting.push(resolve));
  }

  private release(w: ThreadWorker) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  async submit(job: EncodeJob): Promise<void> {
    const w = await this.acquire();
    return new Promise<void>((resolve, reject) => {
      const onMessage = (msg: EncodeReply) => {
        w.off("message", onMessage);
        w.off("error", onError);
        this.release(w);
        if (msg.ok) resolve();
        else reject(new Error(msg.error));
      };
      const onError = (err: Error) => {
        w.off("message", onMessage);
        w.off("error", onError);
        this.release(w);
        reject(err);
      };
      w.on("message", onMessage);
      w.once("error", onError);
      w.postMessage(job, [job.data]);
    });
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

type Page = { index: number; a: JimpInstance; b: JimpInstance; diff: JimpInstance };

type Output = {
  write(page: Page): Promise<void>;
  close(): Promise<void>;
};

function directoryOutput(outDir: string, workers: number): Output {
  fs.mkdirSync(outDir, { recursive: true });
  const writerPool = new PngWriterPool(workers, new URL("./cli-png-worker.js", import.meta.url));
  const pendingWrites: Promise<void>[] = [];
  return {
    write({ index, a, b, diff }) {
      const dir = path.join(outDir, index.toString(10));
      fs.mkdirSync(dir, { recursive: true });
      const sSubmit = perf.span("cli.poolSubmit_ms");
      const aBuf = sliceBackingBuffer(a.bitmap.data);
      const bBuf = sliceBackingBuffer(b.bitmap.data);
      const dBuf = sliceBackingBuffer(diff.bitmap.data);
      pendingWrites.push(
        writerPool.submit({
          width: a.width,
          height: a.height,
          data: aBuf,
          path: path.join(dir, "a.png"),
        }),
        writerPool.submit({
          width: b.width,
          height: b.height,
          data: bBuf,
          path: path.join(dir, "b.png"),
        }),
        writerPool.submit({
          width: diff.width,
          height: diff.height,
          data: dBuf,
          path: path.join(dir, "diff.png"),
        }),
      );
      sSubmit.stop();
      return Promise.resolve();
    },
    async close() {
      const sDrain = perf.span("cli.poolDrain_ms");
      await Promise.all(pendingWrites);
      sDrain.stop();
      await writerPool.terminate();
    },
  };
}

function pdfOutput(
  outPath: string,
  concurrency: number,
  render: (page: Page) => Promise<Uint8Array<ArrayBuffer>>,
): Output {
  const builder = new PdfBuilder(concurrency);
  return {
    write(page) {
      return builder.add(() => render(page));
    },
    async close() {
      const pdf = await builder.finish();
      if (pdf === null) {
        return;
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, pdf);
    },
  };
}

const outTypes = ["directory", "diff-pdf", "a-b-diff-pdf"] as const;
type OutType = (typeof outTypes)[number];
const isOutType = (str: string): str is OutType => (outTypes as readonly string[]).includes(str);

// Errors always exit 2, following diff(1)'s 0/1/2 convention, so that with
// --exit-code a caller can tell "differences found" (1) from a failed run.
process.on("uncaughtException", (err) => {
  console.error(err);
  process.exit(2);
});
process.on("unhandledRejection", (err) => {
  console.error(err);
  process.exit(2);
});

const _wallSpan = perf.span("cli.wallTotal_ms");

const {
  positionals,
  values: {
    dpi: dpi_,
    alpha: alpha_,
    mask: mask_,
    align: align_,
    "addition-color": additionColorHex,
    "deletion-color": deletionColorHex,
    "modification-color": modificationColorHex,
    workers: workers_,
    "out-type": outType_,
    "exit-code": exitCode_,
    "diff-only": diffOnly_,
    version,
    help,
  },
} = util.parseArgs({
  allowPositionals: true,
  options: {
    dpi: { type: "string" },
    alpha: { type: "boolean" },
    mask: { type: "string" },
    align: { type: "string" },
    "addition-color": { type: "string" },
    "deletion-color": { type: "string" },
    "modification-color": { type: "string" },
    workers: { type: "string" },
    "out-type": { type: "string" },
    "exit-code": { type: "boolean" },
    "diff-only": { type: "boolean" },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
});

if (help) {
  console.log(`USAGE:
    pdfdiff <A> <B> <OUT> [OPTIONS]

OPTIONS:
    --dpi <DPI>                    default: ${defaultOptions.dpi}
    --alpha                        default: ${defaultOptions.alpha}
    --mask <PATH>                  default: ${String(defaultOptions.mask)}
    --align <resize | top-left | top-center | top-right
             | middle-left | middle-center | middle-right
             | bottom-left | bottom-center | bottom-right>    default: ${defaultOptions.align}
    --addition-color <#HEX>        default: ${formatHex(defaultOptions.pallet.addition)}
    --deletion-color <#HEX>        default: ${formatHex(defaultOptions.pallet.deletion)}
    --modification-color <#HEX>    default: ${formatHex(defaultOptions.pallet.modification)}
    --workers <N>                  default: ${defaultOptions.workers}
    --out-type <directory | diff-pdf | a-b-diff-pdf>    default: directory
             directory       <OUT>/<page>/{a,b,diff}.png
             diff-pdf        <OUT> is a PDF of the diff images
             a-b-diff-pdf    <OUT> is a PDF of A, B and the diff side by side
                             (a PDF is written only when a page is output)
    --exit-code                    exit 1 if differences are found
    --diff-only                    output only pages with differences
    -v, --version
    -h, --help

EXIT STATUS:
    0    success (with --exit-code: no differences found)
    1    differences found (only with --exit-code)
    2    error

NOTES:
    Pages are rendered with Ghostscript (gs-wasm). Each page render spins up a
    transient Ghostscript instance (~26 MB WASM binary plus a rasterization
    working set that grows with --dpi). A and B (and the mask) render
    concurrently, and --workers controls how many pages are rendered and diffed
    in parallel, so peak memory scales with both --workers and --dpi. Each
    in-flight page additionally holds decoded RGBA bitmaps of ~width*height*4
    bytes. --workers defaults to the CPU core count (capped at 4); lower it to
    reduce memory, or raise it for large jobs on big machines. Keep the total
    under ~80% of available memory.
`);
  process.exit(0);
}
if (version) {
  console.log(VERSION);
  process.exit(0);
}

if (positionals.length !== 3) {
  throw new Error("Expected 3 positional arguments: <A> <B> <OUT>");
}

const pdfA = fs.readFileSync(path.resolve(positionals[0]!));
const pdfB = fs.readFileSync(path.resolve(positionals[1]!));
const outPath = path.resolve(positionals[2]!);

const dpi = typeof dpi_ !== "undefined" ? parseInt(dpi_, 10) : defaultOptions.dpi;
if (Number.isNaN(dpi)) {
  throw new Error("Invalid DPI value");
}

const alpha = alpha_ ?? defaultOptions.alpha;

const pdfMask = typeof mask_ !== "undefined" ? fs.readFileSync(path.resolve(mask_)) : undefined;

const align = align_ ?? defaultOptions.align;
if (!isValidAlignStrategy(align)) {
  throw new Error(`Invalid alignment strategy`);
}

const additionColor =
  typeof additionColorHex !== "undefined"
    ? parseHex(additionColorHex)
    : defaultOptions.pallet.addition;
const deletionColor =
  typeof deletionColorHex !== "undefined"
    ? parseHex(deletionColorHex)
    : defaultOptions.pallet.deletion;
const modificationColor =
  typeof modificationColorHex !== "undefined"
    ? parseHex(modificationColorHex)
    : defaultOptions.pallet.modification;
if (additionColor === null || deletionColor === null || modificationColor === null) {
  throw new Error("Invalid color format");
}

const workers = typeof workers_ !== "undefined" ? parseInt(workers_, 10) : defaultOptions.workers;
if (Number.isNaN(workers) || workers < 1) {
  throw new Error("Invalid workers value");
}

const outType = outType_ ?? "directory";
if (!isOutType(outType)) {
  throw new Error("Invalid output type");
}

const exitCodeOnDiff = exitCode_ ?? false;
const diffOnly = diffOnly_ ?? false;

const output =
  outType === "directory"
    ? directoryOutput(outPath, workers)
    : pdfOutput(
        outPath,
        workers,
        outType === "diff-pdf"
          ? ({ diff }) => renderDiffPage(diff.bitmap, dpi)
          : ({ a, b, diff }) => renderSideBySidePage([a.bitmap, b.bitmap, diff.bitmap], dpi),
      );
let hasDiff = false;

const _loopSpan = perf.span("cli.loopWall_ms");
for await (const [i, { a, b, diff, addition, deletion, modification }] of withIndex(
  visualizeDifferences(pdfA, pdfB, {
    dpi,
    alpha,
    mask: pdfMask,
    align,
    pallet: {
      addition: additionColor,
      deletion: deletionColor,
      modification: modificationColor,
    },
    workers,
  }),
  1,
)) {
  console.log(
    `Page ${i}, Addition: ${addition.length}, Deletion: ${deletion.length}, Modification: ${modification.length}`,
  );
  const pageHasDiff = addition.length > 0 || deletion.length > 0 || modification.length > 0;
  if (pageHasDiff) {
    hasDiff = true;
  }
  if (diffOnly && !pageHasDiff) {
    continue;
  }
  await output.write({ index: i, a, b, diff });
}
await output.close();
_loopSpan.stop();
_wallSpan.stop();

if (exitCodeOnDiff && hasDiff) {
  process.exitCode = 1;
}

if (perf.enabled) {
  const counters = perf.dump();
  process.stderr.write("\n=== PERF ===\n");
  const keys = Object.keys(counters).sort();
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = Math.round(counters[k]! * 1000) / 1000;
  process.stderr.write(JSON.stringify(out, null, 2) + "\n");
}
