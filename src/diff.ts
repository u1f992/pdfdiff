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
import { range as rangeSync, reduce as reduceSync } from "ix/iterable";

import { productSync } from "./iterable.js";
import { createEmptyImage } from "./image.js";
/** @typedef {import("./rgba-color.js").RGBAColor} RGBAColor */

/** @typedef {{ addition: Readonly<RGBAColor>; deletion: Readonly<RGBAColor>; modification: Readonly<RGBAColor> }} Pallet */

/**
 * @param {JimpInstance} a
 * @param {JimpInstance} b
 * @param {JimpInstance} mask
 * @param {Pallet} pallet
 */
export function drawDifference(a, b, mask, pallet) {
  if (
    a.width !== b.width ||
    b.width !== mask.width ||
    a.height !== b.height ||
    b.height !== mask.height
  ) {
    throw new Error("Assertion failed: pages are different sizes");
  }

  const addColor = jimp.rgbaToInt(
    pallet.addition[0],
    pallet.addition[1],
    pallet.addition[2],
    pallet.addition[3],
  );
  const delColor = jimp.rgbaToInt(
    pallet.deletion[0],
    pallet.deletion[1],
    pallet.deletion[2],
    pallet.deletion[3],
  );
  const modColor = jimp.rgbaToInt(
    pallet.modification[0],
    pallet.modification[1],
    pallet.modification[2],
    pallet.modification[3],
  );

  return reduceSync(
    productSync(rangeSync(0, a.width), rangeSync(0, a.height)),
    {
      callback: ({ addition, deletion, modification, diff }, [x, y]) => {
        const intA = a.getPixelColor(x, y);
        const intB = b.getPixelColor(x, y);
        const colorA = jimp.intToRGBA(intA);
        const colorB = jimp.intToRGBA(intB);
        const masked = jimp.intToRGBA(mask.getPixelColor(x, y)).a !== 0;
        if (masked || intA === intB || (colorA.a === 0 && colorB.a === 0)) {
          return { addition, deletion, modification, diff };
        }
        const [target, color] =
          colorA.a === 0 && colorB.a !== 0
            ? [addition, addColor]
            : colorA.a !== 0 && colorB.a === 0
              ? [deletion, delColor]
              : [modification, modColor];
        target.push([x, y]);
        diff.setPixelColor(color, x, y);
        return { addition, deletion, modification, diff };
      },
      seed: {
        addition: /** @type {[number, number][]} */ ([]),
        deletion: /** @type {[number, number][]} */ ([]),
        modification: /** @type {[number, number][]} */ ([]),
        diff: createEmptyImage(a.width, a.height),
      },
    },
  );
}
