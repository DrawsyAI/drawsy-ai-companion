import assert from "node:assert/strict";
import test from "node:test";

import { resolveOmpBinary } from "./omp-binary.js";

test("OMP binary honors the Drawsy executable override", () => {
  const previous = process.env.DRAWSY_OMP_BIN;
  process.env.DRAWSY_OMP_BIN = "/custom/bin/omp";
  try {
    assert.equal(resolveOmpBinary(), "/custom/bin/omp");
  } finally {
    if (previous === undefined) delete process.env.DRAWSY_OMP_BIN;
    else process.env.DRAWSY_OMP_BIN = previous;
  }
});
