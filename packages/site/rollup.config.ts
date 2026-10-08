import alias from "@rollup/plugin-alias";
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

const browserResolve = () => nodeResolve({ exportConditions: ["browser"] });

const plugins = [
  browserResolve(),
  commonjs(),
  copy({
    targets: [
      {
        src: resolve("coi-serviceworker/coi-serviceworker.min.js"),
        dest: "dist",
      },
      {
        src: "src/index.html",
        dest: "dist",
      },
      {
        src: "src/style.css",
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
      // Ghostscript (gs-wasm) Emscripten glue + binary. The `index.js`/
      // `worker.js` ESM wrappers are re-bundled (below) into dist/gs-wasm/ so
      // their bare imports (`web-worker`, `upath`) resolve in the browser; the
      // large glue is shipped as-is and imported as a sibling by worker.js.
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
const gsWasmPaths = { [GS_WASM]: "./gs-wasm/index.js" };

// gs-wasm's worker depends on `upath`, which imports node's `path`. Shim it for
// the browser.
const pathAlias = alias({
  entries: [
    {
      find: "path",
      replacement: "path-browserify",
    },
  ],
});

const rollupConfig = defineConfig([
  {
    input: resolve("@u1f992/pdfdiff/dist/worker.js"),
    output: {
      file: "dist/worker.js",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "build/browser.js",
    external: [GS_WASM],
    output: {
      file: "dist/browser.js",
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins,
  },
  // Re-bundle gs-wasm's ESM wrappers into dist/gs-wasm/ with their bare
  // dependencies resolved, so the browser can load them as plain static files.
  // The main-thread wrapper spawns ./worker.js (sibling) via new URL(...).
  {
    input: resolveFromPdfdiff("@u1f992/gs-wasm/dist/index.js"),
    output: {
      file: "dist/gs-wasm/index.js",
      format: "es",
      sourcemap: true,
    },
    plugins: [browserResolve(), commonjs()],
  },
  // The worker wrapper imports the (large) emscripten glue as a sibling
  // ./gs.js, which is copied verbatim; everything else (upath, status) is
  // bundled in.
  {
    input: resolveFromPdfdiff("@u1f992/gs-wasm/dist/worker.js"),
    external: (id) => id === "./gs.js" || id.endsWith("/gs.js"),
    output: {
      file: "dist/gs-wasm/worker.js",
      format: "es",
      sourcemap: true,
      paths: { "./gs.js": "./gs.js" },
    },
    plugins: [pathAlias, browserResolve(), commonjs()],
  },
]);

export default rollupConfig;
