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
import { type JimpInstance } from "./jimp.js";

export function createEmptyImage(width: number, height: number) {
  return new jimp.Jimp({
    width,
    height,
    color: jimp.rgbaToInt(0, 0, 0, 0),
  }) as JimpInstance;
}

export function fillWithEmpty(
  images:
    | [JimpInstance, JimpInstance]
    | [JimpInstance, null]
    | [null, JimpInstance],
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

const alignStrategyValues = new Set([
  "resize",
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const);
type UnwrapSet<T> = T extends Set<infer U> ? U : never;
export type AlignStrategy = UnwrapSet<typeof alignStrategyValues>;
export const isValidAlignStrategy = (str: string): str is AlignStrategy =>
  (alignStrategyValues as Set<string>).has(str);

function alignImage(
  img: JimpInstance,
  targetWidth: number,
  targetHeight: number,
  align: AlignStrategy,
) {
  if (align === "resize") {
    return img.resize({ w: targetWidth, h: targetHeight });
  } else {
    const newImg = createEmptyImage(targetWidth, targetHeight);
    const x = align.includes("center")
      ? Math.floor((targetWidth - img.width) / 2)
      : align.includes("right")
        ? targetWidth - img.width
        : 0;
    const y = align.includes("middle")
      ? Math.floor((targetHeight - img.height) / 2)
      : align.includes("bottom")
        ? targetHeight - img.height
        : 0;
    newImg.composite(img, x, y);
    return newImg;
  }
}

export function alignSize(
  images: [JimpInstance, JimpInstance],
  align: AlignStrategy,
): [JimpInstance, JimpInstance];
export function alignSize(
  images: [JimpInstance, JimpInstance, JimpInstance],
  align: AlignStrategy,
): [JimpInstance, JimpInstance, JimpInstance];
export function alignSize(
  images: JimpInstance[],
  align: AlignStrategy,
): JimpInstance[] {
  if (images.length === 0) {
    return [];
  }
  const largerWidth = Math.max(...images.map((img) => img.width));
  const largerHeight = Math.max(...images.map((img) => img.height));
  return images.map((img) =>
    img.width === largerWidth && img.height === largerHeight
      ? img
      : alignImage(img, largerWidth, largerHeight, align),
  );
}

export function composeLayers(
  canvasWidth: number,
  canvasHeight: number,
  layers: [JimpInstance, number][],
) {
  return layers.reduce(
    (acc, [image, opacity]) =>
      acc.composite(image, 0, 0, {
        mode: jimp.BlendMode.SRC_OVER,
        opacitySource: opacity,
      }),
    createEmptyImage(canvasWidth, canvasHeight),
  );
}
