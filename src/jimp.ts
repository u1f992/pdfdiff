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
  getBuffer: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBuffer"]>;
  getBase64: (mime: "image/png") => ReturnType<jimp.JimpInstance["getBase64"]>;
};
