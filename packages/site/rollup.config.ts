import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "rollup";
import copy from "rollup-plugin-copy";

const resolve = (id: string) => fileURLToPath(import.meta.resolve(id));
const resolveFromPdfdiff = createRequire(
  import.meta.resolve("@u1f992/pdfdiff/package.json"),
).resolve;

const contentHash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);

const gsJs = resolveFromPdfdiff("@u1f992/gs-wasm/dist/gs.js");

const workerAssets = {
  "core.wasm": resolve("@u1f992/pdfdiff/dist/wasm/core.wasm"),
  "squoosh_png_bg.wasm": resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"),
  "gs.wasm": resolveFromPdfdiff("@u1f992/gs-wasm/dist/gs.wasm"),
};

const browserAssets = {
  "worker.js": "dist/worker.js",
  "pdfwrite-worker.js": "dist/pdfwrite-worker.js",
};

const assetVersionsModule = resolve("@u1f992/pdfdiff/dist/asset-versions.js");

function assetVersions(files: Record<string, string>): Plugin {
  return {
    name: "asset-versions",
    load(id) {
      if (id !== assetVersionsModule) return null;
      const versions = Object.fromEntries(
        Object.entries(files).map(([name, file]) => [name, contentHash(file)]),
      );
      return `export const assetVersions = ${JSON.stringify(versions)};`;
    },
  };
}

function indexHtml(): Plugin {
  return {
    name: "index-html",
    writeBundle() {
      const html = readFileSync("src/index.html", "utf-8").replace(
        'src="./browser.js"',
        `src="./browser.js?v=${contentHash("dist/browser.js")}"`,
      );
      writeFileSync("dist/index.html", html);
    },
  };
}

const plugins = [
  nodeResolve({ exportConditions: ["browser"] }),
  commonjs(),
  copy({
    targets: [
      {
        src: resolve("@u1f992/pdfdiff/dist/wasm/core.wasm"),
        dest: "dist",
      },
      {
        src: resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"),
        dest: "dist",
      },
      {
        src: [gsJs, resolveFromPdfdiff("@u1f992/gs-wasm/dist/gs.wasm")],
        dest: "dist/gs-wasm",
      },
    ],
  }),
];

// gs-wasm is kept external (not bundled): the browser bundles load it from the
// copied dist/gs-wasm/ folder.
const GS_WASM = "@u1f992/gs-wasm";
const gsWasmPaths = { [GS_WASM]: `./gs-wasm/gs.js?v=${contentHash(gsJs)}` };

const workerBundle = (name: string) =>
  defineConfig({
    input: resolve(`@u1f992/pdfdiff/dist/${name}.js`),
    external: [GS_WASM],
    output: {
      file: `dist/${name}.js`,
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins: [assetVersions(workerAssets), ...plugins],
  });

const rollupConfig = defineConfig([
  workerBundle("worker"),
  workerBundle("pdfwrite-worker"),
  {
    input: "build/browser.js",
    output: {
      file: "dist/browser.js",
      sourcemap: true,
    },
    plugins: [assetVersions({ ...workerAssets, ...browserAssets }), ...plugins, indexHtml()],
  },
]);

export default rollupConfig;
