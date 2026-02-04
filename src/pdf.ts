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
import * as mupdf from "mupdf";

export function* loadPages(pdf: mupdf.Document) {
  for (let i = 0; i < pdf.countPages(); i++) {
    yield pdf.loadPage(i);
  }
}

export async function pageToImage(
  page: mupdf.Page,
  dpi: number,
  alpha: boolean,
) {
  const zoom = dpi / 72;
  const pixmap = page.toPixmap(
    [zoom, 0, 0, zoom, 0, 0],
    mupdf.ColorSpace.DeviceRGB,
    alpha,
  );
  const ret = await jimp.Jimp.fromBuffer(new Uint8Array(pixmap.asPNG()).buffer);
  pixmap.destroy();
  page.destroy();
  return ret;
}
