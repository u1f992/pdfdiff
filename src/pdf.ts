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

import type { JimpInstance } from "./jimp.ts";

export function* loadPages(pdf: mupdf.Document) {
  for (let i = 0; i < pdf.countPages(); i++) {
    yield pdf.loadPage(i);
  }
}

function pixmapToRGBA(pixmap: mupdf.Pixmap): Uint8Array {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const stride = pixmap.getStride();
  const hasAlpha = pixmap.getAlpha() !== 0;
  const samples = pixmap.getPixels();

  if (hasAlpha && stride === width * 4) {
    return new Uint8Array(samples);
  }

  const out = new Uint8Array(width * height * 4);
  const srcBpp = pixmap.getNumberOfComponents() + (hasAlpha ? 1 : 0);
  for (let y = 0; y < height; y++) {
    const srcRow = y * stride;
    const dstRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * srcBpp;
      const d = dstRow + x * 4;
      out[d] = samples[s]!;
      out[d + 1] = samples[s + 1]!;
      out[d + 2] = samples[s + 2]!;
      out[d + 3] = hasAlpha ? samples[s + 3]! : 255;
    }
  }
  return out;
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
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const data = pixmapToRGBA(pixmap);
  pixmap.destroy();
  page.destroy();
  return jimp.Jimp.fromBitmap({ width, height, data }) as JimpInstance;
}
