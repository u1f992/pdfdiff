#!/usr/bin/env node

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
} from "./index.ts";
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

function bitmapToTransferable(
  src: Buffer | Uint8Array | Uint8ClampedArray | number[],
): ArrayBuffer {
  if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
    return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
  }
  return Uint8Array.from(src as ArrayLike<number>).buffer;
}

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
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
});

if (help) {
  console.log(`USAGE:
    pdfdiff <A> <B> <OUTDIR> [OPTIONS]

OPTIONS:
    --dpi <DPI>                    default: ${defaultOptions.dpi}
    --alpha                        default: ${defaultOptions.alpha}
    --mask <PATH>                  default: ${defaultOptions.mask}
    --align <resize | top-left | top-center | top-right
             | middle-left | middle-center | middle-right
             | bottom-left | bottom-center | bottom-right>    default: ${defaultOptions.align}
    --addition-color <#HEX>        default: ${formatHex(defaultOptions.pallet.addition)}
    --deletion-color <#HEX>        default: ${formatHex(defaultOptions.pallet.deletion)}
    --modification-color <#HEX>    default: ${formatHex(defaultOptions.pallet.modification)}
    --workers <N>                  default: ${defaultOptions.workers}
    -v, --version
    -h, --help

NOTES:
    Approximate per-worker memory:
        a_size_MB + b_size_MB [+ mask_size_MB]    (PDF buffers in wasm)
        + 300 MB                                  (mupdf + V8 base)
        + (dpi / 150)^2 * 50 MB                   (pixmap working set)
    The main process adds ~500 MB - 1 GB (varies with --workers).
    Choose --workers so the total stays under ~80% of available memory.
`);
  process.exit(0);
}
if (version) {
  console.log(VERSION);
  process.exit(0);
}

if (positionals.length !== 3) {
  throw new Error("Expected 3 positional arguments: <A> <B> <OUTDIR>");
}

const pdfA = fs.readFileSync(path.resolve(positionals[0]!));
const pdfB = fs.readFileSync(path.resolve(positionals[1]!));
const outDir = path.resolve(positionals[2]!);

const dpi =
  typeof dpi_ !== "undefined" ? parseInt(dpi_, 10) : defaultOptions.dpi;
if (Number.isNaN(dpi)) {
  throw new Error("Invalid DPI value");
}

const alpha = alpha_ ?? defaultOptions.alpha;

const pdfMask =
  typeof mask_ !== "undefined"
    ? fs.readFileSync(path.resolve(mask_))
    : undefined;

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
if (
  additionColor === null ||
  deletionColor === null ||
  modificationColor === null
) {
  throw new Error("Invalid color format");
}

const workers =
  typeof workers_ !== "undefined"
    ? parseInt(workers_, 10)
    : defaultOptions.workers;
if (Number.isNaN(workers) || workers < 1) {
  throw new Error("Invalid workers value");
}

fs.mkdirSync(outDir, { recursive: true });
const writerPool = new PngWriterPool(
  workers,
  new URL("./cli-png-worker.js", import.meta.url),
);
const pendingWrites: Promise<void>[] = [];

const _loopSpan = perf.span("cli.loopWall_ms");
for await (const [
  i,
  { a, b, diff, addition, deletion, modification },
] of withIndex(
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
  const dir = path.join(outDir, i.toString(10));
  fs.mkdirSync(dir, { recursive: true });
  const sSubmit = perf.span("cli.poolSubmit_ms");
  const aBuf = bitmapToTransferable(a.bitmap.data);
  const bBuf = bitmapToTransferable(b.bitmap.data);
  const dBuf = bitmapToTransferable(diff.bitmap.data);
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
}
const sDrain = perf.span("cli.poolDrain_ms");
await Promise.all(pendingWrites);
sDrain.stop();
await writerPool.terminate();
_loopSpan.stop();
_wallSpan.stop();

if (perf.enabled) {
  const counters = perf.dump();
  process.stderr.write("\n=== PERF ===\n");
  const keys = Object.keys(counters).sort();
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = Math.round(counters[k]! * 1000) / 1000;
  process.stderr.write(JSON.stringify(out, null, 2) + "\n");
}
