import assert from "node:assert/strict";
import test from "node:test";

import { inspectCanvasImage } from "./image-asset.js";

test("image inspection detects supported raster formats and dimensions", () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(360, 20);
  assert.deepEqual(inspectCanvasImage(png), {
    mimeType: "image/png",
    width: 640,
    height: 360,
  });

  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(320, 6);
  gif.writeUInt16LE(180, 8);
  assert.deepEqual(inspectCanvasImage(gif), {
    mimeType: "image/gif",
    width: 320,
    height: 180,
  });

  const jpeg = Buffer.alloc(21);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0]).copy(jpeg);
  jpeg.writeUInt16BE(17, 4);
  jpeg[6] = 8;
  jpeg.writeUInt16BE(720, 7);
  jpeg.writeUInt16BE(1280, 9);
  assert.deepEqual(inspectCanvasImage(jpeg), {
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
  });

  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  webp.write("VP8X", 12, "ascii");
  webp.writeUIntLE(799, 24, 3);
  webp.writeUIntLE(449, 27, 3);
  assert.deepEqual(inspectCanvasImage(webp), {
    mimeType: "image/webp",
    width: 800,
    height: 450,
  });
});

test("image inspection rejects non-raster payloads", () => {
  assert.throws(
    () => inspectCanvasImage(Buffer.from("<svg></svg>")),
    /Only PNG, JPEG, GIF, and WebP/
  );
});
