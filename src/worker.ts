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

import { drawDifference, type Pallet } from "./diff.js";
import { composeLayers, type AlignStrategy } from "./image.js";
import type { JimpInstance } from "./jimp.js";

self.addEventListener(
  "message",
  async (
    e: MessageEvent<{
      bufA: ArrayBuffer;
      bufB: ArrayBuffer;
      bufMask: ArrayBuffer;
      pallet: Pallet;
      align: AlignStrategy;
    }>,
  ) => {
    const { bufA, bufB, bufMask, pallet, align } = e.data;
    const a = (await jimp.Jimp.fromBuffer(bufA)) as JimpInstance;
    const b = (await jimp.Jimp.fromBuffer(bufB)) as JimpInstance;
    const mask = (await jimp.Jimp.fromBuffer(bufMask)) as JimpInstance;
    const {
      diff: diffLayer,
      addition,
      deletion,
      modification,
    } = drawDifference(a, b, mask, pallet, align);
    const diff = composeLayers(a.width, a.height, [
      [a, 0.2],
      [b, 0.2],
      [diffLayer, 1],
    ]);
    const bufDiff = new Uint8Array(await diff.getBuffer(jimp.JimpMime.png))
      .buffer;
    self.postMessage(
      {
        bufDiff,
        addition,
        deletion,
        modification,
      },
      [bufDiff],
    );
  },
);
