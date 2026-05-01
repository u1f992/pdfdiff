import * as jimp from "jimp";

/**
 * Narrowed view of `jimp.JimpInstance` used throughout the project.
 *
 * Two constraints are tightened relative to the upstream type:
 *
 * 1. `bitmap.data` is asserted to be `Uint8Array<ArrayBuffer>` (never
 *    SAB-backed). jimp allocates pixels via `Buffer`, which is always
 *    backed by a real ArrayBuffer in practice. Pinning the generic
 *    parameter here lets `sliceBackingBuffer` (and `postMessage` transfer
 *    lists) infer ArrayBuffer instead of ArrayBufferLike.
 *
 * 2. `resize` and `composite` return `JimpInstance` (this narrowed type)
 *    rather than upstream `jimp.JimpInstance`, so chaining preserves the
 *    bitmap-backing constraint above.
 */
export type JimpInstance = Pick<
  jimp.JimpInstance,
  "width" | "height" | "getPixelColor" | "setPixelColor"
> & {
  bitmap: {
    data: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
  };
  resize: (options: Parameters<jimp.JimpInstance["resize"]>[0]) => JimpInstance;
  composite: (
    ...args: Parameters<jimp.JimpInstance["composite"]>
  ) => JimpInstance;
  getBuffer: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBuffer"]>;
  getBase64: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBase64"]>;
};
