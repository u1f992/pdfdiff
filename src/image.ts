// @ts-check

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
/** @typedef {jimp.JimpInstance} JimpInstance */

/**
 * @param {number} width
 * @param {number} height
 */
export function createEmptyImage(width, height) {
  return new jimp.Jimp({
    width,
    height,
    color: jimp.rgbaToInt(0, 0, 0, 0),
  });
}

/**
 * @overload
 * @param {[JimpInstance, JimpInstance] | [JimpInstance, null] | [null, JimpInstance]} images
 * @returns {[JimpInstance, JimpInstance]}
 *
 * @overload
 * @param {[JimpInstance, JimpInstance, JimpInstance] | [JimpInstance, JimpInstance, null] | [JimpInstance, null, JimpInstance] | [JimpInstance, null, null] | [null, JimpInstance, JimpInstance] | [null, JimpInstance, null] | [null, null, JimpInstance]} images
 * @returns {[JimpInstance, JimpInstance, JimpInstance]}
 *
 * @param {(JimpInstance | null)[]} images
 * @returns {JimpInstance[]}
 */
export function fillWithEmpty(images) {
  return images.map((img) => (img !== null ? img : createEmptyImage(1, 1)));
}

/** @type {["resize", "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]} */
const alignStrategyValues = [
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
];
/**
 * @typedef {typeof alignStrategyValues[number]} AlignStrategy
 */

/**
 * @param {string} str
 * @returns {str is AlignStrategy}
 */
export const isValidAlignStrategy = (str) =>
  /** @type {string[]} */ (alignStrategyValues).includes(str);

/**
 * @param {JimpInstance} img
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @param {AlignStrategy} align
 */
function alignImage(img, targetWidth, targetHeight, align) {
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

/**
 * @overload
 * @param {[JimpInstance, JimpInstance]} images
 * @param {AlignStrategy} align
 * @returns {[JimpInstance, JimpInstance]}
 *
 * @overload
 * @param {[JimpInstance, JimpInstance, JimpInstance]} images
 * @param {AlignStrategy} align
 * @returns {[JimpInstance, JimpInstance, JimpInstance]}
 *
 * @param {JimpInstance[]} images
 * @param {AlignStrategy} align
 * @returns {JimpInstance[]}
 */
export function alignSize(images, align) {
  if (images.length === 0) {
    return [];
  }
  const largerWidth = Math.max(...images.map((img) => img.width));
  const largerHeight = Math.max(...images.map((img) => img.height));
  // @ts-expect-error
  return images.map((img) =>
    img.width === largerWidth && img.height === largerHeight
      ? img
      : alignImage(img, largerWidth, largerHeight, align),
  );
}

/**
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {[JimpInstance, number][]} layers
 */
export function composeLayers(canvasWidth, canvasHeight, layers) {
  return layers.reduce(
    (acc, [image, opacity]) =>
      acc.composite(image, 0, 0, {
        mode: jimp.BlendMode.SRC_OVER,
        opacitySource: opacity,
      }),
    createEmptyImage(canvasWidth, canvasHeight),
  );
}
