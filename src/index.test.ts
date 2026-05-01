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

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  defaultOptions,
  formatHex,
  isValidAlignStrategy,
  parseHex,
  visualizeDifferences,
  withIndex,
} from "./index.ts";

const fixtures = new URL("../test/", import.meta.url);
const readFixture = (name: string) =>
  new Uint8Array(fs.readFileSync(new URL(name, fixtures)));

test("re-exports are exposed as runtime values", () => {
  assert.equal(typeof withIndex, "function");
  assert.equal(typeof isValidAlignStrategy, "function");
  assert.equal(typeof parseHex, "function");
  assert.equal(typeof formatHex, "function");
});

test("defaultOptions", () => {
  assert.deepEqual(defaultOptions, {
    dpi: 150,
    alpha: true,
    mask: undefined,
    align: "resize",
    pallet: {
      addition: [0x4c, 0xae, 0x4f, 0xff],
      deletion: [0xff, 0x57, 0x24, 0xff],
      modification: [0xff, 0xc1, 0x05, 0xff],
    },
  });
});

test("isValidAlignStrategy", async (ctx) => {
  for (const s of [
    "resize",
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "middle-center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ]) {
    await ctx.test(s, () => {
      assert.equal(isValidAlignStrategy(s), true);
    });
  }
  await ctx.test("invalid", () => {
    assert.equal(isValidAlignStrategy("invalid"), false);
  });
});

test("visualizeDifferences pins counts for fixtures at dpi 300", async () => {
  const a = readFixture("a.pdf");
  const b = readFixture("b.pdf");
  const mask = readFixture("mask.pdf");

  const pages: { addition: number; deletion: number; modification: number }[] =
    [];
  for await (const page of visualizeDifferences(a, b, { dpi: 300, mask })) {
    pages.push({
      addition: page.addition.length,
      deletion: page.deletion.length,
      modification: page.modification.length,
    });
  }

  assert.deepEqual(pages, [
    { addition: 7500, deletion: 7500, modification: 7500 },
  ]);
});
