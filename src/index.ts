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
import * as mupdf from "mupdf";
import Worker from "web-worker";

import { type Pallet } from "./diff.ts";
import { isValidAlignStrategy, type AlignStrategy } from "./image.ts";
import { withIndex } from "./iterable.ts";
import { parseHex, formatHex } from "./rgba-color.ts";
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

export { withIndex, isValidAlignStrategy, parseHex, formatHex };

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
  workers: 1,
};

function asSharedBytes(bytes: Uint8Array): Uint8Array {
  const isNode =
    typeof globalThis.process !== "undefined" &&
    !!globalThis.process.versions?.node;
  const coiOk =
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ===
    true;
  if (typeof SharedArrayBuffer !== "undefined" && (isNode || coiOk)) {
    const sab = new SharedArrayBuffer(bytes.byteLength);
    const view = new Uint8Array(sab);
    view.set(bytes);
    return view;
  }
  return new Uint8Array(bytes);
}

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

  processPage(index: number): Promise<PageResultMessage> {
    return new Promise<PageResultMessage>((resolve, reject) => {
      this.pendingResolve = resolve as (data: WorkerResponse) => void;
      this.pendingReject = reject;
      const msg: PageMessage = { type: "page", index };
      this.worker.postMessage(msg);
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

function pageResultToResult(msg: PageResultMessage): Result {
  return {
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
    addition: msg.addition,
    deletion: msg.deletion,
    modification: msg.modification,
  };
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

  const probe = mupdf.PDFDocument.openDocument(a, "application/pdf");
  const probeB = mupdf.PDFDocument.openDocument(b, "application/pdf");
  const probeMask =
    typeof merged.mask !== "undefined"
      ? mupdf.PDFDocument.openDocument(merged.mask, "application/pdf")
      : new mupdf.PDFDocument();
  const maxPages = Math.max(
    probe.countPages(),
    probeB.countPages(),
    probeMask.countPages(),
  );
  probe.destroy();
  probeB.destroy();
  probeMask.destroy();

  if (maxPages === 0) return;

  const aBytes = asSharedBytes(a);
  const bBytes = asSharedBytes(b);
  const maskBytes =
    typeof merged.mask !== "undefined" ? asSharedBytes(merged.mask) : null;

  const initMsg: InitMessage = {
    type: "init",
    aBytes,
    bBytes,
    maskBytes,
    dpi: merged.dpi,
    alpha: merged.alpha,
    pallet: merged.pallet,
    align: merged.align,
  };

  const N = Math.max(1, Math.min(merged.workers, maxPages));
  const url = workerUrl();
  const worker0 = new WorkerHandle(url);
  await worker0.init(initMsg);

  const buffered = new Map<number, Result>();
  let nextToAssign = 0;

  const workers: WorkerHandle[] = [worker0];
  for (let i = 1; i < N; i++) {
    const w = new WorkerHandle(url);
    await w.init(initMsg);
    workers.push(w);
  }

  const resolvers = new Map<number, (r: Result) => void>();
  let workerError: unknown = null;

  const loops = workers.map(async (w) => {
    while (nextToAssign < maxPages && workerError === null) {
      const idx = nextToAssign++;
      try {
        const msg = await w.processPage(idx);
        const result = pageResultToResult(msg);
        const resolve = resolvers.get(idx);
        if (resolve) {
          resolvers.delete(idx);
          resolve(result);
        } else {
          buffered.set(idx, result);
        }
      } catch (e) {
        workerError = e;
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
        r = await new Promise<Result>((resolve) => resolvers.set(i, resolve));
        if (workerError !== null) throw workerError;
      }
      yield r;
    }
    await Promise.all(loops);
  } finally {
    for (const w of workers) w.terminate();
  }
}
