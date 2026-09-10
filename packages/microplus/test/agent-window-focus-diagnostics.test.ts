import assert from "node:assert/strict";
import test from "node:test";
import { CodexMicroRendererBridge, type AgentWindowRoutingTransport } from "../src/codex-micro-renderer-bridge.js";
import { codexDebugTargetKey, type DebugTarget } from "../src/codex-debug-discovery.js";

test("activation ACK without foreground confirmation ends with content-free diagnostics and no HID", async () => {
  const target = (id: string): DebugTarget => ({
    id, type: "page", url: "app://-/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/${id}`,
  });
  const source = target("source");
  const destination = target("destination");
  const messages: string[] = [];
  let activations = 0;
  let connections = 0;
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => 9222,
    listTargets: async () => [source, destination],
    command: async <T>(candidate: DebugTarget, _port: number, method: string) => {
      if (method === "Page.bringToFront") { activations += 1; return undefined as T; }
      assert.equal(method, "Runtime.evaluate");
      return {
        activeThreadKey: candidate === source ? "local:source-private" : "local:destination-private",
        activeComposerKey: candidate === source ? "composer-source" : "composer-destination",
        identityAvailable: true, composerPresent: true,
        focusedVisible: candidate === source,
      } as T;
    },
  };
  const bridge = new CodexMicroRendererBridge((message) => messages.push(message), undefined, transport) as any;
  bridge.connectedTargetKey = codexDebugTargetKey(source);
  bridge.connect = async () => { connections += 1; };
  bridge.dispatch = async () => { assert.fail("Failed window selection must not dispatch HID"); };
  await assert.rejects(bridge.routeAgentToWindow("local:destination-private", {
    activeThreadKey: "local:source-private", activeComposerKey: "composer-source",
  }, "current-window", "/local/destination-private"), /E_AGENT_WINDOW_UNVERIFIED/u);
  assert.equal(activations, 1);
  assert.equal(connections, 0);
  assert.ok(messages.includes("Agent window activation command acknowledged."));
  assert.match(messages.join("\n"), /identityAvailable=true taskMatches=true focusedVisible=false/u);
  assert.match(messages.join("\n"), /phase=focus/u);
  assert.doesNotMatch(messages.join("\n"), /source-private|destination-private|composer-source|composer-destination/u);
});
