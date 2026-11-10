import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCanvasControlRequest } from "./protocol.js";

test("Draw library placement uses the public library contract", () => {
  const placement = {
    action: "insert_library",
    packId: "sample-pack",
    itemId: "sample-item",
    operationId: "place-item",
    x: 40,
    y: 80
  };
  assert.deepEqual(parseCanvasControlRequest(placement), {
    ...placement,
    source: "public"
  });
  assert.throws(() => parseCanvasControlRequest({ ...placement, x: Infinity }));
  assert.throws(() => parseCanvasControlRequest({ ...placement, source: "private" }));
  assert.throws(() => parseCanvasControlRequest({ ...placement, extra: true }));
});

test("Draw shape variants require the rectangle tool", () => {
  const request = { action: "set_tool", tool: "rectangle", shapeKind: "triangle" };
  assert.deepEqual(parseCanvasControlRequest(request), request);
  assert.throws(() => parseCanvasControlRequest({ ...request, tool: "ellipse" }));
});

test("Draw erasers validate exact targets and native brush sizes", () => {
  const object = { action: "erase_objects", elementIds: ["arrow"] };
  const area = { action: "set_eraser", mode: "area", size: 24 };
  assert.deepEqual(parseCanvasControlRequest(object), object);
  assert.deepEqual(parseCanvasControlRequest(area), area);
  assert.throws(() => parseCanvasControlRequest({ ...object, elementIds: ["arrow", "arrow"] }));
  assert.throws(() => parseCanvasControlRequest({ ...area, mode: "object" }));
  assert.throws(() => parseCanvasControlRequest({ ...area, size: 65 }));
});

test("Draw validates a scoped area eraser path and native arrow settings", () => {
  const eraser = {
    action: "erase_area", elementIds: ["box"], size: 24, points: [[0, 0], [20, 30]]
  };
  const arrow = { action: "set_arrow_type", arrowType: "elbow" };
  const head = { action: "set_arrowhead", end: "start", arrowhead: null };
  assert.deepEqual(parseCanvasControlRequest(eraser), eraser);
  assert.deepEqual(parseCanvasControlRequest(arrow), arrow);
  assert.deepEqual(parseCanvasControlRequest(head), head);
  assert.throws(() => parseCanvasControlRequest({ ...eraser, elementIds: [] }));
  assert.throws(() => parseCanvasControlRequest({ ...eraser, points: [[0, 0]] }));
  assert.throws(() => parseCanvasControlRequest({ ...head, end: "middle" }));
});

test("Draw working viewport validates zoom and scene center", () => {
  const request = { action: "set_viewport", zoom: 0.1, center: [-200, 40] };
  assert.deepEqual(parseCanvasControlRequest(request), request);
  assert.throws(() => parseCanvasControlRequest({ ...request, zoom: 0 }));
  assert.throws(() => parseCanvasControlRequest({ ...request, center: [Infinity, 40] }));
});
