import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_MICRO_SLOT_SIGNALS_SHA256,
  DIAL_RUNTIME_26903,
} from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot } from "../src/types.js";

const CURRENT_SIGNAL_SHA256 = "e8089d7f8ebbc4dd76e38913c3d28ded0beb934c02e4c97f8930f1adacbf3c4d";
const INITIAL_URL = "app://codex/assets/app-initial-1b87ae739476.js";
const SIGNAL_URL = "app://codex/assets/codex-micro-slot-signals-8615b2aaeccf.js";
const CURRENT_SIGNAL_URL = "app://codex/assets/codex-micro-slot-signals-1c73facc00e2.js";
const METADATA_CACHE = "__codexDeckVerifiedMetadataInitial26903";

function nativeSnapshot(): MicroSnapshot {
  return {
    slots: [],
    layout: { version: 1, slots: {}, analogStick: { up: null, right: null, down: null, left: null } },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 0,
    pageEpoch: 0,
    mappingFingerprint: "",
    targetIdentity: "",
  };
}

async function emittedSnapshotExpression(): Promise<string> {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  let expression = "";
  bridge.socket = { readyState: 1 };
  bridge.targetIdentity = "mock-target";
  bridge.ensureObservationTarget = async () => undefined;
  bridge.evaluate = async (candidate: string) => {
    expression = candidate;
    return nativeSnapshot();
  };
  bridge.sessionOwnership = {
    annotate: async (snapshot: MicroSnapshot) => snapshot,
    getActiveThreadContextUsage: () => undefined,
  };

  await bridge.refresh();
  assert.ok(expression, "refresh must emit the renderer snapshot expression");
  return expression;
}

function currentMetadataGate(expression: string) {
  const start = expression.indexOf("  const appInitialUrls =");
  const end = expression.indexOf("  const appPrimaryUrls =", start);
  assert.ok(start >= 0 && end > start, "snapshot expression must contain the app-initial metadata gate");
  const gate = expression
    .slice(start, end)
    .replace("appInitial = await import(appInitialUrl);", "appInitial = { url: appInitialUrl };");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (urls: string[]) => Promise<{ appInitial: unknown; metadataCurrentRuntime: boolean; metadataSupportedRuntime: boolean }>;
  return new AsyncFunction("urls", `${gate}\nreturn { appInitial, metadataCurrentRuntime, metadataSupportedRuntime };`);
}

async function evaluateGate(
  gate: (urls: string[]) => Promise<{ appInitial: unknown; metadataCurrentRuntime: boolean; metadataSupportedRuntime: boolean }>,
  urls: string[],
  hashes: Array<[string, string]>,
) {
  const globals = globalThis as typeof globalThis & { [METADATA_CACHE]?: Map<string, string> };
  globals[METADATA_CACHE] = new Map(hashes);
  try {
    return await gate(urls);
  } finally {
    delete globals[METADATA_CACHE];
  }
}

test("emitted snapshot gates current metadata on the exact app-initial and slot-signals pair", async () => {
  const expression = await emittedSnapshotExpression();
  const gate = currentMetadataGate(expression);
  assert.ok(expression.includes("readSlotMetadata({ threadKey: activeThreadKey }, metadataScope, metadataNamespace)"), "active metadata must use the versioned namespace too");

  assert.match(expression, new RegExp(DIAL_RUNTIME_26903.initial));
  assert.match(expression, new RegExp(CURRENT_SIGNAL_SHA256));
  assert.match(expression, /I4:\s*namespace\.B3/);
  assert.match(expression, /jCt:\s*namespace\.nEt/);
  assert.match(expression, /gCt:\s*namespace\.BTt/);
  assert.match(expression, /uCt:\s*namespace\.PTt/);
  assert.match(expression, /vCt:\s*namespace\.HTt/);
  assert.match(expression, /LCt:\s*namespace\.cEt/);
  assert.match(expression, /v3:\s*namespace\.S6/);

  const matched = await evaluateGate(gate, [INITIAL_URL, SIGNAL_URL], [
    [INITIAL_URL, DIAL_RUNTIME_26903.initial],
    [SIGNAL_URL, CURRENT_SIGNAL_SHA256],
  ]);
  assert.equal(matched.metadataCurrentRuntime, true);
  assert.equal(matched.metadataSupportedRuntime, true);
  assert.deepEqual(matched.appInitial, { url: INITIAL_URL });

  const mismatched = await evaluateGate(gate, [INITIAL_URL, SIGNAL_URL], [
    [INITIAL_URL, DIAL_RUNTIME_26903.initial],
    [SIGNAL_URL, "changed-slot-signals"],
  ]);
  assert.deepEqual(mismatched, { appInitial: null, metadataCurrentRuntime: false, metadataSupportedRuntime: false });

  const ambiguous = await evaluateGate(gate, [INITIAL_URL, SIGNAL_URL, `${SIGNAL_URL}?duplicate=1`], [
    [INITIAL_URL, DIAL_RUNTIME_26903.initial],
    [SIGNAL_URL, CURRENT_SIGNAL_SHA256],
  ]);
  assert.deepEqual(ambiguous, { appInitial: null, metadataCurrentRuntime: false, metadataSupportedRuntime: false });
});

test("emitted snapshot accepts only the exact 26.908 app-initial and slot-signals pair", async () => {
  const expression = await emittedSnapshotExpression();
  const gate = currentMetadataGate(expression);
  const matched = await evaluateGate(gate, [INITIAL_URL, CURRENT_SIGNAL_URL], [
    [INITIAL_URL, CURRENT_APP_INITIAL_SHA256],
    [CURRENT_SIGNAL_URL, CURRENT_MICRO_SLOT_SIGNALS_SHA256],
  ]);
  assert.deepEqual(matched, {
    appInitial: { url: INITIAL_URL },
    metadataCurrentRuntime: false,
    metadataSupportedRuntime: true,
  });

  const changed = await evaluateGate(gate, [INITIAL_URL, CURRENT_SIGNAL_URL], [
    [INITIAL_URL, CURRENT_APP_INITIAL_SHA256],
    [CURRENT_SIGNAL_URL, "changed-slot-signals"],
  ]);
  assert.deepEqual(changed, {
    appInitial: null,
    metadataCurrentRuntime: false,
    metadataSupportedRuntime: false,
  });
});
