import * as jimp from "jimp";

import { type Pallet } from "./diff.ts";
import { withIndex } from "./iterable.ts";
import {
  PdfBuilder,
  renderDiffPage,
  renderSideBySidePage,
  type Bitmap,
  type DiffCounts,
  type PageNumber,
  type PdfwriteJob,
} from "./pdfwrite.ts";
import { perf } from "./perf.ts";
import { parseHex, formatHex } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import { VERSION } from "./version.ts";
import type { JimpInstance } from "./jimp.ts";
import { WorkerHandle, workerUrl } from "./worker-handle.ts";
import type { InitMessage, PageMessage, PageResultMessage, ReadyMessage } from "./worker.ts";

export {
  withIndex,
  parseHex,
  formatHex,
  perf,
  VERSION,
  PdfBuilder,
  renderDiffPage,
  renderSideBySidePage,
  type Bitmap,
  type DiffCounts,
  type PageNumber,
  type Pallet,
  type PdfwriteJob,
};

type Options = {
  dpi: number;
  alpha: boolean;
  mask: Uint8Array | undefined;
  pallet: Pallet;
  workers: number;
};

type Result = {
  a: JimpInstance;
  b: JimpInstance;
  diff: JimpInstance;
  addition: [number, number][];
  deletion: [number, number][];
  modification: [number, number][];
  pageCount: number;
};

// Default parallelism scales with the machine: rendering and diffing run across
// several workers, so the out-of-the-box run uses the CPU rather than a single
// core. The cap bounds memory rather than CPU: each worker keeps a Ghostscript
// (about 120 MB) plus its own copies of the input PDFs and the page in flight,
// and the PDF output types add a second pool of as many pdfwrite workers.
// Beyond the physical cores, extra workers slow each other down more than they
// add, so large machines gain little from a higher value; pass --workers to
// choose it from the memory budget.
export const defaultWorkersCap = 8;
export const defaultWorkers = Math.min(navigator.hardwareConcurrency, defaultWorkersCap);

export const defaultOptions: Options = {
  dpi: 72,
  alpha: true,
  mask: undefined,
  pallet: {
    addition: [0x4c, 0xae, 0x4f, 0xff],
    deletion: [0xff, 0x57, 0x24, 0xff],
    modification: [0xff, 0xc1, 0x05, 0xff],
  },
  workers: defaultWorkers,
};

type DiffWorker = WorkerHandle<InitMessage | PageMessage, ReadyMessage | PageResultMessage>;

function unpackCoords(buf: ArrayBuffer): [number, number][] {
  const arr = new Int32Array(buf);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    out.push([arr[i]!, arr[i + 1]!]);
  }
  return out;
}

function pageResultToResult(msg: PageResultMessage, pageCount: number): Result {
  const sP = perf.span("main.pageResultToResult_ms");
  const r = {
    a: jimp.Jimp.fromBitmap({
      width: msg.a.width,
      height: msg.a.height,
      data: new Uint8Array(msg.a.data),
    }) as JimpInstance,
    b: jimp.Jimp.fromBitmap({
      width: msg.b.width,
      height: msg.b.height,
      data: new Uint8Array(msg.b.data),
    }) as JimpInstance,
    diff: jimp.Jimp.fromBitmap({
      width: msg.diff.width,
      height: msg.diff.height,
      data: new Uint8Array(msg.diff.data),
    }) as JimpInstance,
    addition: unpackCoords(msg.addition),
    deletion: unpackCoords(msg.deletion),
    modification: unpackCoords(msg.modification),
    pageCount,
  };
  sP.stop();
  perf.incr("main.resultsReceived");
  if (msg.perf) perf.merge(msg.perf);
  return r;
}

export async function* visualizeDifferences(
  a: Uint8Array,
  b: Uint8Array,
  options: Partial<Omit<Options, "pallet"> & { pallet: Partial<Pallet> }>,
) {
  const merged = {
    dpi: options?.dpi ?? defaultOptions.dpi,
    alpha: options?.alpha ?? defaultOptions.alpha,
    mask: options?.mask ?? defaultOptions.mask,
    pallet: {
      addition: options?.pallet?.addition ?? defaultOptions.pallet.addition,
      deletion: options?.pallet?.deletion ?? defaultOptions.pallet.deletion,
      modification: options?.pallet?.modification ?? defaultOptions.pallet.modification,
    },
    workers: options?.workers ?? defaultOptions.workers,
  };

  const initMsg: InitMessage = {
    type: "init",
    pallet: merged.pallet,
    dpi: merged.dpi,
    alpha: merged.alpha,
    a: sliceBackingBuffer(a),
    b: sliceBackingBuffer(b),
    mask: typeof merged.mask !== "undefined" ? sliceBackingBuffer(merged.mask) : null,
  };

  const url = workerUrl("worker");
  const spawned: DiffWorker[] = Array.from(
    { length: Math.max(1, merged.workers) },
    () => new WorkerHandle(url),
  );
  try {
    const sInit = perf.span("main.workersInit_ms");
    const readies = await Promise.all(spawned.map((w) => w.request<ReadyMessage>(initMsg)));
    sInit.stop();
    const pages = readies[0]!.pages;
    const maxPages = Math.max(pages.a, pages.b, pages.mask);
    if (maxPages === 0) return;

    const workers = spawned.slice(0, maxPages);
    for (const w of spawned.slice(maxPages)) w.terminate();

    yield* diffPages(workers, maxPages);
  } finally {
    for (const w of spawned) w.terminate();
  }
}

async function* diffPages(workers: DiffWorker[], maxPages: number) {
  const buffered = new Map<number, Result>();
  let nextToAssign = 0;
  const resolvers = new Map<number, (r: Result) => void>();
  let workerError: unknown = null;

  const diffLoops = workers.map(async (w) => {
    while (nextToAssign < maxPages && workerError === null) {
      const idx = nextToAssign++;
      try {
        const pageMsg: PageMessage = { type: "page", index: idx };
        const msg = await w.request<PageResultMessage>(pageMsg);
        const result = pageResultToResult(msg, maxPages);
        const resolve = resolvers.get(idx);
        if (resolve) {
          resolvers.delete(idx);
          resolve(result);
        } else {
          buffered.set(idx, result);
          perf.setMax("main.bufferedPeak", buffered.size);
        }
      } catch (e) {
        workerError = e;
        for (const [, resolve] of resolvers) resolve(null as never);
        resolvers.clear();
        return;
      }
    }
  });

  for (let i = 0; i < maxPages; i++) {
    if (workerError !== null) throw workerError;
    let r: Result;
    const buf = buffered.get(i);
    if (buf !== undefined) {
      buffered.delete(i);
      r = buf;
    } else {
      const sWait = perf.span("main.yieldWaitMain_ms");
      r = await new Promise<Result>((resolve) => resolvers.set(i, resolve));
      sWait.stop();
      if (workerError !== null) throw workerError;
    }
    const sYield = perf.span("main.consumerTime_ms");
    yield r;
    sYield.stop();
  }
  await Promise.all(diffLoops);
}
