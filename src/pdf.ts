import createModule, { type Instance, type MainModule } from "@u1f992/gs-wasm";

import { locateVersioned } from "./assets.ts";
import { gsCall } from "./gs.ts";
import { perf } from "./perf.ts";

const INPUT_DIR = "/input";
const OUTPUT_DIR = "/output";

export type DocumentName = "a" | "b" | "mask";

export class PdfRenderer {
  private readonly gs: MainModule;
  private readonly instance: Instance;
  private readonly takeOutput: () => string;

  private constructor(gs: MainModule, instance: Instance, takeOutput: () => string) {
    this.gs = gs;
    this.instance = instance;
    this.takeOutput = takeOutput;
  }

  static async create(
    documents: Partial<Record<DocumentName, Uint8Array>>,
    dpi: number,
    alpha: boolean,
  ): Promise<PdfRenderer> {
    const sLoad = perf.span("pdf.loadModule_ms");
    const gs = await createModule({ locateFile: locateVersioned });
    sLoad.stop();

    gs.FS.mkdir(INPUT_DIR);
    gs.FS.mkdir(OUTPUT_DIR);
    for (const [name, bytes] of Object.entries(documents)) {
      gs.FS.writeFile(inputPath(name as DocumentName), bytes);
    }

    const decoder = new TextDecoder();
    let output = "";
    const capture = (buf: Uint8Array) => {
      output += decoder.decode(buf, { stream: true });
      return buf.length;
    };
    const takeOutput = () => {
      const text = output;
      output = "";
      return text;
    };

    const instance = new gs.Instance();
    instance.setStdio(null, capture, capture);
    const sInit = perf.span("pdf.gsInit_ms");
    const code = await gsCall(() =>
      instance.initWithArgs([
        "gs",
        "-dQUIET",
        "-dNOPAUSE",
        `--permit-file-read=${INPUT_DIR}/`,
        `-sDEVICE=${alpha ? "pngalpha" : "png16m"}`,
        `-r${dpi}`,
        "-dTextAlphaBits=4",
        "-dGraphicsAlphaBits=4",
        `-sOutputFile=${OUTPUT_DIR}/%d.png`,
      ]),
    );
    sInit.stop();
    if (code !== 0) {
      instance.delete();
      throw new Error(`gs init failed (code ${code})\n${takeOutput()}`);
    }
    const renderer = new PdfRenderer(gs, instance, takeOutput);
    try {
      const sOpen = perf.span("pdf.openDocuments_ms");
      for (const name of Object.keys(documents) as DocumentName[]) {
        await renderer.run(
          `(${inputPath(name)}) (r) file runpdfbegin currentdict end /${documentDict(name)} exch def`,
          `open(${name})`,
        );
      }
      sOpen.stop();
    } catch (error) {
      renderer.delete();
      throw error;
    }
    return renderer;
  }

  async countPages(name: DocumentName): Promise<number> {
    const span = perf.span("pdf.countPages_ms");
    const text = await this.run(
      `${documentDict(name)} begin pdfpagecount end = flush`,
      `countPages(${name})`,
    );
    span.stop();
    const n = Number.parseInt(text.trim(), 10);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`gs countPages(${name}): unexpected output ${JSON.stringify(text)}`);
    }
    return n;
  }

  async renderPage(name: DocumentName, index: number): Promise<Uint8Array<ArrayBuffer>> {
    const span = perf.span("pdf.gsRender_ms");
    const page = index + 1;
    const output = await this.run(
      `${documentDict(name)} begin ${page} pdfgetpage pdfshowpage end`,
      `render(${name}, page ${page})`,
    );
    span.stop();
    const files = this.listOutputFiles();
    if (files.length !== 1) {
      throw new Error(
        `gs render(${name}, page ${page}) produced ${files.length} files, expected 1\n${output}`,
      );
    }
    const path = `${OUTPUT_DIR}/${files[0]}`;
    const png = this.gs.FS.readFile(path) as Uint8Array<ArrayBuffer>;
    this.gs.FS.unlink(path);
    perf.incr("pdf.pagesRendered");
    return png;
  }

  delete() {
    this.instance.delete();
  }

  private async run(program: string, what: string): Promise<string> {
    const { code } = await this.instance.runString(program, 0);
    const output = this.takeOutput();
    if (code !== 0) {
      throw new Error(`gs ${what} failed (code ${code})\n${output}`);
    }
    return output;
  }

  private listOutputFiles(): string[] {
    return (this.gs.FS.readdir(OUTPUT_DIR) as string[]).filter((entry) => !entry.startsWith("."));
  }
}

function inputPath(name: DocumentName): string {
  return `${INPUT_DIR}/${name}.pdf`;
}

function documentDict(name: DocumentName): string {
  return `pdfdiff_${name}`;
}
