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

import { drawDifference } from "./diff.js";
import { alignSize, composeLayers } from "./image.js";

addEventListener("message", async (e) => {
  const { bufA, bufB, bufMask, pallet, align } =
    /** @type {{bufA: ArrayBuffer, bufB: ArrayBuffer, bufMask: ArrayBuffer, pallet: import("./diff.js").Pallet, align: import("./image.js").AlignStrategy}} */ (
      e.data
    );
  const [a, b, mask] = alignSize(
    [
      /** @type {JimpInstance} */ (await jimp.Jimp.fromBuffer(bufA)),
      /** @type {JimpInstance} */ (await jimp.Jimp.fromBuffer(bufB)),
      /** @type {JimpInstance} */ (await jimp.Jimp.fromBuffer(bufMask)),
    ],
    align,
  );
  const {
    diff: diffLayer,
    addition,
    deletion,
    modification,
  } = drawDifference(a, b, mask, pallet);
  const diff = composeLayers(a.width, a.height, [
    [a, 0.2],
    [b, 0.2],
    [diffLayer, 1],
  ]);
  const bufDiff = new Uint8Array(await diff.getBuffer(jimp.JimpMime.png))
    .buffer;
  postMessage(
    {
      bufDiff,
      addition,
      deletion,
      modification,
    },
    [bufDiff],
  );
});
