import decode, { init } from "@jsquash/png/decode.js";
import * as jimp from "jimp";

import { assetQuery } from "./assets.ts";
import type { JimpInstance } from "./jimp.ts";

const WASM_FILE = "squoosh_png_bg.wasm";
const WASM_SPECIFIER = `@jsquash/png/codec/pkg/${WASM_FILE}`;

const isNode = typeof process === "object" && process.release?.name === "node";

async function loadCodec(): Promise<void> {
  if (isNode) {
    const [{ readFileSync }, { fileURLToPath }] = await Promise.all([
      import("node:fs"),
      import("node:url"),
    ]);
    await init(readFileSync(fileURLToPath(import.meta.resolve(WASM_SPECIFIER))));
  } else {
    const query = assetQuery(WASM_FILE);
    await init(query === "" ? undefined : new URL(`./${WASM_FILE}${query}`, import.meta.url));
  }
}

let codec: Promise<void> | null = null;

export async function decodePng(png: ArrayBuffer): Promise<JimpInstance> {
  if (!codec) codec = loadCodec();
  await codec;
  return jimp.Jimp.fromBitmap(await decode(png)) as JimpInstance;
}
