import alias from "@rollup/plugin-alias";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import path from "node:path";
import { defineConfig } from "rollup";
import copy from "rollup-plugin-copy";

const plugins = [
  nodeResolve(),
  commonjs(),
  copy({
    targets: [
      {
        src: "node_modules/coi-serviceworker/coi-serviceworker.min.js",
        dest: "site",
      },
      {
        src: "src/index.html",
        dest: "site",
      },
      {
        src: "src/style.css",
        dest: "site",
      },
      {
        src: "src/wasm/core.wasm",
        dest: "site",
      },
      {
        src: "node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
        dest: "site",
      },
      // Ghostscript (gs-wasm) Emscripten glue + binary. The `index.js`/
      // `worker.js` ESM wrappers are re-bundled (below) into site/gs-wasm/ so
      // their bare imports (`web-worker`, `upath`) resolve in the browser; the
      // large glue is shipped as-is and imported as a sibling by worker.js.
      {
        src: [
          "node_modules/@u1f992/gs-wasm/dist/gs.js",
          "node_modules/@u1f992/gs-wasm/dist/gs.wasm",
        ],
        dest: "site/gs-wasm",
      },
    ],
  }),
];

// gs-wasm is kept external (not bundled): the browser bundles load it from the
// copied site/gs-wasm/ folder.
const GS_WASM = "@u1f992/gs-wasm";
const gsWasmPaths = { [GS_WASM]: "./gs-wasm/index.js" };

const jimpAlias = alias({
  entries: [
    {
      find: "jimp",
      replacement: path.resolve("node_modules/jimp/dist/browser/index.js"),
    },
  ],
});

const webWorkerAlias = alias({
  entries: [
    {
      find: "web-worker",
      replacement: path.resolve(
        "node_modules/web-worker/dist/browser/index.cjs",
      ),
    },
  ],
});

// gs-wasm's worker depends on `upath`, which imports node's `path`. Shim it for
// the browser.
const pathAlias = alias({
  entries: [
    {
      find: "path",
      replacement: path.resolve("node_modules/path-browserify/index.js"),
    },
  ],
});

const rollupConfig = defineConfig([
  {
    input: "dist/worker.js",
    output: {
      file: "site/worker.js",
      sourcemap: true,
    },
    plugins: [jimpAlias, ...plugins],
  },
  {
    input: "dist/browser.js",
    external: [GS_WASM],
    output: {
      file: "site/browser.js",
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins: [jimpAlias, webWorkerAlias, ...plugins],
  },
  // Re-bundle gs-wasm's ESM wrappers into site/gs-wasm/ with their bare
  // dependencies resolved, so the browser can load them as plain static files.
  // The main-thread wrapper spawns ./worker.js (sibling) via new URL(...).
  {
    input: "node_modules/@u1f992/gs-wasm/dist/index.js",
    output: {
      file: "site/gs-wasm/index.js",
      format: "es",
      sourcemap: true,
    },
    plugins: [webWorkerAlias, nodeResolve(), commonjs()],
  },
  // The worker wrapper imports the (large) emscripten glue as a sibling
  // ./gs.js, which is copied verbatim; everything else (upath, status) is
  // bundled in.
  {
    input: "node_modules/@u1f992/gs-wasm/dist/worker.js",
    external: (id) => id === "./gs.js" || id.endsWith("/gs.js"),
    output: {
      file: "site/gs-wasm/worker.js",
      format: "es",
      sourcemap: true,
      paths: { "./gs.js": "./gs.js" },
    },
    plugins: [pathAlias, nodeResolve(), commonjs()],
  },
]);

export default rollupConfig;
