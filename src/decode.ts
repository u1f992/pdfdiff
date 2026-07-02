import * as jimp from "jimp";

import type { JimpInstance } from "./jimp.ts";

/**
 * Decode PNG bytes (as produced by {@link renderPageRangePng}) into an RGBA
 * image.
 * `jimp.fromBuffer` accepts an ArrayBuffer directly, which keeps this usable in
 * the browser without relying on Node's `Buffer`.
 */
export async function decodePng(png: ArrayBuffer): Promise<JimpInstance> {
  return (await jimp.Jimp.fromBuffer(png)) as JimpInstance;
}
