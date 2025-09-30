#!/usr/bin/env node
// @ts-check

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
import path from "node:path";
import util from "node:util";

import {
  isValidAlignStrategy,
  defaultOptions,
  withIndex,
  parseHex,
  formatHex,
  visualizeDifferences,
} from "./index.js";

const {
  positionals,
  values: {
    dpi: dpi_,
    alpha,
    mask: mask_,
    align,
    "addition-color": additionColor,
    "deletion-color": deletionColor,
    "modification-color": modificationColor,
    version,
    help,
  },
} = util.parseArgs({
  allowPositionals: true,
  options: {
    dpi: { type: "string" },
    alpha: { type: "boolean" },
    mask: { type: "string" },
    align: { type: "string" },
    "addition-color": { type: "string" },
    "deletion-color": { type: "string" },
    "modification-color": { type: "string" },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
});

if (help) {
  console.log(`USAGE:
    pdfdiff <A> <B> <OUTDIR> [OPTIONS]

OPTIONS:
    --dpi <DPI>                    default: ${defaultOptions.dpi}
    --alpha                        default: ${defaultOptions.alpha}
    --mask <PATH>                  default: ${defaultOptions.mask}
    --align <resize | top-left | top-center | top-right
             | middle-left | middle-center | middle-right
             | bottom-left | bottom-center | bottom-right>    default: ${defaultOptions.align}
    --addition-color <#HEX>        default: ${formatHex(defaultOptions.pallet.addition)}
    --deletion-color <#HEX>        default: ${formatHex(defaultOptions.pallet.deletion)}
    --modification-color <#HEX>    default: ${formatHex(defaultOptions.pallet.modification)}
    -v, --version
    -h, --help
`);
  process.exit(0);
}
if (version) {
  try {
    const versionStr = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), {
        encoding: "utf-8",
      }),
    ).version;
    console.log(versionStr);
  } catch {
    console.log("unknown");
  }
  process.exit(0);
}

if (positionals.length !== 3) {
  throw new Error("Expected 3 positional arguments: <A> <B> <OUTDIR>");
}
const [pdfA, pdfB] = positionals
  .slice(0, 2)
  .map((s) => new Uint8Array(fs.readFileSync(path.resolve(s))));
const outDir = path.resolve(positionals[2]);

const dpi = typeof dpi_ !== "undefined" ? parseInt(dpi_, 10) : undefined;
if (typeof dpi !== "undefined" && Number.isNaN(dpi)) {
  throw new Error("Invalid DPI value");
}

const pdfMask =
  typeof mask_ !== "undefined"
    ? new Uint8Array(fs.readFileSync(path.resolve(mask_)))
    : undefined;

if (typeof align !== "undefined" && !isValidAlignStrategy(align)) {
  throw new Error(`Invalid alignment strategy`);
}

const addition =
  typeof additionColor !== "undefined" ? parseHex(additionColor) : undefined;
const deletion =
  typeof deletionColor !== "undefined" ? parseHex(deletionColor) : undefined;
const modification =
  typeof modificationColor !== "undefined"
    ? parseHex(modificationColor)
    : undefined;
// NOTE: undefined !== null
if (addition === null || deletion === null || modification === null) {
  throw new Error("Invalid color format");
}

fs.mkdirSync(outDir, { recursive: true });
for await (const [
  i,
  { a, b, diff, addition, deletion, modification },
] of withIndex(
  visualizeDifferences(pdfA, pdfB, {
    dpi,
    alpha,
    mask: pdfMask,
    align,
  }),
  1,
)) {
  console.log(
    `Page ${i}, Addition: ${addition.length}, Deletion: ${deletion.length}, Modification: ${modification.length}`,
  );
  const dir = path.join(outDir, i.toString(10));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "a.png"),
    new Uint8Array(await a.getBuffer("image/png")),
  );
  fs.writeFileSync(
    path.join(dir, "b.png"),
    new Uint8Array(await b.getBuffer("image/png")),
  );
  fs.writeFileSync(
    path.join(dir, "diff.png"),
    new Uint8Array(await diff.getBuffer("image/png")),
  );
}
