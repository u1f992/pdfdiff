import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PdfRenderer } from "../src/pdf.ts";

const fixtures = new URL("./fixtures/", import.meta.url);
const readFixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(name, fixtures)));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

void test("PdfRenderer counts and renders pages from one instance", async () => {
  const renderer = await PdfRenderer.create(
    { a: readFixture("a.pdf"), b: readFixture("b.pdf") },
    72,
    true,
  );
  try {
    assert.equal(await renderer.countPages("a"), 1);
    assert.equal(await renderer.countPages("b"), 1);
    for (const name of ["a", "b", "a"] as const) {
      const png = await renderer.renderPage(name, 0);
      assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
    }
    await assert.rejects(renderer.renderPage("a", 1), /render\(a, page 2\) failed/);
  } finally {
    renderer.delete();
  }
});

void test("PdfRenderer reports a document it was not given", async () => {
  const renderer = await PdfRenderer.create({ a: readFixture("a.pdf") }, 72, false);
  try {
    await assert.rejects(renderer.countPages("mask"), /countPages\(mask\) failed/);
  } finally {
    renderer.delete();
  }
});
