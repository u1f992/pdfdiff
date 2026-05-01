/// <reference lib="dom" />

import encode from "@jsquash/png/encode";
import { zipSync } from "fflate";

import * as pdfdiff from "./index.ts";
import { VERSION } from "./version.ts";

async function encodeBitmapToPng(img: {
  width: number;
  height: number;
  bitmap: {
    data: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  };
}): Promise<Uint8Array> {
  const data = img.bitmap.data;
  const view: Uint8ClampedArray<ArrayBuffer> =
    data instanceof Uint8ClampedArray
      ? data
      : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const png = await encode(new ImageData(view, img.width, img.height));
  return new Uint8Array(png);
}

const versionEl = document.getElementById("version");
if (versionEl) versionEl.textContent = "v" + VERSION;

const hideNoDiffEl = document.getElementById(
  "hide-no-diff",
) as HTMLInputElement | null;
const applyHideNoDiff = () => {
  document.body.classList.toggle("hide-no-diff", !!hideNoDiffEl?.checked);
};
hideNoDiffEl?.addEventListener("change", applyHideNoDiff);
applyHideNoDiff();

const downloadButton = document.getElementById(
  "download-zip",
) as HTMLButtonElement | null;
type ResultPage = {
  a: Uint8Array;
  b: Uint8Array;
  diff: Uint8Array;
  hasDiff: boolean;
};
let lastResultPages: Map<number, ResultPage> | null = null;
const updateDownloadLabel = () => {
  if (!downloadButton) return;
  downloadButton.textContent = hideNoDiffEl?.checked
    ? "Download zip (diff only)"
    : "Download zip";
};
hideNoDiffEl?.addEventListener("change", updateDownloadLabel);
updateDownloadLabel();

downloadButton?.addEventListener("click", () => {
  if (!lastResultPages) return;
  const diffOnly = !!hideNoDiffEl?.checked;
  const files: Record<string, Uint8Array> = {};
  for (const [i, page] of lastResultPages) {
    if (diffOnly && !page.hasDiff) continue;
    files[`${i}/a.png`] = page.a;
    files[`${i}/b.png`] = page.b;
    files[`${i}/diff.png`] = page.diff;
  }
  if (Object.keys(files).length === 0) return;
  const zipped = zipSync(files, { level: 0 });
  const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = diffOnly ? "pdfdiff-result-diff-only.zip" : "pdfdiff-result.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

document
  .getElementById("pdf-diff-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const resultsContainer = document.getElementById("results");
    if (resultsContainer) resultsContainer.innerHTML = "";

    const errorElement = document.getElementById("error-message");
    if (errorElement) errorElement.textContent = "";

    const submitButton = (event.currentTarget as HTMLFormElement).querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null;
    const originalSubmitText = submitButton?.textContent ?? "";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Preparing...";
    }
    if (downloadButton) downloadButton.disabled = true;
    lastResultPages = null;
    const resultPages = new Map<number, ResultPage>();
    let completed = false;

    try {
      const pdfAFile = (
        document.getElementById("pdf-a") as HTMLInputElement | null
      )?.files?.[0];
      const pdfBFile = (
        document.getElementById("pdf-b") as HTMLInputElement | null
      )?.files?.[0];
      if (typeof pdfAFile === "undefined" || typeof pdfBFile === "undefined") {
        throw new Error();
      }
      const pdfA = await readFileAsUint8Array(pdfAFile);
      const pdfB = await readFileAsUint8Array(pdfBFile);

      const pdfMaskFile = (
        document.getElementById("pdf-mask") as HTMLInputElement | null
      )?.files?.[0];
      const pdfMask = pdfMaskFile
        ? await readFileAsUint8Array(pdfMaskFile)
        : undefined;

      const dpi = ((
        val = (document.getElementById("dpi") as HTMLInputElement | null)
          ?.value,
      ) => (typeof val !== "undefined" ? parseInt(val, 10) : undefined))();
      const alpha = (
        document.getElementById("alpha") as HTMLInputElement | null
      )?.checked;

      const align = (
        document.getElementById("align") as HTMLInputElement | null
      )?.value;
      if (
        typeof align !== "undefined" &&
        !pdfdiff.isValidAlignStrategy(align)
      ) {
        throw new Error();
      }

      const workers = ((
        val = (document.getElementById("workers") as HTMLInputElement | null)
          ?.value,
      ) => (typeof val !== "undefined" ? parseInt(val, 10) : undefined))();
      if (
        typeof workers !== "undefined" &&
        (Number.isNaN(workers) || workers < 1)
      ) {
        throw new Error();
      }

      const additionColorHex = (
        document.getElementById("addition-color") as HTMLInputElement | null
      )?.value;
      const deletionColorHex = (
        document.getElementById("deletion-color") as HTMLInputElement | null
      )?.value;
      const modificationColorHex = (
        document.getElementById("modification-color") as HTMLInputElement | null
      )?.value;
      const additionColor = additionColorHex
        ? pdfdiff.parseHex(additionColorHex)
        : undefined;
      const deletionColor = deletionColorHex
        ? pdfdiff.parseHex(deletionColorHex)
        : undefined;
      const modificationColor = modificationColorHex
        ? pdfdiff.parseHex(modificationColorHex)
        : undefined;
      if (
        additionColor === null ||
        deletionColor === null ||
        modificationColor === null
      ) {
        throw new Error();
      }

      const options: Parameters<typeof pdfdiff.visualizeDifferences>[2] = {};
      if (dpi !== undefined) options.dpi = dpi;
      if (alpha !== undefined) options.alpha = alpha;
      if (pdfMask !== undefined) options.mask = pdfMask;
      if (align !== undefined) options.align = align;
      if (workers !== undefined) options.workers = workers;
      if (additionColor || deletionColor || modificationColor) {
        options.pallet = {};
        if (additionColor) options.pallet.addition = additionColor;
        if (deletionColor) options.pallet.deletion = deletionColor;
        if (modificationColor) options.pallet.modification = modificationColor;
      }

      for await (const [
        i,
        { a, b, diff, addition, deletion, modification },
      ] of pdfdiff.withIndex(
        pdfdiff.visualizeDifferences(pdfA, pdfB, options),
        1,
      )) {
        if (submitButton) submitButton.textContent = `Page ${i}...`;
        const pageResult = document.createElement("details");
        pageResult.className = "diff-details";
        const totalDiff =
          addition.length + deletion.length + modification.length;
        if (totalDiff === 0) pageResult.classList.add("no-diff");
        pageResult.open = totalDiff > 0;

        const summary = document.createElement("summary");

        const summaryInline = document.createElement("div");
        summaryInline.className = "summary-content";

        const pageTitle = document.createElement("h3");
        pageTitle.textContent = `Page ${i}`;

        const pageSummary = document.createElement("div");
        pageSummary.textContent = `Addition: ${addition.length}, Deletion: ${deletion.length}, Modification: ${modification.length}`;

        summaryInline.appendChild(pageTitle);
        summaryInline.appendChild(pageSummary);
        summary.appendChild(summaryInline);
        pageResult.appendChild(summary);

        const imagesTable = document.createElement("table");
        imagesTable.className = "diff-table";

        const headerRow = document.createElement("tr");

        const headerA = document.createElement("th");
        headerA.textContent = "A";
        headerRow.appendChild(headerA);

        const headerB = document.createElement("th");
        headerB.textContent = "B";
        headerRow.appendChild(headerB);

        const headerDiff = document.createElement("th");
        headerDiff.textContent = "Diff";
        headerRow.appendChild(headerDiff);

        imagesTable.appendChild(headerRow);

        const imagesRow = document.createElement("tr");

        const aPng = await encodeBitmapToPng(a);
        const bPng = await encodeBitmapToPng(b);
        const diffPng = await encodeBitmapToPng(diff);
        resultPages.set(i, {
          a: aPng,
          b: bPng,
          diff: diffPng,
          hasDiff: totalDiff > 0,
        });

        const cellA = document.createElement("td");
        const imageA = document.createElement("img");
        imageA.src = URL.createObjectURL(
          new Blob([new Uint8Array(aPng)], { type: "image/png" }),
        );
        imageA.className = "checkerboard-bg";
        cellA.appendChild(imageA);
        imagesRow.appendChild(cellA);

        const cellB = document.createElement("td");
        const imageB = document.createElement("img");
        imageB.src = URL.createObjectURL(
          new Blob([new Uint8Array(bPng)], { type: "image/png" }),
        );
        imageB.className = "checkerboard-bg";
        cellB.appendChild(imageB);
        imagesRow.appendChild(cellB);

        const cellDiff = document.createElement("td");
        const imageDiff = document.createElement("img");
        imageDiff.src = URL.createObjectURL(
          new Blob([new Uint8Array(diffPng)], { type: "image/png" }),
        );
        imageDiff.className = "checkerboard-bg";
        cellDiff.appendChild(imageDiff);
        imagesRow.appendChild(cellDiff);

        imagesTable.appendChild(imagesRow);

        pageResult.appendChild(imagesTable);
        resultsContainer?.appendChild(pageResult);
      }
      completed = true;
    } catch (e) {
      console.error(e);
      if (errorElement) {
        errorElement.textContent = `Error: ${(e as Error).message}`;
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalSubmitText;
      }
      if (completed && resultPages.size > 0) {
        lastResultPages = resultPages;
        if (downloadButton) downloadButton.disabled = false;
      }
    }
  });
