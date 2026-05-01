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

import { type JimpInstance } from "./jimp.ts";
import { alignSize, createEmptyImage, type AlignStrategy } from "./image.ts";
import { perf } from "./perf.ts";
import { type RGBAColor } from "./rgba-color.ts";

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
  const sAlign = perf.span("diff.align_ms");
  const [aNew, bNew, maskNew] = alignSize([a, b, mask], align);
  sAlign.stop();

  const width = aNew.width;
  const height = aNew.height;
  const aData = aNew.bitmap.data;
  const bData = bNew.bitmap.data;
  const mData = maskNew.bitmap.data;

  const sCreate = perf.span("diff.createEmpty_ms");
  const diffImage = createEmptyImage(width, height);
  const dData = diffImage.bitmap.data;
  sCreate.stop();

  const addition: [number, number][] = [];
  const deletion: [number, number][] = [];
  const modification: [number, number][] = [];

  const sScan = perf.span("diff.scan_ms");
  let diffPixels = 0;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (mData[idx + 3]! !== 0) continue;
      const aAlpha = aData[idx + 3]!;
      const bAlpha = bData[idx + 3]!;
      if (
        aAlpha === bAlpha &&
        aData[idx] === bData[idx] &&
        aData[idx + 1] === bData[idx + 1] &&
        aData[idx + 2] === bData[idx + 2]
      ) {
        continue;
      }
      if (aAlpha === 0 && bAlpha === 0) continue;
      let target: [number, number][];
      let color: Readonly<RGBAColor>;
      if (aAlpha === 0) {
        target = addition;
        color = pallet.addition;
      } else if (bAlpha === 0) {
        target = deletion;
        color = pallet.deletion;
      } else {
        target = modification;
        color = pallet.modification;
      }
      target.push([x, y]);
      diffPixels++;
      dData[idx] = color[0];
      dData[idx + 1] = color[1];
      dData[idx + 2] = color[2];
      dData[idx + 3] = color[3];
    }
  }
  sScan.stop();
  perf.incr("diff.diffPixels", diffPixels);
  perf.incr("diff.totalPixels", width * height);
  perf.incr("diff.pages");

  return { diff: diffImage, addition, deletion, modification };
}
