import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test("cli pins counts for fixtures at dpi 300", async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfdiff-cli-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const { stdout } = await promisify(execFile)(process.execPath, [
    cli,
    fixture("a.pdf"),
    fixture("b.pdf"),
    outDir,
    "--mask",
    fixture("mask.pdf"),
    "--dpi",
    "300",
  ]);

  assert.equal(
    stdout,
    "Page 1, Addition: 7500, Deletion: 7500, Modification: 7500\n",
  );
  assert.deepEqual(fs.readdirSync(path.join(outDir, "1")).sort(), [
    "a.png",
    "b.png",
    "diff.png",
  ]);
});
