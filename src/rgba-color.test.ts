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

import assert from "assert";
import test from "node:test";

import { parseHex, formatHex } from "./rgba-color.ts";

test("parseHex", async (ctx) => {
  await ctx.test("#rgb", () => {
    assert.deepStrictEqual(parseHex("#fed"), [0xff, 0xee, 0xdd, 0xff]);
  });
  await ctx.test("#rrggbb", () => {
    assert.deepStrictEqual(parseHex("#fffefd"), [0xff, 0xfe, 0xfd, 0xff]);
  });
  await ctx.test("#rgba", () => {
    assert.deepStrictEqual(parseHex("#fedc"), [0xff, 0xee, 0xdd, 0xcc]);
  });
  await ctx.test("#rrggbbaa", () => {
    assert.deepStrictEqual(parseHex("#fffefdfc"), [0xff, 0xfe, 0xfd, 0xfc]);
  });
  await ctx.test("invalid", () => {
    assert.deepStrictEqual(parseHex("foobar"), null);
  });
});

test("formatHex", () => {
  assert.deepStrictEqual(formatHex([0xff, 0xfe, 0xfd, 0xfc]), "#fffefdfc");
});
