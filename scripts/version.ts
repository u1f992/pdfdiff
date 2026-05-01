import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = JSON.parse(readFileSync("package.json", "utf-8")).version;

let suffix = "";
try {
  execSync(`git describe --tags --match "v${version}" --exact-match`, {
    stdio: "ignore",
  });
} catch {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
    }).trim();
    suffix = `+${hash}`;
  } catch {
    // not in a git repo
  }
}

try {
  const dirty = execSync("git status --porcelain", {
    encoding: "utf-8",
  }).trim();
  if (dirty) {
    suffix += ".dirty";
  }
} catch {
  // not in a git repo
}

const full = version + suffix;
writeFileSync("src/version.ts", `export const VERSION = "${full}";\n`, "utf-8");
console.log(full);
