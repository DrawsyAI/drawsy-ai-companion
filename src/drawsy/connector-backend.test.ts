import assert from "node:assert/strict";
import test from "node:test";

import { createDrawsyBridge } from "./bridge.js";
import {
  createConnectorBackendResolver,
  DEFAULT_HOSTED_CONNECTOR_BACKEND_URL,
  DEFAULT_LOCAL_CONNECTOR_BACKEND_URL
} from "./connector-backend.js";

const defaultResolver = () =>
  createConnectorBackendResolver({
    configuredUrl: null,
    localUrl: DEFAULT_LOCAL_CONNECTOR_BACKEND_URL,
    hostedUrl: DEFAULT_HOSTED_CONNECTOR_BACKEND_URL
  });

test("connector routing selects the local backend for local Drawsy", () => {
  const resolver = defaultResolver();
  const result = resolver.resolve("http://127.0.0.1:3001");

  assert.equal(result.source, "local-default");
  assert.equal(result.url?.toString(), `${DEFAULT_LOCAL_CONNECTOR_BACKEND_URL}/`);
});

test("connector routing selects the hosted backend for public Drawsy", () => {
  const resolver = defaultResolver();
  const result = resolver.resolve("https://drawsyai.tech");

  assert.equal(result.source, "hosted-default");
  assert.equal(
    result.url?.toString(),
    `${DEFAULT_HOSTED_CONNECTOR_BACKEND_URL}/`
  );
});

test("connector routing stays disabled for an unknown origin", () => {
  const resolver = defaultResolver();
  const result = resolver.resolve("https://untrusted.example");

  assert.equal(result.source, "disabled");
  assert.equal(result.url, null);
});

test("an explicit backend override is used for trusted deployments", () => {
  const resolver = createConnectorBackendResolver({
    configuredUrl: "http://localhost:3004"
  });

  const result = resolver.resolve("https://drawsyai.tech");

  assert.equal(result.source, "configured");
  assert.equal(result.url?.toString(), "http://localhost:3004/");
});

test("connector backend URLs cannot contain credentials or query strings", () => {
  assert.throws(
    () =>
      createConnectorBackendResolver({
        configuredUrl: "https://backend.example/?token=secret"
      }),
    /without credentials or query parameters/
  );
});

test("bridge health reports the installed version and routing mode", async () => {
  const bridge = createDrawsyBridge({
    port: 0,
    connectorBackendUrl: null,
    version: "0.1.13"
  });
  await bridge.listen();
  try {
    const address = bridge.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const health = await fetch(`http://127.0.0.1:${port}/health`).then(
      (response) => response.json()
    );

    assert.deepEqual(health, {
      ok: true,
      service: "drawsy-ai-bridge",
      version: "0.1.13",
      connectorRouting: "automatic local/hosted routing"
    });
  } finally {
    await bridge.close();
  }
});
