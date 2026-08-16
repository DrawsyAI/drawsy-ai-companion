import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  MAX_CANVAS_ASSET_BYTES,
  type CanvasFile,
  type JsonObject,
} from "./protocol.js";

type ImageMetadata = {
  mimeType: CanvasFile["mimeType"];
  width: number;
  height: number;
};

const uint24LE = (buffer: Buffer, offset: number) =>
  buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);

const jpegDimensions = (buffer: Buffer) => {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd8) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  throw new Error("The JPEG dimensions could not be read.");
};

const webpDimensions = (buffer: Buffer) => {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: uint24LE(buffer, 24) + 1,
      height: uint24LE(buffer, 27) + 1,
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new Error("The WebP dimensions could not be read.");
};

export const inspectCanvasImage = (buffer: Buffer): ImageMetadata => {
  let metadata: ImageMetadata;
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    metadata = {
      mimeType: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } else if (
    buffer.length >= 10 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" ||
      buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    metadata = {
      mimeType: "image/gif",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  } else if (
    buffer.length >= 12 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    metadata = { mimeType: "image/jpeg", ...jpegDimensions(buffer) };
  } else if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    metadata = { mimeType: "image/webp", ...webpDimensions(buffer) };
  } else {
    throw new Error("Only PNG, JPEG, GIF, and WebP images can be added.");
  }
  if (
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error("The image has invalid dimensions.");
  }
  return metadata;
};

const workspaceFile = async (workspaceRoot: string, sourcePath: string) => {
  const root = await realpath(workspaceRoot);
  const candidate = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(root, sourcePath);
  const resolved = await realpath(candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The image must be inside the selected folder.");
  }
  const details = await stat(resolved);
  if (!details.isFile()) {
    throw new Error("The image source must be a file.");
  }
  if (details.size <= 0 || details.size > MAX_CANVAS_ASSET_BYTES) {
    throw new Error(
      `The image must be between 1 byte and ${
        MAX_CANVAS_ASSET_BYTES / (1024 * 1024)
      } MiB.`
    );
  }
  return resolved;
};

export const createCanvasImageAsset = async (input: {
  workspaceRoot: string;
  sourcePath: string;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight?: number;
  elementId?: string;
  frameId?: string | null;
}) => {
  const sourcePath = await workspaceFile(input.workspaceRoot, input.sourcePath);
  const bytes = await readFile(sourcePath);
  return createCanvasImageAssetFromBytes({
    ...input,
    bytes,
    sourceName: path.basename(sourcePath),
  });
};

export const createCanvasImageAssetFromBytes = (input: {
  bytes: Buffer;
  sourceName: string;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight?: number;
  elementId?: string;
  frameId?: string | null;
}) => {
  const { bytes } = input;
  if (bytes.length > MAX_CANVAS_ASSET_BYTES) {
    throw new Error(
      `The image exceeds ${MAX_CANVAS_ASSET_BYTES / (1024 * 1024)} MiB.`
    );
  }
  const { file, metadata } = createCanvasImageFileFromBytes(bytes);
  const scale = Math.min(
    input.maxWidth / metadata.width,
    input.maxHeight === undefined
      ? Number.POSITIVE_INFINITY
      : input.maxHeight / metadata.height
  );
  const width = Math.max(1, Number((metadata.width * scale).toFixed(2)));
  const height = Math.max(1, Number((metadata.height * scale).toFixed(2)));
  const fileId = file.id;
  const elementId = input.elementId || randomUUID();
  const element: JsonObject = {
    id: elementId,
    type: "image",
    x: input.x,
    y: input.y,
    width,
    height,
    fileId,
    status: "pending",
    scale: [1, 1],
    crop: null,
    frameId: input.frameId ?? null,
    customData: {
      drawsy: {
        assetSource: "local-file",
        sourceName: path.basename(input.sourceName),
      },
    },
  };
  return { file, element, width, height, fileId, elementId };
};

export const createCanvasImageFileFromBytes = (bytes: Buffer) => {
  if (bytes.length <= 0 || bytes.length > MAX_CANVAS_ASSET_BYTES) {
    throw new Error(
      `The image must be between 1 byte and ${
        MAX_CANVAS_ASSET_BYTES / (1024 * 1024)
      } MiB.`
    );
  }
  const metadata = inspectCanvasImage(bytes);
  const file: CanvasFile = {
    id: createHash("sha1").update(bytes).digest("hex"),
    mimeType: metadata.mimeType,
    dataURL: `data:${metadata.mimeType};base64,${bytes.toString("base64")}`,
    created: Date.now(),
  };
  return { file, metadata };
};
