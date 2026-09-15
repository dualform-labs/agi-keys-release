import WebSocket from "ws";
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_NATIVE_EXTERNAL_URLS,
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_MICRO_LAYOUT_ASSET,
  CURRENT_MICRO_LAYOUT_SHA256,
  rendererFailureCode,
} from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot, MutationConfirmation, OperationRequest } from "../src/types.js";

const ALLOWED_OPENAI_DOCS_URL = ALLOWED_NATIVE_EXTERNAL_URLS[0];

function snapshot(): MicroSnapshot {
  return {
    slots: [],
    activeThreadKey: "local:11111111-1111-4111-8111-111111111111",
    activeComposerKey: "composer-1",
    layout: { version: 1, slots: {}, analogStick: {} as MicroSnapshot["layout"]["analogStick"] },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 4,
    pageEpoch: 2,
    mappingFingerprint: "map",
    targetIdentity: "target",
  };
}

type BridgeHarness = {
  socket: WebSocket;
  targetIdentity: string;
  runKeycap(keycapId: "OAI"): Promise<MutationConfirmation>;
  refresh(): Promise<MicroSnapshot>;
  evaluate<T>(expression: string): Promise<T>;
  observeOperation(
    operation: OperationRequest,
    direction?: unknown,
    postcondition?: unknown,
  ): Promise<MutationConfirmation>;
  connectionEpoch: number;
  pageEpoch: number;
  lastSnapshot: MicroSnapshot;
};

function bridgeHarness(actionUrl: string, layoutSha256 = CURRENT_MICRO_LAYOUT_SHA256) {
  const current = snapshot();
  const opened: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.targetIdentity = current.targetIdentity;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.lastSnapshot = current;
  bridge.refresh = async () => current;
  bridge.observeOperation = async (_operation, _direction, postcondition) => ({
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: postcondition ? "confirmed" : "unverified",
    observedSnapshot: current,
  });
  bridge.evaluate = async <T>(expression: string) => await executeOaiExpression(
    expression,
    actionUrl,
    layoutSha256,
    opened,
  ) as T;
  return { bridge, opened };
}

async function executeOaiExpression(
  expression: string,
  actionUrl: string,
  layoutSha256: string,
  opened: string[],
): Promise<unknown> {
  const layoutUrl = `app://codex/assets/${CURRENT_MICRO_LAYOUT_ASSET}`;
  const appInitialUrl = "app://codex/assets/app-initial-9b95fa538c62.js";
  const sources = new Map([
    [layoutUrl, "current-layout-source"],
    [appInitialUrl, "current-app-initial-source"],
  ]);
  const fakeDigest = async (_algorithm: string, bytes: ArrayBuffer): Promise<ArrayBuffer> => {
    const source = new TextDecoder().decode(bytes);
    const hex = source === "current-layout-source" ? layoutSha256
      : source === "current-app-initial-source" ? CURRENT_APP_INITIAL_SHA256
        : "0".repeat(64);
    return Uint8Array.from(Buffer.from(hex, "hex")).buffer;
  };
  const testImport = async (url: string): Promise<Record<string, unknown>> => {
    if (url === layoutUrl) {
      return { getKeycap: (id: string) => ({ id, action: { type: "external-url", url: actionUrl } }) };
    }
    if (url === appInitialUrl) {
      return {
        k8t: ({ href }: { href: string }) => {
          opened.push(href);
          return true;
        },
      };
    }
    throw new Error(`unexpected import: ${url}`);
  };
  const runnable = expression.replaceAll("import(", "testImport(");
  const execute = new Function(
    "document",
    "performance",
    "location",
    "fetch",
    "crypto",
    "TextEncoder",
    "URL",
    "testImport",
    `return ${runnable}`,
  ) as (...args: unknown[]) => Promise<unknown>;
  return await execute(
    {
      hasFocus: () => true,
      visibilityState: "visible",
      querySelectorAll: () => [{ href: layoutUrl }, { href: appInitialUrl }],
    },
    { getEntriesByType: () => [] },
    { href: "app://codex/index.html" },
    async (url: string) => ({ text: async () => sources.get(url) ?? "" }),
    { subtle: { digest: fakeDigest } },
    TextEncoder,
    URL,
    testImport,
  );
}

test("runKeycap OAI rejects any URL that differs from the pinned layout contract", async () => {
  for (const url of [
    "file:///tmp/codex-keycap-payload",
    "javascript:globalThis.compromised=true",
    "data:text/html,payload",
    "app://foreign/settings",
    "http://developers.openai.com/",
    "https://attacker.invalid/",
    "https://developers.openai.com.attacker.invalid/",
    "https://developers.openai.com./",
    "https://user@developers.openai.com/",
    "https://developers.openai.com:444/",
    "https://developers.openai.com/path",
    "https://developers.openai.com/?redirect=1",
    "https://developers.openai.com/#fragment",
    "mailto:security@openai.com",
    "openai://developers/docs",
    "/relative/docs",
    `https://developers.openai.com/${"a".repeat(2048)}`,
  ]) {
    const { bridge, opened } = bridgeHarness(url);
    await assert.rejects(bridge.runKeycap("OAI"), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
    assert.deepEqual(opened, []);
  }
});

test("runKeycap OAI rejects a changed layout asset before importing its action", async () => {
  const { bridge, opened } = bridgeHarness(ALLOWED_OPENAI_DOCS_URL, "0".repeat(64));
  await assert.rejects(bridge.runKeycap("OAI"), /E_MICRO_KEYCAP_REGISTRY_CHANGED/);
  assert.deepEqual(opened, []);
});

test("runKeycap OAI preserves the exact allowlisted OpenAI documentation URL", async () => {
  const { bridge, opened } = bridgeHarness("https://developers.openai.com");
  const result = await bridge.runKeycap("OAI");
  assert.equal(result.semanticOutcome, "confirmed");
  assert.deepEqual(opened, [ALLOWED_OPENAI_DOCS_URL]);
});

test("the external URL denial remains a content-free renderer failure code", () => {
  assert.equal(rendererFailureCode({
    result: { exceptionDetails: { text: "Uncaught (in promise) Error: E_EXTERNAL_URL_NOT_ALLOWED" } },
  }), "E_EXTERNAL_URL_NOT_ALLOWED");
});
