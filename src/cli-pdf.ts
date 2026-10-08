import { gs } from "@u1f992/gs-wasm";

import type { JimpInstance } from "./jimp.ts";
import { perf } from "./perf.ts";

type Placement = {
  image: JimpInstance;
  x: number;
  y: number;
  width: number;
  height: number;
};

const PDFWRITE_ARGS = [
  "-dNOPAUSE",
  "-dBATCH",
  "-dQUIET",
  "-dNOSAFER",
  "-sDEVICE=pdfwrite",
  "-dAutoFilterColorImages=false",
  "-dColorImageFilter=/FlateEncode",
  "-dAutoFilterGrayImages=false",
  "-dGrayImageFilter=/FlateEncode",
  "-dDownsampleColorImages=false",
  "-dDownsampleGrayImages=false",
];
const OUTPUT_VM_PATH = "output.pdf";

const MARGIN_MM = 10;
const FRAME_MM = 0.1;

const mmToPt = (mm: number) => (mm * 72) / 25.4;
const num = (n: number) => n.toFixed(3);

function splitAlpha(image: JimpInstance) {
  const rgba = image.bitmap.data;
  const pixels = image.width * image.height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;
  for (let i = 0; i < pixels; i++) {
    rgb[i * 3] = rgba[i * 4]!;
    rgb[i * 3 + 1] = rgba[i * 4 + 1]!;
    rgb[i * 3 + 2] = rgba[i * 4 + 2]!;
    alpha[i] = rgba[i * 4 + 3]!;
    if (alpha[i] !== 0xff) opaque = false;
  }
  return { rgb, alpha: opaque ? null : alpha };
}

async function renderPage(
  pageWidth: number,
  pageHeight: number,
  placements: Placement[],
  frameWidth: number | null,
): Promise<Uint8Array<ArrayBuffer>> {
  const span = perf.span("cli.pdfRenderPage_ms");
  const inputFiles: Record<string, Uint8Array<ArrayBuffer>> = {};
  const ps = [`<< /PageSize [${num(pageWidth)} ${num(pageHeight)}] >> setpagedevice`];
  placements.forEach(({ image, x, y, width, height }, i) => {
    const { rgb, alpha } = splitAlpha(image);
    const w = image.width;
    const h = image.height;
    const sampling = `/Width ${w} /Height ${h} /BitsPerComponent 8 /ImageMatrix [${w} 0 0 -${h} 0 ${h}]`;
    const data = `<< /ImageType 1 ${sampling} /Decode [0 1 0 1 0 1] /DataSource (${i}.rgb) (r) file >>`;
    inputFiles[`${i}.rgb`] = rgb;
    ps.push(`gsave ${num(x)} ${num(y)} translate ${num(width)} ${num(height)} scale`);
    ps.push("/DeviceRGB setcolorspace");
    if (alpha === null) {
      ps.push(`${data} image`);
    } else {
      inputFiles[`${i}.alpha`] = alpha;
      ps.push(
        `<< /ImageType 103 /DataDict ${data} /OpacityMaskDict << /ImageType 1 /InterleaveType 3 ${sampling} /Decode [0 1] /DataSource (${i}.alpha) (r) file >> >> .image3x`,
      );
    }
    ps.push("grestore");
    if (frameWidth !== null) {
      ps.push(
        `0 setgray ${num(frameWidth)} setlinewidth ${num(x - frameWidth / 2)} ${num(y - frameWidth / 2)} ${num(width + frameWidth)} ${num(height + frameWidth)} rectstroke`,
      );
    }
  });
  ps.push("showpage");
  inputFiles["page.ps"] = new TextEncoder().encode(ps.join("\n"));

  const { exitCode, outputFiles } = await gs({
    args: [...PDFWRITE_ARGS, "-dALLOWPSTRANSPARENCY", `-sOutputFile=${OUTPUT_VM_PATH}`, "page.ps"],
    inputFiles,
    outputFilePaths: [OUTPUT_VM_PATH],
    transfer: Object.values(inputFiles).map((bytes) => bytes.buffer),
  });
  span.stop();
  if (exitCode !== 0) {
    throw new Error(`gs pdfwrite failed (exit ${exitCode})`);
  }
  const pdf = outputFiles[OUTPUT_VM_PATH];
  if (!pdf) {
    throw new Error("gs pdfwrite produced no output");
  }
  return pdf;
}

const pxToPt = (px: number, dpi: number) => (px * 72) / dpi;

export function renderDiffPage(diff: JimpInstance, dpi: number) {
  const width = pxToPt(diff.width, dpi);
  const height = pxToPt(diff.height, dpi);
  return renderPage(width, height, [{ image: diff, x: 0, y: 0, width, height }], null);
}

export function renderSideBySidePage(images: JimpInstance[], dpi: number) {
  const margin = mmToPt(MARGIN_MM);
  const sizes = images.map((image) => ({
    image,
    width: pxToPt(image.width, dpi),
    height: pxToPt(image.height, dpi),
  }));
  const rowHeight = Math.max(...sizes.map((s) => s.height));
  const placements: Placement[] = [];
  let x = margin;
  for (const s of sizes) {
    placements.push({ ...s, x, y: margin + rowHeight - s.height });
    x += s.width + margin;
  }
  return renderPage(x, rowHeight + margin * 2, placements, mmToPt(FRAME_MM));
}

export async function concatPdfs(pdfs: Uint8Array<ArrayBuffer>[]) {
  const span = perf.span("cli.pdfConcat_ms");
  const inputFiles = Object.fromEntries(pdfs.map((pdf, i) => [`${i}.pdf`, pdf]));
  const { exitCode, outputFiles } = await gs({
    args: [...PDFWRITE_ARGS, `-sOutputFile=${OUTPUT_VM_PATH}`, ...Object.keys(inputFiles)],
    inputFiles,
    outputFilePaths: [OUTPUT_VM_PATH],
  });
  span.stop();
  if (exitCode !== 0) {
    throw new Error(`gs pdfwrite failed (exit ${exitCode})`);
  }
  const pdf = outputFiles[OUTPUT_VM_PATH];
  if (!pdf) {
    throw new Error("gs pdfwrite produced no output");
  }
  return pdf;
}
