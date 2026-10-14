import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "rollup";
import copy from "rollup-plugin-copy";

const resolve = (id: string) => fileURLToPath(import.meta.resolve(id));
const resolveFromPdfdiff = createRequire(
  import.meta.resolve("@u1f992/pdfdiff/package.json"),
).resolve;

const plugins = [
  nodeResolve({ exportConditions: ["browser"] }),
  commonjs(),
  copy({
    targets: [
      {
        src: "src/index.html",
        dest: "dist",
      },
      {
        src: resolve("@u1f992/pdfdiff/dist/wasm/core.wasm"),
        dest: "dist",
      },
      {
        src: resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"),
        dest: "dist",
      },
      {
        src: [
          resolveFromPdfdiff("@u1f992/gs-wasm/dist/gs.js"),
          resolveFromPdfdiff("@u1f992/gs-wasm/dist/gs.wasm"),
        ],
        dest: "dist/gs-wasm",
      },
    ],
  }),
];

// gs-wasm is kept external (not bundled): the browser bundles load it from the
// copied dist/gs-wasm/ folder.
const GS_WASM = "@u1f992/gs-wasm";
const gsWasmPaths = { [GS_WASM]: "./gs-wasm/gs.js" };

const workerBundle = (name: string) =>
  defineConfig({
    input: resolve(`@u1f992/pdfdiff/dist/${name}.js`),
    external: [GS_WASM],
    output: {
      file: `dist/${name}.js`,
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins,
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
    plugins,
  },
]);

export default rollupConfig;
