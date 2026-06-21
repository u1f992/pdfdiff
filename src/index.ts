import * as jimp from "jimp";
import Worker from "web-worker";

import { type Pallet } from "./diff.ts";
import { isValidAlignStrategy, type AlignStrategy } from "./image.ts";
import { withIndex } from "./iterable.ts";
import { countPages, renderPageRangePng } from "./pdf.ts";
import { perf } from "./perf.ts";
import { parseHex, formatHex } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import { VERSION } from "./version.ts";
import type { JimpInstance } from "./jimp.ts";
import type {
  ErrorMessage,
  InitMessage,
  LoadedMessage,
  PageMessage,
  PageResultMessage,
  ReadyMessage,
} from "./worker.ts";

export { withIndex, isValidAlignStrategy, parseHex, formatHex, perf };

type Options = {
  dpi: number;
  alpha: boolean;
  mask: Uint8Array | undefined;
  align: AlignStrategy;
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
};

// Default parallelism scales with the machine: rendering and diffing run across
// several workers, so the out-of-the-box run uses the CPU rather than a single
// core. Capped at 4 to keep the default memory footprint and oversubscription
// modest; raise --workers explicitly for large jobs on big machines.
export const defaultWorkers = Math.max(
  1,
  Math.min(globalThis.navigator?.hardwareConcurrency ?? 1, 4),
);

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
  workers: defaultWorkers,
};

type WorkerResponse =
  | LoadedMessage
  | ReadyMessage
  | PageResultMessage
  | ErrorMessage;

class WorkerHandle {
  worker: InstanceType<typeof Worker>;
  private loaded: Promise<void>;
  private pendingResolve: ((data: WorkerResponse) => void) | null = null;
  private pendingReject: ((reason: unknown) => void) | null = null;

  constructor(url: URL) {
    this.worker = new Worker(url, { type: "module" });
    this.loaded = new Promise<void>((resolveLoaded, rejectLoaded) => {
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        const data = e.data;
        if (data.type === "loaded") {
          resolveLoaded();
          return;
        }
        const resolve = this.pendingResolve;
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        if (data.type === "error") {
          reject?.(new Error(`worker: ${data.message}`));
        } else {
          resolve?.(data);
        }
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", (e: ErrorEvent) => {
        const err = e.error ?? new Error(e.message);
        rejectLoaded(err);
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject?.(err);
      });
    });
  }

  async init(msg: InitMessage): Promise<ReadyMessage> {
    await this.loaded;
    return new Promise<ReadyMessage>((resolve, reject) => {
      this.pendingResolve = resolve as (data: WorkerResponse) => void;
      this.pendingReject = reject;
      this.worker.postMessage(msg);
    });
  }

  processDiff(
    index: number,
    a: Uint8Array<ArrayBuffer> | null,
    b: Uint8Array<ArrayBuffer> | null,
    mask: Uint8Array<ArrayBuffer> | null,
  ): Promise<PageResultMessage> {
    return new Promise<PageResultMessage>((resolve, reject) => {
      this.pendingResolve = resolve as (data: WorkerResponse) => void;
      this.pendingReject = reject;
      const aBuf = a !== null ? sliceBackingBuffer(a) : null;
      const bBuf = b !== null ? sliceBackingBuffer(b) : null;
      const maskBuf = mask !== null ? sliceBackingBuffer(mask) : null;
      const msg: PageMessage = {
        type: "page",
        index,
        a: aBuf,
        b: bBuf,
        mask: maskBuf,
      };
      const transfer = [aBuf, bBuf, maskBuf].filter(
        (buf): buf is ArrayBuffer => buf !== null,
      );
      this.worker.postMessage(msg, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}

function workerUrl(): URL {
  const file = import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js";
  return new URL(`${file}?v=${encodeURIComponent(VERSION)}`, import.meta.url);
}

function unpackCoords(buf: ArrayBuffer): [number, number][] {
  const arr = new Int32Array(buf);
  const out: [number, number][] = new Array(arr.length >>> 1);
  for (let i = 0, j = 0; j < out.length; i += 2, j++) {
    out[j] = [arr[i]!, arr[i + 1]!];
  }
  return out;
}

function pageResultToResult(msg: PageResultMessage): Result {
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
    align: options?.align ?? defaultOptions.align,
    pallet: {
      addition: options?.pallet?.addition ?? defaultOptions.pallet.addition,
      deletion: options?.pallet?.deletion ?? defaultOptions.pallet.deletion,
      modification:
        options?.pallet?.modification ?? defaultOptions.pallet.modification,
    },
    workers: options?.workers ?? defaultOptions.workers,
  };

  const [aPages, bPages, maskPages] = await Promise.all([
    countPages(a),
    countPages(b),
    typeof merged.mask !== "undefined"
      ? countPages(merged.mask)
      : Promise.resolve(0),
  ]);
  const maxPages = Math.max(aPages, bPages, maskPages);

  if (maxPages === 0) return;

  const mask = merged.mask;
  const hasMask = typeof mask !== "undefined" && maskPages > 0;
  const numDocs = hasMask ? 3 : 2;

  const initMsg: InitMessage = {
    type: "init",
    pallet: merged.pallet,
    align: merged.align,
  };

  const N = Math.max(1, Math.min(merged.workers, maxPages));
  const url = workerUrl();
  const workers: WorkerHandle[] = [];
  for (let i = 0; i < N; i++) {
    const w = new WorkerHandle(url);
    await w.init(initMsg);
    workers.push(w);
  }

  let aborted: unknown = null;

  // One PNG slot per page per document, fulfilled as render chunks complete.
  // Pages past a document's page count resolve to null (an empty/transparent
  // page). The defensive catch keeps a chunk failure from surfacing as an
  // unhandled rejection before a diff lane awaits the slot.
  type Slot = {
    p: Promise<Uint8Array<ArrayBuffer> | null>;
    resolve: (v: Uint8Array<ArrayBuffer> | null) => void;
    reject: (e: unknown) => void;
  };
  const makeSlots = (count: number): Slot[] =>
    Array.from({ length: maxPages }, (_, i) => {
      if (i >= count) {
        return { p: Promise.resolve(null), resolve: () => {}, reject: () => {} };
      }
      let resolve!: (v: Uint8Array<ArrayBuffer> | null) => void;
      let reject!: (e: unknown) => void;
      const p = new Promise<Uint8Array<ArrayBuffer> | null>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      p.catch(() => {});
      return { p, resolve, reject };
    });
  const slots = {
    a: makeSlots(aPages),
    b: makeSlots(bPages),
    mask: makeSlots(hasMask ? maskPages : 0),
  };

  // Render chunk tasks: batch several pages per gs() call to amortize startup,
  // interleaving A/B/mask by page range so the early pages of every document
  // become available together (which keeps the diff stage fed).
  // Render concurrency. Aim for ~2x as many chunks as render slots so pages
  // arrive in waves and the diff/decode stage overlaps later renders instead of
  // waiting for one big batch. A floor keeps each chunk large enough to amortize
  // Ghostscript's per-call startup: when there are many slots relative to pages,
  // the slots are already saturated, so batching beats finer streaming.
  const MIN_CHUNK = 4;
  const R = Math.max(merged.workers, numDocs);
  const totalRenderPages = aPages + bPages + (hasMask ? maskPages : 0);
  const chunkSize = Math.max(
    1,
    Math.min(maxPages, Math.max(MIN_CHUNK, Math.ceil(totalRenderPages / (2 * R)))),
  );
  type Task = { bytes: Uint8Array; start: number; end: number; slots: Slot[] };
  const tasks: Task[] = [];
  const pushChunk = (
    bytes: Uint8Array | undefined,
    count: number,
    target: Slot[],
    start: number,
  ) => {
    if (bytes === undefined || start >= count) return;
    tasks.push({
      bytes,
      start,
      end: Math.min(start + chunkSize, count) - 1,
      slots: target,
    });
  };
  for (let start = 0; start < maxPages; start += chunkSize) {
    pushChunk(a, aPages, slots.a, start);
    pushChunk(b, bPages, slots.b, start);
    if (hasMask) pushChunk(mask, maskPages, slots.mask, start);
  }

  let taskIdx = 0;
  const renderLoops = Array.from(
    { length: Math.min(R, tasks.length) },
    async () => {
      while (taskIdx < tasks.length && aborted === null) {
        const t = tasks[taskIdx++]!;
        try {
          const pngs = await renderPageRangePng(
            t.bytes,
            t.start,
            t.end,
            merged.dpi,
            merged.alpha,
          );
          for (let i = t.start; i <= t.end; i++) {
            t.slots[i]!.resolve(pngs.get(i) ?? null);
          }
        } catch (e) {
          aborted = e;
          for (let i = t.start; i <= t.end; i++) t.slots[i]!.reject(e);
        }
      }
    },
  );

  const buffered = new Map<number, Result>();
  let nextToAssign = 0;
  const resolvers = new Map<number, (r: Result) => void>();
  let workerError: unknown = null;

  const diffLoops = workers.map(async (w) => {
    while (nextToAssign < maxPages && workerError === null) {
      const idx = nextToAssign++;
      try {
        const [aPng, bPng, maskPng] = await Promise.all([
          slots.a[idx]!.p,
          slots.b[idx]!.p,
          slots.mask[idx]!.p,
        ]);
        const msg = await w.processDiff(idx, aPng, bPng, maskPng);
        const result = pageResultToResult(msg);
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
        aborted = e;
        for (const [, resolve] of resolvers) resolve(null as never);
        resolvers.clear();
        return;
      }
    }
  });

  try {
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
    await Promise.all(renderLoops);
  } finally {
    aborted = aborted ?? new Error("aborted");
    await Promise.allSettled(renderLoops);
    for (const w of workers) w.terminate();
  }
}
