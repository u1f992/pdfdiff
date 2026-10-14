import createModule, { type MainModule } from "@u1f992/gs-wasm";

import { gsCall } from "./gs.ts";
import { perf } from "./perf.ts";
import type { ErrorMessage } from "./worker-handle.ts";

export type PdfwriteMessage = {
  type: "pdfwrite";
  args: string[];
  inputFiles: Record<string, ArrayBuffer>;
};

export type PdfMessage = {
  type: "pdf";
  data: ArrayBuffer;
};

const JOB_DIR = "/job";
const OUTPUT_NAME = "output.pdf";

const PDFWRITE_ARGS = [
  "gs",
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
  `-sOutputFile=${JOB_DIR}/${OUTPUT_NAME}`,
];

const gsModule: Promise<MainModule> = createModule().then((gs) => {
  gs.FS.mkdir(JOB_DIR);
  gs.FS.chdir(JOB_DIR);
  return gs;
});

function clearJobDir(gs: MainModule) {
  for (const entry of gs.FS.readdir(JOB_DIR) as string[]) {
    if (!entry.startsWith(".")) gs.FS.unlink(`${JOB_DIR}/${entry}`);
  }
}

async function pdfwrite(msg: PdfwriteMessage): Promise<Uint8Array<ArrayBuffer>> {
  const gs = await gsModule;
  for (const [name, bytes] of Object.entries(msg.inputFiles)) {
    gs.FS.writeFile(`${JOB_DIR}/${name}`, new Uint8Array(bytes));
  }
  const decoder = new TextDecoder();
  let output = "";
  const capture = (buf: Uint8Array) => {
    output += decoder.decode(buf, { stream: true });
    return buf.length;
  };
  const instance = new gs.Instance();
  try {
    instance.setStdio(null, capture, capture);
    const span = perf.span("pdfwrite.gs_ms");
    const code = await gsCall(() => instance.initWithArgs([...PDFWRITE_ARGS, ...msg.args]));
    const exitCode = await gsCall(() => instance.exit());
    span.stop();
    if ((code !== 0 && code !== gs.gs_error_Quit) || exitCode !== 0) {
      throw new Error(`gs pdfwrite failed (code ${code}, exit ${exitCode})\n${output}`);
    }
    try {
      return gs.FS.readFile(`${JOB_DIR}/${OUTPUT_NAME}`) as Uint8Array<ArrayBuffer>;
    } catch {
      throw new Error(`gs pdfwrite produced no output\n${output}`);
    }
  } finally {
    instance.delete();
    clearJobDir(gs);
  }
}

self.addEventListener("message", async (e: MessageEvent<PdfwriteMessage>) => {
  try {
    const pdf = await pdfwrite(e.data);
    const reply: PdfMessage = { type: "pdf", data: pdf.buffer };
    self.postMessage(reply, [pdf.buffer]);
  } catch (err) {
    const reply: ErrorMessage = {
      type: "error",
      message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    };
    self.postMessage(reply);
  }
});
