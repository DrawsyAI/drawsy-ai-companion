#!/usr/bin/env node

import { createDrawsyBridge } from "./bridge.js";
import { loadDrawsyEnvironment } from "./environment.js";

const mode = loadDrawsyEnvironment();

const bridge = createDrawsyBridge({
  host: process.env.HOST || "127.0.0.1"
});
await bridge.listen();
console.log(`Drawsy AI bridge listening on ${bridge.address}`);

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
