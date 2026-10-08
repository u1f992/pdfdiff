import assert from "assert";
import test from "node:test";

import { withIndex } from "../src/iterable.ts";

void test("withIndex", async () => {
  assert.deepStrictEqual(
    // @ts-ignore
    await Array.fromAsync(
      withIndex(
        (async function* () {
          yield "a";
          yield "b";
        })(),
        0,
      ),
    ),
    [
      [0, "a"],
      [1, "b"],
    ],
  );
});
