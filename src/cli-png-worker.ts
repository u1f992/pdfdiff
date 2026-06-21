import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import encode, { init } from "@jsquash/png/encode";

export type EncodeJob = {
  width: number;
  height: number;
  data: ArrayBuffer;
  path: string;
};

export type EncodeReply = { ok: true } | { ok: false; error: string };

const wasmPath = fileURLToPath(
  new URL("./squoosh_png_bg.wasm", import.meta.url),
);
await init(fs.readFileSync(wasmPath));

if (!parentPort) {
  throw new Error("cli-png-worker must be run as a worker_threads worker");
}

const port = parentPort;

port.on("message", async (job: EncodeJob) => {
  try {
    const png = await encode(
      new ImageData(new Uint8ClampedArray(job.data), job.width, job.height),
    );
    fs.writeFileSync(job.path, new Uint8Array(png));
    const reply: EncodeReply = { ok: true };
    port.postMessage(reply);
  } catch (e) {
    const reply: EncodeReply = {
      ok: false,
      error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    };
    port.postMessage(reply);
  }
});
