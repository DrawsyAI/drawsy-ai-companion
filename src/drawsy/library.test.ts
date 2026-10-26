import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasLibraryRequest } from "./protocol.js";

test("library requests normalize public catalog access and enforce bounds", () => {
  assert.deepEqual(
    parseCanvasLibraryRequest({
      action: "search",
      query: " network ",
      limit: 50,
    }),
    { action: "search", query: "network", source: "public", limit: 50 }
  );
  assert.deepEqual(
    parseCanvasLibraryRequest({ action: "read", packId: "pack" }),
    { action: "read", source: "public", packId: "pack" }
  );
  const valid = {
    action: "insert",
    source: "public",
    packId: "pack",
    itemId: "item",
    x: -1000000,
    y: 1000000,
    operationId: "op",
  };
  assert.deepEqual(parseCanvasLibraryRequest(valid), valid);
  for (const input of [
    null,
    {},
    { action: "search", source: "personal" },
    { action: "search", limit: 51 },
    { action: "search", limit: 1.5 },
    { action: "read" },
    { ...valid, x: Infinity },
    { ...valid, y: 1000001 },
    { ...valid, operationId: "" },
    { ...valid, itemId: "" },
  ]) {
    assert.throws(() => parseCanvasLibraryRequest(input));
  }
});
