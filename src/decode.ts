import decode, { init } from "@jsquash/png/decode.js";
import * as jimp from "jimp";

import type { JimpInstance } from "./jimp.ts";

const WASM_SPECIFIER = "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";

const isNode = typeof process === "object" && process.release?.name === "node";

async function loadCodec(): Promise<void> {
  if (isNode) {
    const [{ readFileSync }, { fileURLToPath }] = await Promise.all([
      import("node:fs"),
      import("node:url"),
    ]);
    await init(readFileSync(fileURLToPath(import.meta.resolve(WASM_SPECIFIER))));
  } else {
    await init();
  }
}

let codec: Promise<void> | null = null;

export async function decodePng(png: ArrayBuffer): Promise<JimpInstance> {
  if (!codec) codec = loadCodec();
  await codec;
  return jimp.Jimp.fromBitmap(await decode(png)) as JimpInstance;
}
