/*
 * Copyright (C) 2025  Koutaro Mukai
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
