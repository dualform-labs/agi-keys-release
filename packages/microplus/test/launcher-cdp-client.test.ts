import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocketServer } from "ws";
import { CdpClient } from "../launcher/cdp-client.js";

for (const mode of ["success", "silent", "closed", "malformed"] as const) {
  test(`launcher CDP settles ${mode} responses`, async t => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>(resolve => server.once("listening", resolve));
    t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
    let calls = 0;
    server.on("connection", socket => socket.on("message", raw => {
      calls++;
      const { id } = JSON.parse(String(raw));
      if (mode === "success") socket.send(JSON.stringify({ id, result: { result: { value: 42 } } }));
      if (mode === "closed") socket.close();
      if (mode === "malformed") socket.send("not json");
    }));
    const client = new CdpClient(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`, 200);
    t.after(() => client.close());
    await client.connect();
    if (mode === "success") assert.equal(await client.evaluate("test"), 42);
    else await assert.rejects(client.evaluate("test"), /E_CDP_(REQUEST_TIMEOUT|CLOSED)/);
    assert.equal(calls, 1, "failed operations must not be resent");
  });
}

test("launcher CDP handshake has a deadline", async t => {
  const server = createServer();
  server.on("upgrade", (_request, socket) => { t.after(() => socket.destroy()); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const client = new CdpClient(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`, 100);
  t.after(() => client.close());
  await assert.rejects(client.connect(), /E_CDP_CONNECT_FAILED/);
});
