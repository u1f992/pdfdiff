import { decodePng } from "./decode.ts";
import { type Pallet } from "./diff.ts";
import { alignSize, createEmptyImage, type AlignStrategy } from "./image.ts";
import type { JimpInstance } from "./jimp.ts";
import { perf, type Counters } from "./perf.ts";
import { type RGBAColor } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import createWasmModule, { type MainModule } from "./wasm/core.js";

export type InitMessage = {
  type: "init";
  pallet: Pallet;
  align: AlignStrategy;
};

export type PageMessage = {
  type: "page";
  index: number;
  // PNG bytes rendered on the main thread, or null when the source PDF has no
  // such page (the diff then treats it as an empty/transparent page).
  a: ArrayBuffer | null;
  b: ArrayBuffer | null;
  mask: ArrayBuffer | null;
};

export type LoadedMessage = {
  type: "loaded";
};

export type ReadyMessage = {
  type: "ready";
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

export type ErrorMessage = {
  type: "error";
  message: string;
};

type WasmProcessResult = {
  overlay: Uint8Array<ArrayBuffer>;
  addition: Int32Array<ArrayBuffer>;
  deletion: Int32Array<ArrayBuffer>;
  modification: Int32Array<ArrayBuffer>;
};

let opts: {
  pallet: Pallet;
  align: AlignStrategy;
};

let wasm: MainModule | null = null;
async function getWasm(): Promise<MainModule> {
  if (!wasm) wasm = await createWasmModule();
  return wasm;
}

function packColor([r, g, b, a]: RGBAColor): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

async function processPage(msg: PageMessage): Promise<PageResultMessage> {
  const index = msg.index;
  const sLoad = perf.span("worker.decodeAll_ms");
  const [pageA, pageB, pageMaskOrNull] = (await Promise.all([
    msg.a !== null ? decodePng(msg.a) : createEmptyImage(1, 1),
    msg.b !== null ? decodePng(msg.b) : createEmptyImage(1, 1),
    msg.mask !== null ? decodePng(msg.mask) : Promise.resolve(null),
  ])) as [JimpInstance, JimpInstance, JimpInstance | null];
  sLoad.stop();

  const sAlign = perf.span("worker.alignSize_ms");
  let aAligned: JimpInstance;
  let bAligned: JimpInstance;
  let maskAligned: JimpInstance | null;
  if (pageMaskOrNull !== null) {
    [aAligned, bAligned, maskAligned] = alignSize(
      [pageA, pageB, pageMaskOrNull],
      opts.align,
    );
  } else {
    [aAligned, bAligned] = alignSize([pageA, pageB], opts.align);
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

self.addEventListener(
  "message",
  async (e: MessageEvent<InitMessage | PageMessage>) => {
    try {
      const msg = e.data;
      if (msg.type === "init") {
        opts = {
          pallet: msg.pallet,
          align: msg.align,
        };
        await getWasm();
        const ready: ReadyMessage = { type: "ready" };
        self.postMessage(ready);
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
        message:
          err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
      };
      self.postMessage(errorMsg);
    }
  },
);

const loaded: LoadedMessage = { type: "loaded" };
self.postMessage(loaded);
