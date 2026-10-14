import assert from "node:assert/strict";
import test from "node:test";

import { decodePng } from "../src/decode.ts";
import { PdfRenderer } from "../src/pdf.ts";
import { PdfBuilder, renderDiffPage } from "../src/pdfwrite.ts";
import { defaultOptions } from "../src/index.ts";

const SIZE = 10;
const counts = { addition: 0, deletion: 0, modification: 0 };

function solidBitmap(r: number, g: number, b: number) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([r, g, b, 0xff], i * 4);
  return { width: SIZE, height: SIZE, data };
}

const colors: [number, number, number][] = [
  [0xff, 0x00, 0x00],
  [0x00, 0xff, 0x00],
  [0x00, 0x00, 0xff],
  [0x80, 0x80, 0x80],
  [0xff, 0xff, 0x00],
];

void test("PdfBuilder merges page PDFs in order", async () => {
  const builder = new PdfBuilder(2);
  for (const [number, [r, g, b]] of colors.entries()) {
    const page = { number: number + 1, count: colors.length };
    await builder.add(() =>
      renderDiffPage(solidBitmap(r, g, b), defaultOptions.pallet, counts, page, 72),
    );
  }
  const merged = await builder.finish();
  assert.ok(merged !== null);
  assert.equal(new TextDecoder().decode(merged.subarray(0, 5)), "%PDF-");

  const renderer = await PdfRenderer.create({ a: merged }, 72, false);
  try {
    assert.equal(await renderer.countPages("a"), colors.length);
    for (const [index, [r, g, b]] of colors.entries()) {
      const image = await decodePng((await renderer.renderPage("a", index)).buffer);
      const pixels = image.bitmap.data;
      let found = false;
      for (let at = 0; at < pixels.length && !found; at += 4) {
        found = pixels[at] === r && pixels[at + 1] === g && pixels[at + 2] === b;
      }
      assert.ok(found, `page ${index + 1} shows the color of page ${index + 1}`);
    }
  } finally {
    renderer.delete();
  }
});

void test("PdfBuilder with no pages yields null", async () => {
  assert.equal(await new PdfBuilder(1).finish(), null);
});
