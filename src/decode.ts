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

import type { JimpInstance } from "./jimp.ts";

/**
 * Decode PNG bytes (as produced by {@link renderPageRangePng}) into an RGBA
 * image.
 * `jimp.fromBuffer` accepts an ArrayBuffer directly, which keeps this usable in
 * the browser without relying on Node's `Buffer`.
 */
export async function decodePng(
  png: ArrayBuffer,
): Promise<JimpInstance> {
  return (await jimp.Jimp.fromBuffer(png)) as JimpInstance;
}
