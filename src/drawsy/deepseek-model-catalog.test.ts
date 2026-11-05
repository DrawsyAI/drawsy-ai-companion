import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  getDeepSeekModelCatalog,
  type DeepSeekModelCatalogRuntime,
} from "./deepseek-model-catalog.js";

const catalog = {
  default: { provider: "deepseek-official", model: "deepseek-v4-flash" },
  routableProviders: ["deepseek-official"],
  groups: [{ id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] }],
  failures: [],
};

function harness(responseValue: unknown = catalog) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough; stderr: PassThrough; stdin: PassThrough;
    exitCode: number | null; signalCode: NodeJS.Signals | null;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  const killed: string[] = [];
  child.kill = (signal = "SIGTERM") => {
    killed.push(signal);
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const io: DeepSeekModelCatalogRuntime = {
    spawn: (() => child) as unknown as DeepSeekModelCatalogRuntime["spawn"],
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push({ url, init });
      if (url.pathname === "/connect") {
        const headers = new Headers({ location: "./api/remote.mux" });
        headers.append("set-cookie", "dsh-auth-test=signed-cookie; Path=/; HttpOnly");
        return new Response(null, { status: 302, headers });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        type: "server-response", rpcId: body.rpcId,
        result: { ok: true, value: responseValue },
      });
    }) as typeof fetch,
  };
  return { child, io, requests, killed };
}

test("reads the native owner model catalogue through loopback RPC and stops the web child", async () => {
  const fixture = harness();
  const result = getDeepSeekModelCatalog("dsh-fixture", fixture.io);
  fixture.child.stdout.write("dsh web: http://127.0.0.1:43127/?token=fixture-secret\n");

  assert.deepEqual(await result, catalog);
  assert.equal(fixture.requests[0]?.url.pathname, "/connect");
  assert.equal(fixture.requests[0]?.url.searchParams.get("interactions"), "none");
  assert.equal(fixture.requests[1]?.url.pathname, "/api/session/modelCatalog");
  assert.equal(fixture.requests[1]?.init?.headers && new Headers(fixture.requests[1].init?.headers).get("cookie"), "dsh-auth-test=signed-cookie");
  const rpc = JSON.parse(String(fixture.requests[1]?.init?.body)) as Record<string, unknown>;
  assert.equal(rpc.type, "client-request");
  assert.equal(rpc.method, "session/modelCatalog");
  assert.deepEqual(rpc.payload, { args: {} });
  assert.equal(typeof rpc.rpcId, "string");
  assert.deepEqual(fixture.killed, ["SIGTERM"]);
});

test("does not expose an invalid native catalogue response", async () => {
  const fixture = harness({ groups: [] });
  const result = getDeepSeekModelCatalog("dsh-fixture", fixture.io);
  fixture.child.stdout.write("dsh web: http://127.0.0.1:43127/?token=fixture-secret\n");
  await assert.rejects(result, /invalid model catalogue/);
  assert.deepEqual(fixture.killed, ["SIGTERM"]);
});
