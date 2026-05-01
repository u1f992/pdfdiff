import * as jimp from "jimp";

export type JimpInstance = Pick<
  jimp.JimpInstance,
  | "width"
  | "height"
  | "getPixelColor"
  | "setPixelColor"
  | "resize"
  | "composite"
> & {
  /**
   * Override jimp's `bitmap.data` to assert that the underlying buffer is
   * an ArrayBuffer (not a SharedArrayBuffer). jimp allocates with `Buffer`
   * which is always backed by an ArrayBuffer in practice; pinning the
   * generic parameter here lets `sliceBackingBuffer` (and `postMessage`
   * transfer lists) infer ArrayBuffer instead of ArrayBufferLike.
   */
  bitmap: {
    data: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
  };
  getBuffer: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBuffer"]>;
  getBase64: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBase64"]>;
};
