#!/usr/bin/env node

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
    alpha: alpha_,
    mask: mask_,
    align: align_,
    "addition-color": additionColorHex,
    "deletion-color": deletionColorHex,
    "modification-color": modificationColorHex,
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

const pdfA = fs.readFileSync(path.resolve(positionals[0]!));
const pdfB = fs.readFileSync(path.resolve(positionals[1]!));
const outDir = path.resolve(positionals[2]!);

const dpi =
  typeof dpi_ !== "undefined" ? parseInt(dpi_, 10) : defaultOptions.dpi;
if (Number.isNaN(dpi)) {
  throw new Error("Invalid DPI value");
}

const alpha = alpha_ ?? defaultOptions.alpha;

const pdfMask =
  typeof mask_ !== "undefined"
    ? fs.readFileSync(path.resolve(mask_))
    : undefined;

const align = align_ ?? defaultOptions.align;
if (!isValidAlignStrategy(align)) {
  throw new Error(`Invalid alignment strategy`);
}

const additionColor =
  typeof additionColorHex !== "undefined"
    ? parseHex(additionColorHex)
    : defaultOptions.pallet.addition;
const deletionColor =
  typeof deletionColorHex !== "undefined"
    ? parseHex(deletionColorHex)
    : defaultOptions.pallet.deletion;
const modificationColor =
  typeof modificationColorHex !== "undefined"
    ? parseHex(modificationColorHex)
    : defaultOptions.pallet.modification;
if (
  additionColor === null ||
  deletionColor === null ||
  modificationColor === null
) {
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
    pallet: {
      addition: additionColor,
      deletion: deletionColor,
      modification: modificationColor,
    },
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
