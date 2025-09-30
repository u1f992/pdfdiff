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

export type RGBAColor = [number, number, number, number];

export const parseHex = (hex: string) => {
  if (/^#([0-9a-fA-F]{3})$/.test(hex)) {
    return [
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
      parseInt(hex[3]! + hex[3]!, 16),
      255,
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{4})$/.test(hex)) {
    return [
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
      parseInt(hex[3]! + hex[3]!, 16),
      parseInt(hex[4]! + hex[4]!, 16),
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{6})$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{8})$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      parseInt(hex.slice(7, 9), 16),
    ] as RGBAColor;
  }
  return null;
};

export const formatHex = ([r, g, b, a]: RGBAColor) =>
  "#" +
  [r, g, b, a]
    .map((v) => {
      const hex = v.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("");
