import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction, KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";
import { Send } from "../src/actions.js";
import { DeckController } from "../src/controller.js";
import type { MutationConfirmation, MicroSnapshot } from "../src/types.js";

type Feedback = { phase: string; detail?: string; target?: string };
type SendMode = "confirmed" | "unverified" | "reject" | "release-reject";
type BridgeCall = { slot: string; act: 0 | 1 };

type FakeBridge = {
  calls: BridgeCall[];
  mode: SendMode;
  lease: boolean;
  downGate?: Promise<MutationConfirmation>;
  advancePageEpoch(): void;
  sendAction(slot: "ACT12", act: 0 | 1): Promise<MutationConfirmation | void>;
};

type AlertCounts = { count: number; ok: number };

type ControllerInternals = {
  snapshot: MicroSnapshot;
  microBridge: FakeBridge;
  operationFeedback: Map<string, Feedback>;
};

const confirmed: MutationConfirmation = {
  dispatch: "accepted",
  metadata: "matched",
  semanticOutcome: "confirmed",
};
const unverified: MutationConfirmation = {
  dispatch: "accepted",
  metadata: "matched",
  semanticOutcome: "unverified",
};

function snapshot(): MicroSnapshot {
  return {
    slots: [],
    layout: {
      version: 1,
      slots: { ACT12: { keycapId: "CODEX" } },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "pinned",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 0,
    pageEpoch: 0,
    mappingFingerprint: "test-mapping",
    targetIdentity: "test-target",
  };
}

function action(id: string, alerts: AlertCounts): KeyAction {
  return {
    id,
    isKey: () => true,
    setImage: async () => undefined,
    setTitle: async () => undefined,
    showAlert: async () => { alerts.count += 1; },
    showOk: async () => { alerts.ok += 1; },
  } as unknown as KeyAction;
}

function harness(): {
  controller: DeckController;
  send: Send;
  key: KeyAction;
  alerts: AlertCounts;
  internals: ControllerInternals;
} {
  const controller = new DeckController();
  const alerts: AlertCounts = { count: 0, ok: 0 };
  const bridge: FakeBridge = {
    calls: [],
    mode: "unverified",
    lease: false,
    advancePageEpoch: () => undefined,
    async sendAction(slot, act) {
      this.calls.push({ slot, act });
      if (act === 0) {
        if (!this.lease) throw new Error("E_RELEASE_TARGET_GONE");
        if (this.mode === "release-reject") throw new Error("E_RELEASE_UNVERIFIED");
        this.lease = false;
        return;
      }
      if (this.mode === "reject") {
        // Model a dispatch that reached the native input before its observer
        // rejected; the controller must still attempt exactly one rollback up.
        this.lease = true;
        throw new Error("E_TARGET_STALE");
      }
      if (this.downGate) {
        const result = await this.downGate;
        this.lease = true;
        return result;
      }
      this.lease = true;
      return this.mode === "confirmed" ? confirmed : unverified;
    },
  };
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.microBridge = bridge;
  const key = action("act12-feedback", alerts);
  return { controller, send: new Send(controller), key, alerts, internals };
}

function downEvent(key: KeyAction): KeyDownEvent {
  return { action: key } as unknown as KeyDownEvent;
}

function upEvent(key: KeyAction): KeyUpEvent {
  return { action: key } as unknown as KeyUpEvent;
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("Send keeps an unverified ACT12 result after key-up and releases one leased input", async () => {
  const { controller, send, key, alerts, internals } = harness();
  const bridge = internals.microBridge;

  await send.onKeyDown(downEvent(key));
  assert.deepEqual(bridge.calls, [{ slot: "ACT12", act: 1 }]);
  assert.equal(alerts.count, 0, "an observer-unverified send is not an action failure");
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "sent-unverified",
    detail: "E_RESULT_UNVERIFIED",
    target: "ACT12",
  });

  // A foreground/snapshot change must not replace the lease captured by the
  // down. The matching release still goes to the fake bridge exactly once.
  internals.snapshot = { ...internals.snapshot, activeThreadKey: "foreground-changed" };
  await send.onKeyUp(upEvent(key));
  assert.deepEqual(bridge.calls, [
    { slot: "ACT12", act: 1 },
    { slot: "ACT12", act: 0 },
  ]);
  assert.equal(bridge.lease, false);
  assert.equal(alerts.count, 0);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "sent-unverified",
    detail: "E_RESULT_UNVERIFIED",
    target: "ACT12",
  });

  // A subsequent input generation clears the retained old result.
  bridge.mode = "confirmed";
  await send.onKeyDown(downEvent(key));
  assert.deepEqual(internals.operationFeedback.get(key.id), { phase: "held", detail: "押下中", target: "ACT12" });
  await send.onKeyUp(upEvent(key));
  assert.equal(internals.operationFeedback.has(key.id), false);

  // Keep the controller referenced so the test makes the real wrapper path
  // explicit even though no lifecycle registration is needed for dispatch.
  assert.ok(controller);
});

test("keyup queued before ACT12 observation uses the eventual down result", async () => {
  const { send, key, alerts, internals } = harness();
  let resolveDown!: (result: MutationConfirmation) => void;
  internals.microBridge.downGate = new Promise<MutationConfirmation>((resolve) => { resolveDown = resolve; });

  const down = send.onKeyDown(downEvent(key));
  await tick();
  const up = send.onKeyUp(upEvent(key));
  await tick();
  assert.deepEqual(internals.microBridge.calls, [{ slot: "ACT12", act: 1 }]);

  resolveDown(unverified);
  await Promise.all([down, up]);

  assert.deepEqual(internals.microBridge.calls, [
    { slot: "ACT12", act: 1 },
    { slot: "ACT12", act: 0 },
  ]);
  assert.equal(alerts.count, 0);
  assert.equal(alerts.ok, 0);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "sent-unverified",
    detail: "E_RESULT_UNVERIFIED",
    target: "ACT12",
  });
});

test("a second queued ACT12 press gets its own feedback generation after the first lease", async () => {
  const { send, key, alerts, internals } = harness();
  let resolveFirstDown!: (result: MutationConfirmation) => void;
  internals.microBridge.downGate = new Promise<MutationConfirmation>((resolve) => { resolveFirstDown = resolve; });

  const down1 = send.onKeyDown(downEvent(key));
  await tick();
  const up1 = send.onKeyUp(upEvent(key));
  const down2 = send.onKeyDown(downEvent(key));
  const up2 = send.onKeyUp(upEvent(key));
  await tick();
  assert.deepEqual(internals.microBridge.calls, [{ slot: "ACT12", act: 1 }]);

  resolveFirstDown(unverified);
  await Promise.all([down1, up1, down2, up2]);

  assert.deepEqual(internals.microBridge.calls, [
    { slot: "ACT12", act: 1 },
    { slot: "ACT12", act: 0 },
    { slot: "ACT12", act: 1 },
    { slot: "ACT12", act: 0 },
  ]);
  assert.equal(alerts.count, 0);
  assert.equal(alerts.ok, 0);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "sent-unverified",
    detail: "E_RESULT_UNVERIFIED",
    target: "ACT12",
  });
});

test("a real Send wrapper alerts on a true down rejection and re-registration clears old feedback", async () => {
  const { controller, send, key, alerts, internals } = harness();
  const bridge = internals.microBridge;
  bridge.mode = "reject";

  await send.onKeyDown(downEvent(key));
  assert.equal(alerts.count, 1, "a true dispatch rejection remains alertable");
  assert.equal(alerts.ok, 0);
  assert.deepEqual(bridge.calls, [
    { slot: "ACT12", act: 1 },
    { slot: "ACT12", act: 0 },
  ]);

  bridge.mode = "unverified";
  await send.onKeyDown(downEvent(key));
  await send.onKeyUp(upEvent(key));
  assert.equal(internals.operationFeedback.get(key.id)?.phase, "sent-unverified");

  bridge.mode = "release-reject";
  await send.onKeyDown(downEvent(key));
  await send.onKeyUp(upEvent(key));
  assert.equal(alerts.count, 2, "a true release rejection remains alertable");
  assert.equal(alerts.ok, 0);
  assert.equal(internals.operationFeedback.get(key.id)?.detail, "E_RELEASE_UNVERIFIED");

  controller.registerMicroAction("ACT12", key);
  assert.equal(internals.operationFeedback.has(key.id), false, "a new action incarnation drops old feedback");
  controller.unregisterMicroAction(key);
});
