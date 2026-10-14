import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  defaultOptions,
  defaultWorkers,
  defaultWorkersCap,
  formatHex,
  parseHex,
  visualizeDifferences,
  withIndex,
} from "../src/index.ts";

const fixtures = new URL("./fixtures/", import.meta.url);
const readFixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(name, fixtures)));

void test("re-exports are exposed as runtime values", () => {
  assert.equal(typeof withIndex, "function");
  assert.equal(typeof parseHex, "function");
  assert.equal(typeof formatHex, "function");
});

void test("defaultOptions", () => {
  assert.deepEqual(defaultOptions, {
    dpi: 72,
    alpha: true,
    mask: undefined,
    pallet: {
      addition: [0x4c, 0xae, 0x4f, 0xff],
      deletion: [0xff, 0x57, 0x24, 0xff],
      modification: [0xff, 0xc1, 0x05, 0xff],
    },
    workers: defaultWorkers,
  });
});

void test("defaultWorkers is the logical CPU count, capped", () => {
  assert.equal(defaultWorkers, Math.min(navigator.hardwareConcurrency, defaultWorkersCap));
});

void test("visualizeDifferences pins counts for fixtures at dpi 300", async () => {
  const a = readFixture("a.pdf");
  const b = readFixture("b.pdf");
  const mask = readFixture("mask.pdf");

  const pages: { addition: number; deletion: number; modification: number; pageCount: number }[] =
    [];
  for await (const page of visualizeDifferences(a, b, { dpi: 300, mask })) {
    pages.push({
      addition: page.addition.length,
      deletion: page.deletion.length,
      modification: page.modification.length,
      pageCount: page.pageCount,
    });
  }

  assert.deepEqual(pages, [{ addition: 7500, deletion: 7500, modification: 7500, pageCount: 1 }]);
});
