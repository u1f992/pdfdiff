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
        src: "node_modules/mupdf/dist/mupdf-wasm.wasm",
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
    ],
  }),
];

const rollupConfig = defineConfig([
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      sourcemap: true,
    },
    plugins: [
      alias({
        entries: [
          {
            find: "jimp",
            replacement: path.resolve(
              "node_modules/jimp/dist/browser/index.js",
            ),
          },
          {
            find: "web-worker",
            replacement: path.resolve(
              "node_modules/web-worker/dist/browser/index.cjs",
            ),
          },
        ],
      }),
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
      alias({
        entries: [
          {
            find: "jimp",
            replacement: path.resolve(
              "node_modules/jimp/dist/browser/index.js",
            ),
          },
        ],
      }),
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
    plugins: [
      typescript({ tsconfig: "./tsconfig.json" }),
      nodeResolve(),
      commonjs(),
    ],
  },
  {
    input: "src/browser.ts",
    output: {
      file: "dist/browser.js",
      sourcemap: true,
    },
    plugins: [
      alias({
        entries: [
          {
            find: "jimp",
            replacement: path.resolve(
              "node_modules/jimp/dist/browser/index.js",
            ),
          },
          {
            find: "web-worker",
            replacement: path.resolve(
              "node_modules/web-worker/dist/browser/index.cjs",
            ),
          },
        ],
      }),
      typescript({ tsconfig: "./tsconfig.json" }),
      ...plugins,
    ],
  },
]);

export default rollupConfig;
