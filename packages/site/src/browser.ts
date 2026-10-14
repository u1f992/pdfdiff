/// <reference lib="dom" />

import encode from "@jsquash/png/encode.js";
import { zipSync } from "fflate";

import * as pdfdiff from "@u1f992/pdfdiff";

type Bitmap = {
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
};

type Page = pdfdiff.PageNumber & {
  a: Bitmap;
  b: Bitmap;
  diff: Bitmap;
  counts: pdfdiff.DiffCounts;
};

type Download = {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  filename: string;
};

type Output = {
  write(page: Page): Promise<void>;
  finish(): Promise<Download | null>;
};

async function encodeBitmapToPng({ width, height, data }: Bitmap) {
  const view = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(await encode(new ImageData(view, width, height)));
}

function zipOutput(filename: string): Output {
  const files: Record<string, Uint8Array> = {};
  return {
    async write({ number, a, b, diff }) {
      files[`${number}/a.png`] = await encodeBitmapToPng(a);
      files[`${number}/b.png`] = await encodeBitmapToPng(b);
      files[`${number}/diff.png`] = await encodeBitmapToPng(diff);
    },
    async finish() {
      if (Object.keys(files).length === 0) {
        return null;
      }
      return {
        bytes: new Uint8Array(zipSync(files, { level: 0 })),
        type: "application/zip",
        filename,
      };
    },
  };
}

function pdfOutput(
  filename: string,
  concurrency: number,
  render: (page: Page) => pdfdiff.PdfwriteJob,
): Output {
  const builder = new pdfdiff.PdfBuilder(concurrency);
  return {
    write(page) {
      return builder.add(() => render(page));
    },
    async finish() {
      const pdf = await builder.finish();
      return pdf === null ? null : { bytes: pdf, type: "application/pdf", filename };
    },
  };
}

const outTypes = ["zip", "diff-pdf", "a-b-diff-pdf"] as const;
type OutType = (typeof outTypes)[number];
const isOutType = (str: string): str is OutType => (outTypes as readonly string[]).includes(str);

function saveFile({ bytes, type, filename }: Download) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function field<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing form field: ${id}`);
  }
  return element as T;
}

const fileField = (id: string) => field<HTMLInputElement>(id).files?.[0];

function parseColor(id: string) {
  const color = pdfdiff.parseHex(field<HTMLInputElement>(id).value);
  if (color === null) {
    throw new Error(`Invalid ${id} value`);
  }
  return color;
}

const versionEl = document.getElementById("version");
if (versionEl) versionEl.textContent = "v" + pdfdiff.VERSION;

const form = field<HTMLFormElement>("pdf-diff-form");
const submitButton = field<HTMLButtonElement>("submit");
const messageEl = field<HTMLElement>("message");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Preparing...";

  try {
    const pdfAFile = fileField("pdf-a");
    const pdfBFile = fileField("pdf-b");
    if (pdfAFile === undefined || pdfBFile === undefined) {
      throw new Error("A and B are required");
    }
    const pdfA = await readFileAsUint8Array(pdfAFile);
    const pdfB = await readFileAsUint8Array(pdfBFile);
    const pdfMaskFile = fileField("pdf-mask");
    const pdfMask = pdfMaskFile ? await readFileAsUint8Array(pdfMaskFile) : undefined;

    const dpi = parseInt(field<HTMLInputElement>("dpi").value, 10);
    if (Number.isNaN(dpi)) {
      throw new Error("Invalid DPI value");
    }
    const alpha = field<HTMLInputElement>("alpha").checked;
    const workersRaw = field<HTMLInputElement>("workers").value;
    const workers = workersRaw ? parseInt(workersRaw, 10) : pdfdiff.defaultOptions.workers;
    if (Number.isNaN(workers) || workers < 1) {
      throw new Error("Invalid workers value");
    }
    const pallet: pdfdiff.Pallet = {
      addition: parseColor("addition-color"),
      deletion: parseColor("deletion-color"),
      modification: parseColor("modification-color"),
    };
    const diffOnly = field<HTMLInputElement>("diff-only").checked;
    const outType = field<HTMLSelectElement>("out-type").value;
    if (!isOutType(outType)) {
      throw new Error("Invalid output type");
    }

    const suffix = diffOnly ? "-diff-only" : "";
    const output =
      outType === "zip"
        ? zipOutput(`pdfdiff-result${suffix}.zip`)
        : outType === "diff-pdf"
          ? pdfOutput(`pdfdiff-diff${suffix}.pdf`, workers, ({ diff, counts, number, count }) =>
              pdfdiff.renderDiffPage(diff, pallet, counts, { number, count }, dpi),
            )
          : pdfOutput(
              `pdfdiff-a-b-diff${suffix}.pdf`,
              workers,
              ({ a, b, diff, counts, number, count }) =>
                pdfdiff.renderSideBySidePage(
                  { a, b, diff },
                  pallet,
                  counts,
                  { number, count },
                  dpi,
                ),
            );

    for await (const [
      index,
      { a, b, diff, addition, deletion, modification, pageCount },
    ] of pdfdiff.withIndex(
      pdfdiff.visualizeDifferences(pdfA, pdfB, {
        dpi,
        alpha,
        mask: pdfMask,
        pallet,
        workers,
      }),
      1,
    )) {
      submitButton.textContent = `Page ${index}...`;
      const counts: pdfdiff.DiffCounts = {
        addition: addition.length,
        deletion: deletion.length,
        modification: modification.length,
      };
      const pageHasDiff = counts.addition > 0 || counts.deletion > 0 || counts.modification > 0;
      if (diffOnly && !pageHasDiff) {
        continue;
      }
      await output.write({
        number: index,
        count: pageCount,
        a: a.bitmap,
        b: b.bitmap,
        diff: diff.bitmap,
        counts,
      });
    }

    submitButton.textContent = "Generating...";
    const download = await output.finish();
    if (download === null) {
      messageEl.textContent = "No page was output.";
    } else {
      saveFile(download);
    }
  } catch (e) {
    console.error(e);
    messageEl.textContent = `Error: ${(e as Error).message}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit";
  }
});
