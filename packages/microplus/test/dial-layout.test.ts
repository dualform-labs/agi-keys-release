import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import streamDeck, { type DialAction, type DialRotateEvent } from "@elgato/streamdeck";
import { connection } from "../node_modules/@elgato/streamdeck/dist/plugin/connection.js";
import { DeckController, MICROPLUS_DIAL_LAYOUT, safeDialFailureCode } from "../src/controller.js";
import { PlusConversationDial } from "../src/plus-actions.js";
import type { OperationFeedback } from "../src/render.js";
import type { MicroSnapshot } from "../src/types.js";

type LayoutItem = { key: string; type: string; rect: [number, number, number, number]; background?: string; color?: string; zOrder?: number };
type Layout = { id: string; items: LayoutItem[] };
type Manifest = { Actions: Array<{ Controllers?: string[]; Encoder?: { layout?: string } }> };
type Feedback = Record<string, unknown>;

test("all encoder actions select the six-field custom LCD layout", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  const encoders = manifest.Actions.filter(({ Controllers }) => Controllers?.includes("Encoder"));
  assert.equal(encoders.length, 6);
  assert.deepEqual(encoders.map(({ Encoder }) => Encoder?.layout), Array(6).fill(MICROPLUS_DIAL_LAYOUT));

  const paths = [
    "microplus-dial.json",
    "microplus-dial-large.json",
    "microplus-dial-light.json",
    "microplus-dial-large-light.json",
  ];
  for (const path of paths) {
    const layout = JSON.parse(await readFile(new URL(`../static/layouts/${path}`, import.meta.url), "utf8")) as Layout;
    const ordinaryKeys = new Set(["surface", "heading", "value", "detail", "status", "progress", "icon"]);
    const keys = layout.items.map(({ key }) => key);
    assert.equal(new Set(keys).size, keys.length, `${path} has duplicate keys`);
    assert.deepEqual(new Set(keys.filter((key) => !key.startsWith("backdrop-"))), ordinaryKeys);
    assert.equal(keys.filter((key) => key.startsWith("backdrop-")).length, 1, `${path} interaction ribbon count`);
    assert.deepEqual(layout.items.find(({ key }) => key === "surface")?.rect, [0, 0, 200, 100]);
    assert.ok(!layout.items.some(({ key }) => key === "backdrop"), `${path} uses overlapping full backdrop`);
    assert.ok(!layout.items.some(({ key }) => key === "title"), `${path} uses reserved title key`);
    assert.match(layout.items.find(({ key }) => key === "surface")?.background ?? "", /^#[0-9A-F]{6}$/i, `${path} surface background`);
    for (const item of layout.items.filter(({ type }) => type === "text")) {
      assert.match(item.color ?? "", /^#[0-9A-F]{6}$/i, `${path} ${item.key} color`);
    }
    for (const { rect: [x, y, width, height] } of layout.items) {
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
      assert.ok(x + width <= 200 && y + height <= 100);
    }
    for (let index = 0; index < layout.items.length; index += 1) {
      const first = layout.items[index]!;
      const [firstX, firstY, firstWidth, firstHeight] = first.rect;
      for (const second of layout.items.slice(index + 1)) {
        const [secondX, secondY, secondWidth, secondHeight] = second.rect;
        const overlaps = firstX < secondX + secondWidth
          && secondX < firstX + firstWidth
          && firstY < secondY + secondHeight
          && secondY < firstY + firstHeight;
        if ((first.zOrder ?? 0) === (second.zOrder ?? 0)) assert.equal(overlaps, false, `${path} ${first.key} overlaps ${second.key} at the same z-order`);
      }
    }
    assert.equal(layout.items.find(({ key }) => key === "surface")?.zOrder, 0);
    assert.ok(layout.items.filter(({ key }) => key !== "surface").every(({ zOrder }) => (zOrder ?? 0) > 0));
  }
});

test("visible dials apply the custom layout before sending every LCD field", async () => {
  const calls: Array<{ kind: "layout"; value: string } | { kind: "feedback"; value: Record<string, unknown> }> = [];
  let feedbackState: Feedback = {};
  const action = {
    id: "dial-contract",
    setFeedbackLayout: async (value: string) => { calls.push({ kind: "layout", value }); },
    setFeedback: async (value: Feedback) => {
      feedbackState = { ...feedbackState, ...value };
      calls.push({ kind: "feedback", value: { ...feedbackState } });
    },
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("reasoning", action);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(calls[0]?.kind, "layout");
  assert.deepEqual(calls[0], { kind: "layout", value: MICROPLUS_DIAL_LAYOUT });
  const feedback = calls.find((call): call is { kind: "feedback"; value: Record<string, unknown> } => call.kind === "feedback");
  assert.ok(feedback);
  assert.deepEqual(new Set(Object.keys(feedback.value)), new Set(["heading", "value", "detail", "status", "progress", "icon", "surface", "backdrop-13"]));
  assert.equal(feedback.value.heading, "思考レベル");
  assert.ok(!("title" in feedback.value));
  assert.equal(typeof feedback.value.progress, "number");
  assert.equal(feedback.value.progress, 0);
  assert.equal(feedback.value.status, "接続中");
  assert.match(String(feedback.value.icon), /^data:image\/svg\+xml/);
  assert.match(String(feedback.value.surface), /^data:image\/svg\+xml/);
  const initialRibbon = String(feedback.value["backdrop-13"]);
  assert.match(initialRibbon, /^data:image\/svg\+xml/);
  assert.doesNotMatch(decodeURIComponent(initialRibbon.slice(initialRibbon.indexOf(",") + 1)), /data-dial-input|data-dial-wait/);

  const internals = controller as unknown as {
    operationFeedback: Map<string, OperationFeedback>;
    plusDials: Map<string, unknown>;
    renderPlusDial(registration: unknown): Promise<void>;
  };
  const registration = internals.plusDials.get(action.id);
  assert.ok(registration);
  internals.operationFeedback.set(action.id, { phase: "pending", progress: 0.5, detail: "E_RESULT_UNVERIFIED" });
  await internals.renderPlusDial(registration);
  internals.operationFeedback.set(action.id, { phase: "error", detail: "E_INPUT_OWNED" });
  await internals.renderPlusDial(registration);
  internals.operationFeedback.set(action.id, { phase: "error", detail: "E_SENSITIVE_INTERNAL_CODE_THAT_MUST_NOT_RENDER" });
  await internals.renderPlusDial(registration);
  internals.operationFeedback.delete(action.id);
  await internals.renderPlusDial(registration);

  const feedbackCalls = calls.filter((call): call is { kind: "feedback"; value: Record<string, unknown> } => call.kind === "feedback");
  assert.deepEqual(feedbackCalls.map(({ value }) => value.progress), [0, 50, 0, 0, 0]);
  assert.equal(feedbackCalls[1]?.value.status, "確認中");
  assert.equal(feedbackCalls[1]?.value.detail, "結果未確認");
  assert.equal(feedbackCalls[2]?.value.detail, "他キー操…");
  assert.equal(feedbackCalls[3]?.value.detail, "確認不可");
  assert.equal(feedbackCalls[4]?.value.detail, "");
  for (const kind of ["model", "commands"] as const) {
    internals.operationFeedback.set(action.id, { phase: "pending", detail: "E_RESULT_UNVERIFIED" });
    await internals.renderPlusDial({ ...(registration as object), kind });
    const latest = calls.filter((call) => call.kind === "feedback").at(-1);
    assert.equal(latest?.value.detail, "結果未確認", `${kind} instructions must not hide pending feedback`);
  }
});

test("theme and text-size settings replace the SDK feedback layout", async () => {
  const layouts: string[] = [];
  const action = {
    id: "dial-layout-preferences",
    setFeedbackLayout: async (value: string) => { layouts.push(value); },
    setFeedback: async () => undefined,
    showAlert: async () => undefined,
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("commands", action);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.setActionPreferences(action.id, { textSize: "large" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.setActionPreferences(action.id, { textSize: "large", theme: "light" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.setActionPreferences(action.id, { theme: "light" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(layouts, [
    "static/layouts/microplus-dial.json",
    "static/layouts/microplus-dial-large.json",
    "static/layouts/microplus-dial-large-light.json",
    "static/layouts/microplus-dial-light.json",
  ]);
});

test("a same-id replacement sends a full first payload after layout setup", async () => {
  const firstPayloads: Feedback[] = [];
  const replacementPayloads: Feedback[] = [];
  const replacementFeedback: Feedback[] = [];
  const firstAction = {
    id: "same-id-layout-replacement",
    setFeedbackLayout: async () => undefined,
    setFeedback: async (value: Feedback) => { firstPayloads.push({ ...value }); },
    showAlert: async () => undefined,
  } as unknown as DialAction;
  const replacementAction = {
    id: firstAction.id,
    setFeedbackLayout: async () => undefined,
    setFeedback: async (value: Feedback) => {
      replacementPayloads.push({ ...value });
      recordFeedback(replacementFeedback, value);
    },
    showAlert: async () => undefined,
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("reasoning", firstAction);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(firstPayloads.length, 1);

  controller.registerPlusDial("reasoning", replacementAction);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(replacementPayloads.length, 1);
  assert.deepEqual(new Set(Object.keys(replacementPayloads[0] ?? {})), new Set([
    "heading", "value", "detail", "status", "progress", "icon", "surface", "backdrop-13",
  ]));
  assert.deepEqual(Object.keys(replacementFeedback[0] ?? {}).sort(), Object.keys(replacementPayloads[0] ?? {}).sort());
});

test("feedback waits for layout readiness and stale initialization cannot overwrite a reappeared dial", async () => {
  let releaseOldLayout!: () => void;
  const oldLayout = new Promise<void>((resolve) => { releaseOldLayout = resolve; });
  const oldFeedback: Record<string, unknown>[] = [];
  const newFeedback: Record<string, unknown>[] = [];
  const oldAction = {
    id: "reappeared-dial",
    setFeedbackLayout: async () => { await oldLayout; },
    setFeedback: async (value: Feedback) => { recordFeedback(oldFeedback, value); },
    showAlert: async () => undefined,
  } as unknown as DialAction;
  const newAction = {
    id: "reappeared-dial",
    setFeedbackLayout: async () => undefined,
    setFeedback: async (value: Feedback) => { recordFeedback(newFeedback, value); },
    showAlert: async () => undefined,
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("reasoning", oldAction);
  await Promise.resolve();
  assert.deepEqual(oldFeedback, []);
  controller.unregisterPlusDial(oldAction);
  controller.registerPlusDial("reasoning", newAction);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(newFeedback.length, 1);

  releaseOldLayout();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(oldFeedback, []);
  assert.equal(newFeedback.length, 1);
});

test("layout initialization failure alerts and never sends six fields to an unknown prior layout", async () => {
  let alerts = 0;
  let feedbacks = 0;
  const action = {
    id: "failed-layout",
    setFeedbackLayout: async () => { throw new Error("layout unavailable"); },
    setFeedback: async () => { feedbacks += 1; },
    showAlert: async () => { alerts += 1; },
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("navigation", action);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(alerts, 1);
  assert.equal(feedbacks, 0);
});

test("a delayed stale LCD write restores the current registration and cannot replace its cache", async () => {
  let releaseOldFeedback!: () => void;
  let oldFeedbackStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => { oldFeedbackStarted = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOldFeedback = resolve; });
  const newFeedback: Record<string, unknown>[] = [];
  const oldAction = {
    id: "delayed-feedback-dial",
    setFeedbackLayout: async () => undefined,
    setFeedback: async () => { oldFeedbackStarted(); await oldGate; },
  } as unknown as DialAction;
  const newAction = {
    id: "delayed-feedback-dial",
    setFeedbackLayout: async () => undefined,
    setFeedback: async (value: Feedback) => { recordFeedback(newFeedback, value); },
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("reasoning", oldAction);
  await oldStarted;
  controller.unregisterPlusDial(oldAction);
  controller.registerPlusDial("reasoning", newAction);
  const internals = controller as unknown as {
    operationFeedback: Map<string, OperationFeedback>;
    lastPlusFeedback: Map<string, string>;
  };
  internals.operationFeedback.set(newAction.id, { phase: "pending", detail: "E_RESULT_UNVERIFIED" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(newFeedback.length, 1);
  assert.equal(newFeedback[0]?.detail, "結果未確認");

  releaseOldFeedback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(newFeedback.length, 2);
  assert.deepEqual(newFeedback[1], newFeedback[0]);
  assert.equal(internals.lastPlusFeedback.get(newAction.id), JSON.stringify(newFeedback[1]));
});

test("layout alert rejection is contained", async () => {
  const action = {
    id: "failed-layout-alert",
    setFeedbackLayout: async () => { throw new Error("layout unavailable"); },
    setFeedback: async () => { assert.fail("feedback must remain blocked"); },
    showAlert: async () => { throw new Error("alert unavailable"); },
  } as unknown as DialAction;
  const controller = new DeckController();

  controller.registerPlusDial("navigation", action);
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("a production SDK feedback send failure cannot turn completed dispatch callbacks into an input failure", async () => {
  const mutableConnection = connection as unknown as { connection: {
    promise: Promise<unknown>;
    resolve(value: unknown): void;
    reject(reason?: unknown): void;
  } };
  const originalConnection = mutableConnection.connection;
  const sdkMessages: Array<{ event: string; payload?: unknown }> = [];
  const socket = {
    send(message: string) {
      const parsed = JSON.parse(message) as { event: string; payload?: unknown };
      sdkMessages.push(parsed);
      if (parsed.event === "setFeedback") throw new Error("closed SDK display socket");
    },
  };
  mutableConnection.connection = {
    promise: Promise.resolve(socket),
    resolve: () => undefined,
    reject: () => undefined,
  };

  try {
    const sdkModuleUrl = new URL("../node_modules/@elgato/streamdeck/dist/plugin/actions/dial.js", import.meta.url).href;
    const sdkModule = await import(sdkModuleUrl) as { DialAction: { prototype: object } };
    const action = Object.create(sdkModule.DialAction.prototype) as DialAction;
    Object.defineProperty(action, "id", { value: "production-sdk-navigation" });
    const snapshot = navigationSnapshot();
    const pulses: number[] = [];
    const controller = new DeckController();
    const internals = controller as unknown as {
      snapshot: MicroSnapshot;
      health: { state: "ready"; changedAt: number };
      microBridge: {
        sendJoystick(direction: "left" | "right", distance: 0 | 1): Promise<void>;
        refresh(): Promise<MicroSnapshot>;
        advancePageEpoch(): void;
      };
    };
    internals.snapshot = snapshot;
    internals.health = { state: "ready", changedAt: Date.now() };
    internals.microBridge = {
      sendJoystick: async (_direction, distance) => { pulses.push(distance); },
      refresh: async () => snapshot,
      advancePageEpoch: () => undefined,
    };

    controller.registerPlusDial("navigation", action);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.doesNotReject(controller.plusDialRotate(action.id, 1));

    assert.deepEqual(pulses, [1, 0]);
    assert.ok(sdkMessages.some(({ event }) => event === "setFeedbackLayout"));
    assert.ok(sdkMessages.some(({ event }) => event === "setFeedback"));
  } finally {
    mutableConnection.connection = originalConnection;
  }
});

function navigationSnapshot(): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-1",
    layout: {
      version: 1,
      slots: {},
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

test("dial diagnostics preserve only reviewed bridge codes", async () => {
  assert.equal(safeDialFailureCode(new Error("E_ACTIVE_THREAD_STALE")), "E_ACTIVE_THREAD_STALE");
  assert.equal(safeDialFailureCode(new Error("E_AGENT_ACTIVATION_UNCHANGED")), "E_AGENT_ACTIVATION_UNCHANGED");
  const fixedName = new Error("private renderer contents");
  fixedName.name = "E_COMMAND_RUNNER_INCOMPATIBLE";
  assert.equal(safeDialFailureCode(fixedName), "E_COMMAND_RUNNER_INCOMPATIBLE");
  assert.equal(safeDialFailureCode(new Error("private renderer contents")), "E_DIAL_UNKNOWN");
  assert.equal(safeDialFailureCode("E_PAGE_STALE"), "E_DIAL_UNKNOWN");

  const messages: string[] = [];
  const logger = streamDeck.logger as unknown as { error(message: string): void };
  const originalError = logger.error;
  logger.error = (message) => { messages.push(message); };
  try {
    const controller = {
      plusDialRotate: async () => { throw new Error("private renderer contents"); },
    } as unknown as DeckController;
    const action = { id: "diagnostic-dial", showAlert: async () => undefined } as unknown as DialAction;
    await new PlusConversationDial(controller).onDialRotate({ action, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  } finally {
    logger.error = originalError;
  }
  assert.deepEqual(messages, ["左右操作 dial rotation failed (E_DIAL_UNKNOWN)."]);
  assert.ok(messages.every((message) => !message.includes("private renderer contents")));
});

function recordFeedback(history: Feedback[], value: Feedback): void {
  history.push({ ...(history.at(-1) ?? {}), ...value });
}

test("mutation tracking preserves an allowlisted bridge diagnostic and redacts an unknown cause", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as {
    microBridge: { runKeycap(): Promise<never> };
  };
  internals.microBridge = { runKeycap: async () => { throw new Error("E_COMMAND_INACTIVE"); } };
  await assert.rejects(controller.runKeycap("PARTY", "known-diagnostic"), /^Error: E_COMMAND_INACTIVE$/);
  internals.microBridge = { runKeycap: async () => { throw new Error("private renderer contents"); } };
  await assert.rejects(controller.runKeycap("PARTY", "unknown-diagnostic"), /^Error: E_ACTION_UNKNOWN$/);
});
