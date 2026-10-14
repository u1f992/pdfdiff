import { type Pallet } from "./diff.ts";
import { mergePdfs } from "./pdf-merge.ts";
import type { PdfMessage, PdfwriteMessage } from "./pdfwrite-worker.ts";
import { perf } from "./perf.ts";
import { type RGBAColor } from "./rgba-color.ts";
import { sliceBackingBuffer } from "./transferable.ts";
import { WorkerHandle, workerUrl } from "./worker-handle.ts";

export type Bitmap = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

type CaptionItem = {
  label: string;
  color: RGBAColor | null;
};

type Caption = CaptionItem[];

type Placement = {
  image: Bitmap;
  caption: Caption;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfwriteJob = {
  args: string[];
  inputFiles: Record<string, Uint8Array<ArrayBuffer>>;
};

const MARGIN_MM = 10;
const FRAME_MM = 0.1;
const CAPTION_FONT = "NimbusSans-Regular";
const NIMBUS_SANS_REGULAR_CAP_HEIGHT_EM = 0.729;
const CAPTION_FONT_MM = 3.5;
const CAPTION_GAP_MM = 2;
const CAPTION_ITEM_GAP_MM = 3;
const SWATCH_MM = 2.5;
const SWATCH_GAP_MM = 1;
const PAGE_NUMBER_FONT_MM = 3.5;

const mmToPt = (mm: number) => (mm * 72) / 25.4;
const pxToPt = (px: number, dpi: number) => (px * 72) / dpi;
const num = (n: number) => n.toFixed(3);
const psString = (s: string) => `(${s.replace(/[\\()]/g, "\\$&")})`;
const setFontPs = (sizeMm: number) =>
  `/${CAPTION_FONT} findfont ${num(mmToPt(sizeMm))} scalefont setfont`;

const itemGapMm = (i: number) => (i === 0 ? 0 : CAPTION_ITEM_GAP_MM);
const swatchAdvanceMm = ({ color }: CaptionItem) =>
  color !== null ? SWATCH_MM + SWATCH_GAP_MM : 0;

function captionRightEdgePs(caption: Caption, x: number) {
  const fixed = caption.reduce(
    (acc, item, i) => acc + mmToPt(itemGapMm(i) + swatchAdvanceMm(item)),
    x,
  );
  return [
    num(fixed),
    setFontPs(CAPTION_FONT_MM),
    ...caption.map((item) => `${psString(item.label)} stringwidth pop add`),
  ].join(" ");
}

function captionPs(caption: Caption, x: number, baseline: number) {
  const swatch = num(mmToPt(SWATCH_MM));
  const ps = [`0 setgray ${setFontPs(CAPTION_FONT_MM)} ${num(x)} ${num(baseline)} moveto`];
  caption.forEach((item, i) => {
    const parts = [`${num(mmToPt(itemGapMm(i)))} 0 rmoveto`];
    if (item.color !== null) {
      const [r, g, b, a] = item.color;
      const rgb = [r, g, b].map((c) => num(c / 255)).join(" ");
      parts.push(
        `currentpoint gsave ${num(a / 255)} .setfillconstantalpha ${rgb} setrgbcolor ${swatch} ${swatch} rectfill grestore ${num(mmToPt(swatchAdvanceMm(item)))} 0 rmoveto`,
      );
    }
    parts.push(`${psString(item.label)} show`);
    ps.push(parts.join(" "));
  });
  return ps;
}

function splitAlpha({ width, height, data: rgba }: Bitmap) {
  const pixels = width * height;
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

function pageNumberPs(text: string, x: number, capTop: number) {
  const capHeight = mmToPt(PAGE_NUMBER_FONT_MM) * NIMBUS_SANS_REGULAR_CAP_HEIGHT_EM;
  const baseline = capTop - capHeight;
  return `0 setgray ${setFontPs(PAGE_NUMBER_FONT_MM)} ${num(x)} ${num(baseline)} moveto ${psString(text)} show`;
}

function renderPage(
  pageWidth: number,
  pageHeight: number,
  placements: Placement[],
  pageNumber: PageNumber,
): PdfwriteJob {
  const span = perf.span("pdfwrite.renderPage_ms");
  const margin = mmToPt(MARGIN_MM);
  const frameWidth = mmToPt(FRAME_MM);
  const inputFiles: Record<string, Uint8Array<ArrayBuffer>> = {};
  const ps = [`/pageWidth ${num(pageWidth)} def`];
  for (const { caption, x } of placements) {
    ps.push(
      `${captionRightEdgePs(caption, x)} ${num(margin)} add dup pageWidth gt { /pageWidth exch def } { pop } ifelse`,
    );
  }
  ps.push(`<< /PageSize [pageWidth ${num(pageHeight)}] >> setpagedevice`);
  placements.forEach(({ image, caption, x, y, width, height }, i) => {
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
    ps.push(
      `0 setgray ${num(frameWidth)} setlinewidth ${num(x - frameWidth / 2)} ${num(y - frameWidth / 2)} ${num(width + frameWidth)} ${num(height + frameWidth)} rectstroke`,
    );
    ps.push(...captionPs(caption, x, y + height + mmToPt(CAPTION_GAP_MM)));
  });
  ps.push(
    pageNumberPs(
      `Page ${pageNumber.number} / ${pageNumber.count}`,
      margin,
      pageHeight - margin + frameWidth / 2,
    ),
  );
  ps.push("showpage");
  inputFiles["page.ps"] = new TextEncoder().encode(ps.join("\n"));
  span.stop();
  return { args: ["-dALLOWPSTRANSPARENCY", "page.ps"], inputFiles };
}

export type DiffCounts = {
  addition: number;
  deletion: number;
  modification: number;
};

export type PageNumber = {
  number: number;
  count: number;
};

type Captioned = {
  image: Bitmap;
  caption: Caption;
};

function renderRow(captioned: Captioned[], page: PageNumber, dpi: number): PdfwriteJob {
  const margin = mmToPt(MARGIN_MM);
  const captionBand = mmToPt(CAPTION_GAP_MM + CAPTION_FONT_MM);
  const pageNumberBand = mmToPt(PAGE_NUMBER_FONT_MM + CAPTION_GAP_MM);
  const sizes = captioned.map((c) => ({
    ...c,
    width: pxToPt(c.image.width, dpi),
    height: pxToPt(c.image.height, dpi),
  }));
  const rowHeight = Math.max(...sizes.map((s) => s.height));
  const placements: Placement[] = [];
  let x = margin;
  for (const s of sizes) {
    placements.push({ ...s, x, y: margin + rowHeight - s.height });
    x += s.width + margin;
  }
  return renderPage(x, rowHeight + captionBand + pageNumberBand + margin * 2, placements, page);
}

function captionedDiff(diff: Bitmap, pallet: Pallet, counts: DiffCounts): Captioned {
  return {
    image: diff,
    caption: [
      { label: `Addition: ${counts.addition}`, color: pallet.addition },
      { label: `Deletion: ${counts.deletion}`, color: pallet.deletion },
      { label: `Modification: ${counts.modification}`, color: pallet.modification },
    ],
  };
}

export function renderDiffPage(
  diff: Bitmap,
  pallet: Pallet,
  counts: DiffCounts,
  page: PageNumber,
  dpi: number,
) {
  return renderRow([captionedDiff(diff, pallet, counts)], page, dpi);
}

export type NamedBitmap = {
  image: Bitmap;
  name: string;
};

export function renderSideBySidePage(
  { a, b, diff }: { a: NamedBitmap; b: NamedBitmap; diff: Bitmap },
  pallet: Pallet,
  counts: DiffCounts,
  page: PageNumber,
  dpi: number,
) {
  return renderRow(
    [
      { image: a.image, caption: [{ label: a.name, color: null }] },
      { image: b.image, caption: [{ label: b.name, color: null }] },
      captionedDiff(diff, pallet, counts),
    ],
    page,
    dpi,
  );
}

type PdfwriteWorker = WorkerHandle<PdfwriteMessage, PdfMessage>;

async function pdfwrite(
  worker: PdfwriteWorker,
  job: PdfwriteJob,
): Promise<Uint8Array<ArrayBuffer>> {
  const inputFiles: Record<string, ArrayBuffer> = {};
  for (const [name, bytes] of Object.entries(job.inputFiles)) {
    inputFiles[name] =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : sliceBackingBuffer(bytes);
  }
  const msg: PdfwriteMessage = { type: "pdfwrite", args: job.args, inputFiles };
  const { data } = await worker.request<PdfMessage>(msg, Object.values(inputFiles));
  return new Uint8Array(data);
}

class PdfwritePool {
  private readonly concurrency: number;
  private readonly workers: PdfwriteWorker[] = [];
  private readonly idle: PdfwriteWorker[] = [];
  private readonly waiting: Array<(w: PdfwriteWorker) => void> = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  acquire(): Promise<PdfwriteWorker> {
    const idle = this.idle.pop();
    if (idle) return Promise.resolve(idle);
    if (this.workers.length < this.concurrency) {
      const w: PdfwriteWorker = new WorkerHandle(workerUrl("pdfwrite-worker"));
      this.workers.push(w);
      return Promise.resolve(w);
    }
    return new Promise<PdfwriteWorker>((resolve) => this.waiting.push(resolve));
  }

  release(w: PdfwriteWorker) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  terminate() {
    for (const w of this.workers) w.terminate();
  }
}

export class PdfBuilder {
  private readonly pool: PdfwritePool;
  private readonly pages: Promise<Uint8Array<ArrayBuffer>>[] = [];

  constructor(concurrency: number) {
    this.pool = new PdfwritePool(concurrency);
  }

  async add(render: () => PdfwriteJob | Promise<PdfwriteJob>) {
    const worker = await this.pool.acquire();
    const page = (async () => {
      try {
        return await pdfwrite(worker, await render());
      } finally {
        this.pool.release(worker);
      }
    })();
    page.catch(() => {});
    this.pages.push(page);
  }

  async finish(): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      const pdfs = await Promise.all(this.pages);
      if (pdfs.length === 0) {
        return null;
      }
      const span = perf.span("pdfwrite.merge_ms");
      const pdf = mergePdfs(pdfs);
      span.stop();
      return pdf;
    } finally {
      this.pool.terminate();
    }
  }
}
