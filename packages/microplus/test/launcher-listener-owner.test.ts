import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { healthyPort, type MainProcess } from "../launcher/macos.js";

test("launcher only probes listeners attested to the expected process", async t => {
  let requests = 0;
  let url = "app://codex/index.html";
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify([{ type: "page", url, webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/test" }]));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as AddressInfo).port;
  const main = { pid: 12345, command: `codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } as MainProcess;
  assert.equal(await healthyPort(main, async candidate => {
    assert.deepEqual(candidate, { pid: main.pid, port });
    return false;
  }), null);
  assert.equal(requests, 0, "unowned endpoints must not be contacted");
  assert.equal(await healthyPort(main, async () => { throw new Error("permission denied"); }), null);
  assert.equal(requests, 0);
  assert.equal(await healthyPort(main, async () => true), port);
  url = "app://codex/avatar-overlay";
  assert.equal(await healthyPort(main, async () => true), null);
  assert.equal(requests, 2);
});
