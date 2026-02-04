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
import { alignSize, createEmptyImage, type AlignStrategy } from "./image.js";
import { type RGBAColor } from "./rgba-color.js";

export type Pallet = {
  addition: RGBAColor;
  deletion: RGBAColor;
  modification: RGBAColor;
};

export function drawDifference(
  a: JimpInstance,
  b: JimpInstance,
  mask: JimpInstance,
  pallet: Readonly<Pallet>,
  align: AlignStrategy,
) {
  const [aNew, bNew, maskNew] = alignSize([a, b, mask], align);

  const addColor = jimp.rgbaToInt(...pallet.addition);
  const delColor = jimp.rgbaToInt(...pallet.deletion);
  const modColor = jimp.rgbaToInt(...pallet.modification);

  const diffImage = createEmptyImage(aNew.width, aNew.height);
  const addition = [] as [number, number][];
  const deletion = [] as [number, number][];
  const modification = [] as [number, number][];

  for (let x = 0; x < aNew.width; x++) {
    for (let y = 0; y < aNew.height; y++) {
      const intA = aNew.getPixelColor(x, y);
      const intB = bNew.getPixelColor(x, y);
      const colorA = jimp.intToRGBA(intA);
      const colorB = jimp.intToRGBA(intB);
      const masked = jimp.intToRGBA(maskNew.getPixelColor(x, y)).a !== 0;
      if (masked || intA === intB || (colorA.a === 0 && colorB.a === 0)) {
        continue;
      }
      const [target, color] =
        colorA.a === 0 && colorB.a !== 0
          ? [addition, addColor]
          : colorA.a !== 0 && colorB.a === 0
            ? [deletion, delColor]
            : [modification, modColor];
      target.push([x, y]);
      diffImage.setPixelColor(color, x, y);
    }
  }

  return { diff: diffImage, addition, deletion, modification };
}
