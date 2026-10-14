import * as jimp from "jimp";
import { type JimpInstance } from "./jimp.ts";
import { perf } from "./perf.ts";

export function createEmptyImage(width: number, height: number) {
  return new jimp.Jimp({
    width,
    height,
    color: jimp.rgbaToInt(0, 0, 0, 0),
  }) as JimpInstance;
}

export function fillWithEmpty(
  images: [JimpInstance, JimpInstance] | [JimpInstance, null] | [null, JimpInstance],
): [JimpInstance, JimpInstance];
export function fillWithEmpty(
  images:
    | [JimpInstance, JimpInstance, JimpInstance]
    | [JimpInstance, JimpInstance, null]
    | [JimpInstance, null, JimpInstance]
    | [JimpInstance, null, null]
    | [null, JimpInstance, JimpInstance]
    | [null, JimpInstance, null]
    | [null, null, JimpInstance],
): [JimpInstance, JimpInstance, JimpInstance];
export function fillWithEmpty(images: (JimpInstance | null)[]): JimpInstance[] {
  return images.map((img) => (img !== null ? img : createEmptyImage(1, 1)));
}

function padTopLeft(img: JimpInstance, width: number, height: number): JimpInstance {
  const padded = createEmptyImage(width, height);
  padded.composite(img, 0, 0);
  return padded;
}

export function alignSize(images: [JimpInstance, JimpInstance]): [JimpInstance, JimpInstance];
export function alignSize(
  images: [JimpInstance, JimpInstance, JimpInstance],
): [JimpInstance, JimpInstance, JimpInstance];
export function alignSize(images: JimpInstance[]): JimpInstance[] {
  if (images.length === 0) {
    return [];
  }
  const largerWidth = Math.max(...images.map((img) => img.width));
  const largerHeight = Math.max(...images.map((img) => img.height));
  return images.map((img) =>
    img.width === largerWidth && img.height === largerHeight
      ? img
      : padTopLeft(img, largerWidth, largerHeight),
  );
}

export function composeLayers(
  canvasWidth: number,
  canvasHeight: number,
  layers: [JimpInstance, number][],
) {
  const _span = perf.span("image.compose_ms");
  const canvas = createEmptyImage(canvasWidth, canvasHeight);
  const dData = canvas.bitmap.data;
  for (const [image, opacity] of layers) {
    const sData = image.bitmap.data;
    const srcWidth = image.width;
    const w = Math.min(canvasWidth, srcWidth);
    const h = Math.min(canvasHeight, image.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dIdx = (y * canvasWidth + x) * 4;
        const sIdx = (y * srcWidth + x) * 4;
        const sa = (sData[sIdx + 3]! / 255) * opacity;
        if (sa === 0) continue;
        const da = dData[dIdx + 3]! / 255;
        const oa = sa + da * (1 - sa);
        if (oa === 0) continue;
        const sw = sa / oa;
        const dw = (da * (1 - sa)) / oa;
        dData[dIdx] = Math.round(sData[sIdx]! * sw + dData[dIdx]! * dw);
        dData[dIdx + 1] = Math.round(sData[sIdx + 1]! * sw + dData[dIdx + 1]! * dw);
        dData[dIdx + 2] = Math.round(sData[sIdx + 2]! * sw + dData[dIdx + 2]! * dw);
        dData[dIdx + 3] = Math.round(oa * 255);
      }
    }
  }
  _span.stop();
  return canvas;
}
