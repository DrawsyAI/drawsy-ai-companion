import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePiBinary } from "./pi-binary.js";

test("Pi binary honors the Drawsy executable override", () => {
  const previous = process.env.DRAWSY_PI_BIN;
  process.env.DRAWSY_PI_BIN = "/custom/bin/pi";
  try {
    assert.equal(resolvePiBinary(), "/custom/bin/pi");
  } finally {
    if (previous === undefined) delete process.env.DRAWSY_PI_BIN;
    else process.env.DRAWSY_PI_BIN = previous;
  }
});
