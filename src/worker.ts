import { locateVersioned } from "./assets.ts";
import { decodePng } from "./decode.ts";
import { type Pallet } from "./diff.ts";
import { alignSize, createEmptyImage } from "./image.ts";
import type { JimpInstance } from "./jimp.ts";
import { PdfRenderer, type DocumentName } from "./pdf.ts";
import { perf, type Counters } from "./perf.ts";
import { type RGBAColor } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import createWasmModule, { type MainModule } from "./wasm/core.js";
import type { ErrorMessage } from "./worker-handle.ts";

export type InitMessage = {
  type: "init";
  pallet: Pallet;
  dpi: number;
  alpha: boolean;
  a: ArrayBufferLike;
  b: ArrayBufferLike;
  mask: ArrayBufferLike | null;
};

export type PageCounts = Record<DocumentName, number>;

export type PageMessage = {
  type: "page";
  index: number;
};

export type ReadyMessage = {
  type: "ready";
  pages: PageCounts;
};

export type PageResultMessage = {
  type: "pageResult";
  index: number;
  a: { width: number; height: number; data: ArrayBuffer };
  b: { width: number; height: number; data: ArrayBuffer };
  diff: { width: number; height: number; data: ArrayBuffer };
  addition: ArrayBuffer;
  deletion: ArrayBuffer;
  modification: ArrayBuffer;
  perf?: Counters | undefined;
};

type WasmProcessResult = {
  overlay: Uint8Array<ArrayBuffer>;
  addition: Int32Array<ArrayBuffer>;
  deletion: Int32Array<ArrayBuffer>;
  modification: Int32Array<ArrayBuffer>;
};

let opts: {
  pallet: Pallet;
  renderer: PdfRenderer;
  pages: PageCounts;
};

let wasm: MainModule | null = null;
async function getWasm(): Promise<MainModule> {
  if (!wasm) wasm = await createWasmModule({ locateFile: locateVersioned });
  return wasm;
}

function packColor([r, g, b, a]: RGBAColor): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

async function init(msg: InitMessage): Promise<ReadyMessage> {
  const documents: Partial<Record<DocumentName, Uint8Array>> = {
    a: new Uint8Array(msg.a),
    b: new Uint8Array(msg.b),
  };
  if (msg.mask !== null) documents.mask = new Uint8Array(msg.mask);
  const [renderer] = await Promise.all([
    PdfRenderer.create(documents, msg.dpi, msg.alpha),
    getWasm(),
  ]);
  const pages: PageCounts = {
    a: await renderer.countPages("a"),
    b: await renderer.countPages("b"),
    mask: msg.mask !== null ? await renderer.countPages("mask") : 0,
  };
  opts = { pallet: msg.pallet, renderer, pages };
  return { type: "ready", pages };
}

async function renderOrNull(name: DocumentName, index: number): Promise<JimpInstance | null> {
  if (index >= opts.pages[name]) return null;
  const png = await opts.renderer.renderPage(name, index);
  const sDecode = perf.span("worker.decode_ms");
  const image = await decodePng(png.buffer);
  sDecode.stop();
  return image;
}

async function processPage(msg: PageMessage): Promise<PageResultMessage> {
  const index = msg.index;
  const sRender = perf.span("worker.renderAll_ms");
  const pageA = (await renderOrNull("a", index)) ?? createEmptyImage(1, 1);
  const pageB = (await renderOrNull("b", index)) ?? createEmptyImage(1, 1);
  const pageMaskOrNull = await renderOrNull("mask", index);
  sRender.stop();

  const sAlign = perf.span("worker.alignSize_ms");
  let aAligned: JimpInstance;
  let bAligned: JimpInstance;
  let maskAligned: JimpInstance | null;
  if (pageMaskOrNull !== null) {
    [aAligned, bAligned, maskAligned] = alignSize([pageA, pageB, pageMaskOrNull]);
  } else {
    [aAligned, bAligned] = alignSize([pageA, pageB]);
    maskAligned = null;
  }
  sAlign.stop();

  const width = aAligned.width;
  const height = aAligned.height;
  const aData = aAligned.bitmap.data;
  const bData = bAligned.bitmap.data;
  const maskData = maskAligned !== null ? maskAligned.bitmap.data : null;

  const sProcess = perf.span("worker.processPage_ms");
  const wasmModule = await getWasm();
  const result = wasmModule.processPage(
    aData,
    bData,
    maskData,
    width,
    height,
    packColor(opts.pallet.addition),
    packColor(opts.pallet.deletion),
    packColor(opts.pallet.modification),
  ) as WasmProcessResult | number;
  if (typeof result === "number") {
    throw new Error(`wasm processPage failed: ${result}`);
  }
  sProcess.stop();

  const sXfer = perf.span("worker.toTransferable_ms");
  const aBuf = sliceBackingBuffer(aData);
  const bBuf = sliceBackingBuffer(bData);
  const dBuf = sliceBackingBuffer(result.overlay);
  const addBuf = sliceBackingBuffer(result.addition);
  const delBuf = sliceBackingBuffer(result.deletion);
  const modBuf = sliceBackingBuffer(result.modification);
  sXfer.stop();
  perf.incr("worker.pages");

  let pagePerf: Counters | undefined;
  if (perf.enabled) {
    pagePerf = perf.dump();
    perf.reset();
  }

  return {
    type: "pageResult",
    index,
    a: { width, height, data: aBuf },
    b: { width, height, data: bBuf },
    diff: { width, height, data: dBuf },
    addition: addBuf,
    deletion: delBuf,
    modification: modBuf,
    perf: pagePerf,
  };
}

self.addEventListener("message", async (e: MessageEvent<InitMessage | PageMessage>) => {
  try {
    const msg = e.data;
    if (msg.type === "init") {
      self.postMessage(await init(msg));
    } else if (msg.type === "page") {
      const result = await processPage(msg);
      self.postMessage(result, [
        result.a.data,
        result.b.data,
        result.diff.data,
        result.addition,
        result.deletion,
        result.modification,
      ]);
    }
  } catch (err) {
    const errorMsg: ErrorMessage = {
      type: "error",
      message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    };
    self.postMessage(errorMsg);
  }
});
