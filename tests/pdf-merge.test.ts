import assert from "node:assert/strict";
import test from "node:test";

import { decodePng } from "../src/decode.ts";
import { PdfRenderer } from "../src/pdf.ts";
import { PdfBuilder, renderDiffPage } from "../src/pdfwrite.ts";

const SIZE = 10;

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
  for (const [r, g, b] of colors) {
    await builder.add(() => renderDiffPage(solidBitmap(r, g, b), 72));
  }
  const merged = await builder.finish();
  assert.ok(merged !== null);
  assert.equal(new TextDecoder().decode(merged.subarray(0, 5)), "%PDF-");

  const renderer = await PdfRenderer.create({ a: merged }, 72, false);
  try {
    assert.equal(await renderer.countPages("a"), colors.length);
    for (const [index, [r, g, b]] of colors.entries()) {
      const image = await decodePng((await renderer.renderPage("a", index)).buffer);
      assert.deepEqual([image.width, image.height], [SIZE, SIZE]);
      const at = (SIZE * (SIZE / 2) + SIZE / 2) * 4;
      assert.deepEqual([...image.bitmap.data.subarray(at, at + 3)], [r, g, b]);
    }
  } finally {
    renderer.delete();
  }
});

void test("PdfBuilder with no pages yields null", async () => {
  assert.equal(await new PdfBuilder(1).finish(), null);
});
