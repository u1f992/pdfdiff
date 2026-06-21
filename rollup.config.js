import alias from "@rollup/plugin-alias";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
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
        src: "src/wasm/core.wasm",
        dest: "dist",
      },
      // Ghostscript (gs-wasm) Emscripten glue + binary. The `index.js`/
      // `worker.js` ESM wrappers are re-bundled (below) into dist/gs-wasm/ so
      // their bare imports (`web-worker`, `upath`) resolve in the browser; the
      // large glue is shipped as-is and imported as a sibling by worker.js.
      {
        src: [
          "node_modules/@u1f992/gs-wasm/dist/gs.js",
          "node_modules/@u1f992/gs-wasm/dist/gs.wasm",
        ],
        dest: "dist/gs-wasm",
      },
    ],
  }),
];

// gs-wasm is kept external (not bundled): the CLI resolves it from node_modules,
// while the browser bundles load it from the copied dist/gs-wasm/ folder.
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
// the browser. Scoped to the gs-wasm worker bundle only so the Node CLI bundles
// keep the real `path`.
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
    input: "src/index.ts",
    external: [GS_WASM],
    output: {
      file: "dist/index.js",
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins: [
      jimpAlias,
      webWorkerAlias,
      typescript({ tsconfig: "./tsconfig.json" }),
      ...plugins,
    ],
  },
  {
    input: "src/worker.ts",
    output: {
      file: "dist/worker.js",
      sourcemap: true,
    },
    plugins: [
      jimpAlias,
      typescript({ tsconfig: "./tsconfig.json" }),
      ...plugins,
    ],
  },
  {
    input: "src/cli.ts",
    output: {
      file: "dist/cli.js",
      sourcemap: true,
    },
    external: ["web-worker", GS_WASM],
    plugins: [
      typescript({ tsconfig: "./tsconfig.json" }),
      nodeResolve(),
      commonjs(),
    ],
  },
  {
    input: "src/cli-png-worker.ts",
    output: {
      file: "dist/cli-png-worker.js",
      sourcemap: true,
    },
    plugins: [
      typescript({ tsconfig: "./tsconfig.json" }),
      nodeResolve(),
      commonjs(),
      copy({
        targets: [
          {
            src: "node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
            dest: "dist",
          },
        ],
      }),
    ],
  },
  {
    input: "src/browser.ts",
    external: [GS_WASM],
    output: {
      file: "dist/browser.js",
      sourcemap: true,
      paths: gsWasmPaths,
    },
    plugins: [
      jimpAlias,
      webWorkerAlias,
      typescript({ tsconfig: "./tsconfig.json" }),
      ...plugins,
    ],
  },
  // Re-bundle gs-wasm's ESM wrappers into dist/gs-wasm/ with their bare
  // dependencies resolved, so the browser can load them as plain static files.
  // The main-thread wrapper spawns ./worker.js (sibling) via new URL(...).
  {
    input: "node_modules/@u1f992/gs-wasm/dist/index.js",
    output: {
      file: "dist/gs-wasm/index.js",
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
      file: "dist/gs-wasm/worker.js",
      format: "es",
      sourcemap: true,
      paths: { "./gs.js": "./gs.js" },
    },
    plugins: [pathAlias, nodeResolve(), commonjs()],
  },
]);

export default rollupConfig;
