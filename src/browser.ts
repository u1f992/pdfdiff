// @ts-check
/// <reference lib="dom" />

import * as pdfdiff from "./index.js";

/**
 * @param {File} file
 */
async function readFileAsUint8Array(file) {
  return /** @type {Promise<Uint8Array>} */ (
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(new Uint8Array(/** @type {ArrayBuffer} */ (reader.result)));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    })
  );
}

document
  .getElementById("pdf-diff-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const resultsContainer = document.getElementById("results");
    if (resultsContainer) resultsContainer.innerHTML = "";

    const errorElement = document.getElementById("error-message");
    if (errorElement) errorElement.textContent = "";

    try {
      const pdfAFile = /** @type {HTMLInputElement | null} */ (
        document.getElementById("pdf-a")
      )?.files?.[0];
      const pdfBFile = /** @type {HTMLInputElement | null} */ (
        document.getElementById("pdf-b")
      )?.files?.[0];
      if (typeof pdfAFile === "undefined" || typeof pdfBFile === "undefined") {
        throw new Error();
      }
      const pdfA = await readFileAsUint8Array(pdfAFile);
      const pdfB = await readFileAsUint8Array(pdfBFile);

      const pdfMaskFile = /** @type {HTMLInputElement | null} */ (
        document.getElementById("pdf-mask")
      )?.files?.[0];
      const pdfMask = pdfMaskFile
        ? await readFileAsUint8Array(pdfMaskFile)
        : undefined;

      const dpi = ((
        val = /** @type {HTMLInputElement | null} */ (
          document.getElementById("dpi")
        )?.value,
      ) => (typeof val !== "undefined" ? parseInt(val, 10) : undefined))();
      const alpha = /** @type {HTMLInputElement | null} */ (
        document.getElementById("alpha")
      )?.checked;

      const align = /** @type {HTMLInputElement | null} */ (
        document.getElementById("align")
      )?.value;
      if (
        typeof align !== "undefined" &&
        !pdfdiff.isValidAlignStrategy(align)
      ) {
        throw new Error();
      }

      const additionColor = ((
        hex = /** @type {HTMLInputElement | null} */ (
          document.getElementById("addition-color")
        )?.value,
      ) => (typeof hex !== "undefined" ? pdfdiff.parseHex(hex) : undefined))();
      const deletionColor = ((
        hex = /** @type {HTMLInputElement | null} */ (
          document.getElementById("deletion-color")
        )?.value,
      ) => (typeof hex !== "undefined" ? pdfdiff.parseHex(hex) : undefined))();
      const modificationColor = ((
        hex = /** @type {HTMLInputElement | null} */ (
          document.getElementById("modification-color")
        )?.value,
      ) => (typeof hex !== "undefined" ? pdfdiff.parseHex(hex) : undefined))();
      if (
        additionColor === null ||
        deletionColor === null ||
        modificationColor === null
      ) {
        throw new Error();
      }

      for await (const [
        i,
        { a, b, diff, addition, deletion, modification },
      ] of pdfdiff.withIndex(
        pdfdiff.visualizeDifferences(pdfA, pdfB, {
          dpi,
          alpha,
          mask: pdfMask,
          align,
          pallet: {
            addition: additionColor,
            deletion: deletionColor,
            modification: modificationColor,
          },
        }),
        1,
      )) {
        const pageResult = document.createElement("details");
        pageResult.className = "diff-details";
        pageResult.open =
          addition.length + deletion.length + modification.length > 0;

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

        const cellA = document.createElement("td");
        const imageA = document.createElement("img");
        imageA.src = await a.getBase64("image/png");
        imageA.className = "checkerboard-bg";
        cellA.appendChild(imageA);
        imagesRow.appendChild(cellA);

        const cellB = document.createElement("td");
        const imageB = document.createElement("img");
        imageB.src = await b.getBase64("image/png");
        imageB.className = "checkerboard-bg";
        cellB.appendChild(imageB);
        imagesRow.appendChild(cellB);

        const cellDiff = document.createElement("td");
        const imageDiff = document.createElement("img");
        imageDiff.src = await diff.getBase64("image/png");
        imageDiff.className = "checkerboard-bg";
        cellDiff.appendChild(imageDiff);
        imagesRow.appendChild(cellDiff);

        imagesTable.appendChild(imagesRow);

        pageResult.appendChild(imagesTable);
        resultsContainer?.appendChild(pageResult);
      }
    } catch (e) {
      console.error(e);
      if (errorElement) {
        errorElement.textContent = `Error: ${/** @type {Error} */ (e).message}`;
      }
    }
  });
