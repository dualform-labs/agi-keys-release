import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DeckController } from "../src/controller.js";
import type { ActionPreferences } from "../src/action-preferences.js";
import { ADDITIONAL_KEYCAPS } from "../src/keycaps.js";
import * as actionExports from "../src/actions.js";
import * as dialExports from "../src/plus-actions.js";

type ManifestAction = {
  UUID: string;
  Controllers: string[];
  PropertyInspectorPath?: string;
};

type Manifest = {
  PropertyInspectorPath?: string;
  Actions: ManifestAction[];
};

type ActionLike = {
  manifestId?: string;
  onDidReceiveSettings?: (event: unknown) => Promise<void> | void;
  onDialDown?: (event: unknown) => Promise<void> | void;
  onDialRotate?: (event: unknown) => Promise<void> | void;
  onDialUp?: (event: unknown) => Promise<void> | void;
  onKeyDown?: (event: unknown) => Promise<void> | void;
  onKeyUp?: (event: unknown) => Promise<void> | void;
  onWillAppear?: (event: unknown) => Promise<void> | void;
  onWillDisappear?: (event: unknown) => Promise<void> | void;
};

type RuntimeCtor = new (controller: DeckController) => ActionLike;
type RuntimeExport = { name: string; ctor: RuntimeCtor };
type RecordedCall = { method: string; args: unknown[] };
type PreferenceUpdate = { actionId: string; preferences: ActionPreferences };
type ActionRef = { id: string };
type KeyContractAction = ActionRef & {
  isKey: () => boolean;
  isDial: () => boolean;
  showAlert: () => Promise<void>;
  showOk: () => Promise<void>;
  setImage: (image?: string) => Promise<void>;
  setTitle: (title?: string) => Promise<void>;
};
type DialContractAction = ActionRef & {
  isKey: () => boolean;
  isDial: () => boolean;
  showAlert: () => Promise<void>;
};

const manifest = JSON.parse(readFileSync(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
const manifestIds = new Set(manifest.Actions.map(({ UUID }) => UUID));
const pluginSource = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");
const sharedInspector = readFileSync(new URL("../static/property-inspector/shared.js", import.meta.url), "utf8");
const registeredClassNames = new Set(
  [...pluginSource.matchAll(/new\s+([A-Za-z_$][\w$]*)\(controller\)/gu)].map((match) => match[1])
);

const runtimeExports: RuntimeExport[] = [...Object.entries(actionExports), ...Object.entries(dialExports)]
  .filter(([, value]) => typeof value === "function")
  .map(([name, value]) => ({ name, ctor: value as unknown as RuntimeCtor }));

function createController() {
  const calls: RecordedCall[] = [];
  const preferenceUpdates: PreferenceUpdate[] = [];
  const preparedActionIds: string[] = [];
  let alerts = 0;
  let oks = 0;
  let microphoneSlot: "ACT10" | "ACT11" = "ACT11";
  let finishRateLimitResetResult = false;
  const record = (method: string, ...args: unknown[]): void => { calls.push({ method, args }); };
  const actionId = (action: ActionRef): string => action.id;
  const controller = {
    calls,
    setActionPreferences: (actionId: string, preferences: ActionPreferences) => {
      preferenceUpdates.push({ actionId, preferences });
    },
    prepareAction: async (actionId: string) => {
      preparedActionIds.push(actionId);
    },
    pressConfiguredDisplayAction: () => undefined,
    releaseConfiguredDisplayAction: () => undefined,
    moveSideDraftToMain: async (ownerId: string) => { record("moveSideDraftToMain", ownerId); },
    isCurrentAction: () => true,
    registerAgent: (slot: number, action: ActionRef) => record("registerAgent", slot, actionId(action)),
    unregisterAgent: (action: ActionRef) => record("unregisterAgent", actionId(action)),
    pressAgent: async (ownerId: string, slot: number) => { record("pressAgent", ownerId, slot); },
    releaseInput: async (ownerId: string) => { record("releaseInput", ownerId); },
    registerMicroAction: (slot: string, action: ActionRef) => record("registerMicroAction", slot, actionId(action)),
    unregisterMicroAction: (action: ActionRef) => record("unregisterMicroAction", actionId(action)),
    pressMicroAction: async (ownerId: string, slot: string) => { record("pressMicroAction", ownerId, slot); },
    registerFixedAction: (id: string, action: ActionRef, source: unknown) => record("registerFixedAction", id, actionId(action), source),
    unregisterFixedAction: (action: ActionRef) => record("unregisterFixedAction", actionId(action)),
    pressJoystick: async (ownerId: string, direction: string) => { record("pressJoystick", ownerId, direction); },
    pressEncoder: async (ownerId: string) => { record("pressEncoder", ownerId); },
    adjustReasoning: async (direction: string, ownerId?: string) => { record("adjustReasoning", direction, ownerId); },
    runKeycap: async (keycapId: string, ownerId: string) => { record("runKeycap", keycapId, ownerId); },
    createTask: async (ownerId: string) => { record("createTask", ownerId); },
    registerUsageLimit: (action: ActionRef, mode: string) => record("registerUsageLimit", actionId(action), mode),
    updateUsageLimitMode: (action: ActionRef, mode: string) => record("updateUsageLimitMode", actionId(action), mode),
    unregisterUsageLimit: (action: ActionRef) => record("unregisterUsageLimit", actionId(action)),
    registerUsageOverview: (action: ActionRef) => record("registerUsageOverview", actionId(action)),
    unregisterUsageOverview: (action: ActionRef) => record("unregisterUsageOverview", actionId(action)),
    registerContextCompaction: (action: ActionRef) => record("registerContextCompaction", actionId(action)),
    unregisterContextCompaction: (action: ActionRef) => record("unregisterContextCompaction", actionId(action)),
    pressContextCompaction: async (ownerId: string) => { record("pressContextCompaction", ownerId); },
    registerRateLimitReset: (action: ActionRef) => record("registerRateLimitReset", actionId(action)),
    unregisterRateLimitReset: (action: ActionRef) => record("unregisterRateLimitReset", actionId(action)),
    beginRateLimitReset: (action: ActionRef) => record("beginRateLimitReset", actionId(action)),
    finishRateLimitReset: async (action: ActionRef) => {
      record("finishRateLimitReset", actionId(action));
      return finishRateLimitResetResult;
    },
    resolveMicrophoneSlot: () => {
      record("resolveMicrophoneSlot");
      return microphoneSlot;
    },
    plusDialDown: async (id: string) => { record("plusDialDown", id); },
    plusDialUp: async (id: string) => { record("plusDialUp", id); },
    plusDialRotate: async (id: string, ticks: number) => { record("plusDialRotate", id, ticks); },
    registerPlusDial: (kind: string, action: ActionRef) => record("registerPlusDial", kind, actionId(action)),
    unregisterPlusDial: (action: ActionRef) => record("unregisterPlusDial", actionId(action)),
  } as unknown as DeckController;

  return {
    controller,
    calls,
    preferenceUpdates,
    preparedActionIds,
    get alerts() { return alerts; },
    get oks() { return oks; },
    set microphoneSlot(value: "ACT10" | "ACT11") { microphoneSlot = value; },
    set finishRateLimitResetResult(value: boolean) { finishRateLimitResetResult = value; },
    alert: async () => { alerts += 1; },
    ok: async () => { oks += 1; },
  };
}

function keyAction(id: string, harness: ReturnType<typeof createController>): KeyContractAction {
  return {
    id,
    isKey: () => true,
    isDial: () => false,
    showAlert: harness.alert,
    showOk: harness.ok,
    setImage: async () => undefined,
    setTitle: async () => undefined,
  };
}

function dialAction(id: string, harness: ReturnType<typeof createController>): DialContractAction {
  return {
    id,
    isKey: () => false,
    isDial: () => true,
    showAlert: harness.alert,
  };
}

function keyEvent(action: KeyContractAction, settings: Record<string, unknown> = {}): unknown {
  return { action, payload: { settings } };
}

function settingsEvent(action: KeyContractAction | DialContractAction, settings: Record<string, unknown>): unknown {
  return { action, payload: { settings } };
}

function dialEvent(action: DialContractAction, ticks?: number): unknown {
  return { action, payload: ticks === undefined ? {} : { ticks } };
}

function tuples(calls: RecordedCall[]): unknown[][] {
  return calls.map(({ method, args }) => [method, ...args]);
}

test("agent lifecycle unregisters even when release and alert delivery both fail", async () => {
  const harness = createController();
  const controller = harness.controller as unknown as {
    releaseConfiguredDisplayAction(actionId: string): Promise<void>;
    unregisterAgent(action: ActionRef): void;
  };
  const calls: string[] = [];
  controller.releaseConfiguredDisplayAction = async () => { throw new Error("release failed"); };
  controller.unregisterAgent = () => { calls.push("unregister"); };
  const key = {
    ...keyAction("agent-alert-failure", harness),
    showAlert: async () => { throw new Error("alert unavailable"); },
  };
  const runtime = new actionExports.Agent1(harness.controller);

  await runtime.onWillDisappear?.(keyEvent(key) as never);

  assert.deepEqual(calls, ["unregister"]);
});

test("a same-id replacement dial owns an independent input incarnation", async () => {
  const harness = createController();
  const controller = harness.controller as unknown as {
    plusDialDown(actionId: string): Promise<void>;
    plusDialUp(actionId: string): Promise<void>;
  };
  let downs = 0;
  let ups = 0;
  let resolveOldRelease!: () => void;
  const oldRelease = new Promise<void>((resolve) => { resolveOldRelease = resolve; });
  controller.plusDialDown = async () => { downs += 1; };
  controller.plusDialUp = async () => {
    ups += 1;
    if (ups === 1) await oldRelease;
  };
  const oldAction = dialAction("reused-dial", harness);
  const replacement = dialAction("reused-dial", harness);
  const runtime = new dialExports.PlusAgentsDial(harness.controller);

  runtime.onWillAppear?.(dialEvent(oldAction) as never);
  await runtime.onDialDown?.(dialEvent(oldAction) as never);
  const disappearance = runtime.onWillDisappear?.(dialEvent(oldAction) as never);
  await Promise.resolve();
  runtime.onWillAppear?.(dialEvent(replacement) as never);
  await runtime.onDialDown?.(dialEvent(replacement) as never);

  assert.equal(downs, 2, "replacement Down must not be swallowed by the old action object");
  resolveOldRelease();
  await disappearance;
  await runtime.onDialUp?.(dialEvent(replacement) as never);
  assert.equal(ups, 2, "replacement Up must release its own input");
});

function runtimeInstances(controller: DeckController): Array<{ name: string; action: ActionLike }> {
  return runtimeExports.map(({ name, ctor }) => ({ name, action: constructRuntime(name, ctor, controller) }));
}

function constructRuntime(name: string, ctor: RuntimeCtor, controller: DeckController): ActionLike {
  if (name === 'GlobalDictationAction') {
    return new actionExports.GlobalDictationAction(controller, {
      press: async () => undefined, release: async () => undefined, stop: async () => undefined,
    }) as unknown as ActionLike;
  }
  return new ctor(controller);
}

function runtimeCtorByManifestId(): Map<string, { name: string; ctor: RuntimeCtor }> {
  const harness = createController();
  return new Map(runtimeInstances(harness.controller).map(({ name, action }) => {
    assert.ok(action.manifestId, `${name} has no @action manifestId`);
    return [action.manifestId, { name, ctor: runtimeExports.find((entry) => entry.name === name)!.ctor }] as const;
  }));
}

function instanceFor(uuid: string, harness: ReturnType<typeof createController>, classes: Map<string, { name: string; ctor: RuntimeCtor }>): ActionLike {
  const entry = classes.get(uuid);
  assert.ok(entry, `missing runtime class for ${uuid}`);
  return constructRuntime(entry.name, entry.ctor, harness.controller);
}

test("all manifest actions have decorated runtime classes registered by plugin.ts", () => {
  const expectedActionCount = manifest.Actions.length;
  assert.equal(runtimeExports.length, expectedActionCount);

  const harness = createController();
  const instances = runtimeInstances(harness.controller);
  assert.equal(new Set(instances.map(({ action }) => action.manifestId)).size, expectedActionCount);

  const runtimeByManifestId = new Map(instances.map(({ name, action }) => [action.manifestId, name]));
  assert.deepEqual(new Set(runtimeByManifestId.keys()), manifestIds);
  for (const { UUID } of manifest.Actions) {
    const className = runtimeByManifestId.get(UUID);
    assert.ok(className, `${UUID} is missing a decorated runtime class`);
    assert.ok(registeredClassNames.has(className), `${className} (${UUID}) is not constructed in plugin.ts`);
  }
  assert.deepEqual(new Set([...runtimeByManifestId.values()]), registeredClassNames);
});

test("every manifest action exposes the per-action language and focus inspector bridge", () => {
  for (const entry of manifest.Actions) {
    const inspectorPath = entry.PropertyInspectorPath ?? manifest.PropertyInspectorPath;
    assert.ok(inspectorPath, `${entry.UUID} has no PropertyInspectorPath or plugin default`);
    const inspector = readFileSync(new URL(`../${inspectorPath}`, import.meta.url), "utf8");
    assert.match(inspector, /id="language"/u, `${entry.UUID} inspector has no language selector`);
    assert.match(inspector, /id="focusBeforeAction"/u, `${entry.UUID} inspector has no focusBeforeAction checkbox`);
    assert.match(inspector, /<script\s+src=["']shared\.js["']><\/script>/u, `${entry.UUID} inspector does not load shared PI runtime`);
  }
  assert.match(sharedInspector, /event:\s*"setSettings"/u, "shared inspector does not send setSettings");
  assert.match(sharedInspector, /didReceiveSettings/u, "shared inspector does not apply didReceiveSettings");
  assert.match(sharedInspector, /globalSettings = \{ \.\.\.globalSettings, showContextRings:/u, "shared inspector must preserve unknown global settings");
});

test("every manifest action forwards ja/en and focusBeforeAction settings by action ID", async () => {
  const classes = runtimeCtorByManifestId();
  const covered = new Set<string>();

  for (const entry of manifest.Actions) {
    const harness = createController();
    const action = entry.Controllers.includes("Encoder")
      ? dialAction(entry.UUID, harness)
      : keyAction(entry.UUID, harness);
    const runtime = instanceFor(entry.UUID, harness, classes);

    await runtime.onWillAppear?.(settingsEvent(action, {
      language: "en",
      focusBeforeAction: true,
      ...(entry.UUID.endsWith("usage-limit") ? { mode: "weekly" } : {}),
    }));
    await runtime.onDidReceiveSettings?.(settingsEvent(action, {
      language: "ja",
      focusBeforeAction: false,
      ...(entry.UUID.endsWith("usage-limit") ? { mode: "five-hour" } : {}),
    }));

    const updates = harness.preferenceUpdates.filter(({ actionId }) => actionId === entry.UUID);
    assert.equal(updates.length, 2, `${entry.UUID} must sync appear and receive settings`);
    assert.deepEqual(updates.map(({ actionId, preferences }) => ({
      actionId,
      language: preferences.language,
      focusBeforeAction: preferences.focusBeforeAction,
    })), [
      { actionId: entry.UUID, language: "en", focusBeforeAction: true },
      { actionId: entry.UUID, language: "ja", focusBeforeAction: false },
    ], entry.UUID);
    covered.add(entry.UUID);
  }

  assert.deepEqual(covered, manifestIds, "every manifest action must sync per-action settings");
});

test("every manifest action routes its family events to exact controller calls", async () => {
  const classes = runtimeCtorByManifestId();
  const covered = new Set<string>();

  // Native six-slot agent actions: key down and key up retain the physical slot.
  for (let slot = 0; slot < 6; slot += 1) {
    const uuid = `io.local.codexdeck.microplus.agent-${slot + 1}`;
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerAgent", slot, uuid],
      ["pressAgent", uuid, slot],
      ["releaseInput", uuid],
      ["releaseInput", uuid],
      ["unregisterAgent", uuid],
    ], uuid);
    covered.add(uuid);
  }

  // ACT actions carry the Stream Deck action ID as the owner while retaining their physical slot.
  const microSlots: Record<string, string> = {
    fast: "ACT06",
    approve: "ACT07",
    decline: "ACT08",
    fork: "ACT09",
    dictation: "ACT10",
    act11: "ACT11",
    send: "ACT12",
  };
  for (const [suffix, physicalSlot] of Object.entries(microSlots)) {
    const uuid = `io.local.codexdeck.microplus.${suffix}`;
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerMicroAction", physicalSlot, uuid],
      ["pressMicroAction", uuid, physicalSlot],
      ["releaseInput", uuid],
      ["releaseInput", uuid],
      ["unregisterMicroAction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  // The four keypad joystick actions preserve native direction and down/up distance.
  const joystickDirections: Record<string, { direction: string; icon: string }> = {
    plan: { direction: "up", icon: "up" },
    back: { direction: "left", icon: "back" },
    forward: { direction: "right", icon: "forward" },
    sidebar: { direction: "down", icon: "sidebar" },
  };
  for (const [suffix, { direction, icon }] of Object.entries(joystickDirections)) {
    const uuid = `io.local.codexdeck.microplus.${suffix}`;
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerFixedAction", `joystick-${direction}`, uuid, { kind: "builtin", name: icon }],
      ["pressJoystick", uuid, direction],
      ["releaseInput", uuid],
      ["releaseInput", uuid],
      ["unregisterFixedAction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  {
    const uuid = "io.local.codexdeck.microplus.reasoning";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerFixedAction", "reasoning", uuid, { kind: "builtin", name: "encoder" }],
      ["pressEncoder", uuid],
      ["releaseInput", uuid],
      ["releaseInput", uuid],
      ["unregisterFixedAction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  const reasoningDirections: Record<string, { direction: "increase" | "decrease"; keycapId: "MIND+" | "MIND-" }> = {
    "reasoning-down": { direction: "decrease", keycapId: "MIND-" },
    "reasoning-up": { direction: "increase", keycapId: "MIND+" },
  };
  for (const [suffix, contract] of Object.entries(reasoningDirections)) {
    const uuid = `io.local.codexdeck.microplus.${suffix}`;
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerFixedAction", `reasoning-${contract.direction}`, uuid, { kind: "local", keycapId: contract.keycapId }],
      ["adjustReasoning", contract.direction, uuid],
      ["unregisterFixedAction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  // Every plugin dial exercises registration, press, one signed tick, and release.
  const dialKinds: Record<string, string> = {
    "dial-agent": "agents",
    "dial-reasoning": "reasoning",
    "dial-conversation": "navigation",
    "dial-commands": "commands",
    "dial-usage": "usage",
    "dial-model": "model",
  };
  for (const [suffix, kind] of Object.entries(dialKinds)) {
    const uuid = `io.local.codexdeck.microplus.${suffix}`;
    const harness = createController();
    const action = dialAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(dialEvent(action));
    await runtime.onDialDown?.(dialEvent(action));
    await runtime.onDialRotate?.(dialEvent(action, -2));
    await runtime.onDialUp?.(dialEvent(action));
    await runtime.onWillDisappear?.(dialEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerPlusDial", kind, uuid],
      ["plusDialDown", uuid],
      ["plusDialRotate", uuid, -2],
      ["plusDialUp", uuid],
      ["plusDialUp", uuid],
      ["unregisterPlusDial", uuid],
    ], uuid);
    covered.add(uuid);
  }

  // Keycap IDs come from the real static catalog, so this does not duplicate the implementation's constructor map.
  const keycapIds = new Map<string, string>(ADDITIONAL_KEYCAPS.map(({ slug, id }) => [slug, id]));
  for (const entry of manifest.Actions.filter(({ UUID }) => UUID.includes(".keycap-"))) {
    const suffix = entry.UUID.slice(entry.UUID.indexOf(".keycap-") + ".keycap-".length);
    const keycapId = keycapIds.get(suffix);
    assert.ok(keycapId, `${entry.UUID} is missing from ADDITIONAL_KEYCAPS`);
    const harness = createController();
    const action = keyAction(entry.UUID, harness);
    const runtime = instanceFor(entry.UUID, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    if (keycapId === "MIC" || keycapId === "MIC1") {
      harness.microphoneSlot = "ACT10";
      await runtime.onKeyDown?.(keyEvent(action));
      await runtime.onKeyUp?.(keyEvent(action));
      await runtime.onWillDisappear?.(keyEvent(action));
      assert.deepEqual(tuples(harness.calls), [
        ["registerFixedAction", `keycap-${keycapId}`, entry.UUID, { kind: "local", keycapId }],
        ["resolveMicrophoneSlot"],
        ["pressMicroAction", entry.UUID, "ACT10"],
        ["releaseInput", entry.UUID],
        ["releaseInput", entry.UUID],
        ["unregisterFixedAction", entry.UUID],
      ], entry.UUID);
    } else {
      await runtime.onKeyDown?.(keyEvent(action));
      await runtime.onWillDisappear?.(keyEvent(action));
      assert.deepEqual(tuples(harness.calls), [
        ["registerFixedAction", `keycap-${keycapId}`, entry.UUID, { kind: "local", keycapId }],
        ["runKeycap", keycapId, entry.UUID],
        ["unregisterFixedAction", entry.UUID],
      ], entry.UUID);
    }
    covered.add(entry.UUID);
  }

  {
    const uuid = "io.local.codexdeck.microplus.new-task";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerFixedAction", "new-task", uuid, { kind: "local", keycapId: "NEW" }],
      ["createTask", uuid],
      ["unregisterFixedAction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  {
    const uuid = "io.local.codexdeck.microplus.usage-limit";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action, { mode: "weekly" }));
    await runtime.onDidReceiveSettings?.(keyEvent(action, { mode: "five-hour" }));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerUsageLimit", uuid, "weekly"],
      ["updateUsageLimitMode", uuid, "five-hour"],
      ["unregisterUsageLimit", uuid],
    ], uuid);
    covered.add(uuid);
  }

  {
    const uuid = "io.local.codexdeck.microplus.usage-overview";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerUsageOverview", uuid],
      ["unregisterUsageOverview", uuid],
    ], uuid);
    covered.add(uuid);
  }

  {
    const uuid = "io.local.codexdeck.microplus.context-compaction";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerContextCompaction", uuid],
      ["pressContextCompaction", uuid],
      ["unregisterContextCompaction", uuid],
    ], uuid);
    covered.add(uuid);
  }

  {
    const uuid = "io.local.codexdeck.microplus.rate-limit-reset";
    const harness = createController();
    const action = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(action));
    await runtime.onKeyDown?.(keyEvent(action));
    await runtime.onKeyUp?.(keyEvent(action));
    await runtime.onWillDisappear?.(keyEvent(action));
    assert.deepEqual(tuples(harness.calls), [
      ["registerRateLimitReset", uuid],
      ["beginRateLimitReset", uuid],
      ["finishRateLimitReset", uuid],
      ["unregisterRateLimitReset", uuid],
    ], uuid);
    assert.equal(harness.oks, 0, "short fake hold must not report a reset success");
    covered.add(uuid);
  }

  {
    const uuid = 'io.local.codexdeck.microplus.side-to-main';
    const harness = createController();
    const key = keyAction(uuid, harness);
    const runtime = instanceFor(uuid, harness, classes);
    await runtime.onWillAppear?.(keyEvent(key));
    await runtime.onKeyDown?.(keyEvent(key));
    await runtime.onWillDisappear?.(keyEvent(key));
    assert.deepEqual(tuples(harness.calls), [
      ['registerFixedAction', 'side-to-main', uuid, { kind: 'builtin', name: 'side-to-main' }],
      ['moveSideDraftToMain', uuid], ['unregisterFixedAction', uuid],
    ]);
    covered.add(uuid);
  }
  {
    const uuid = 'io.local.codexdeck.microplus.global-dictation';
    const harness = createController();
    const key = keyAction(uuid, harness);
    const calls: string[] = [];
    const runtime = new actionExports.GlobalDictationAction(harness.controller, {
      press: async (id) => { calls.push(`down:${id}`); },
      release: async (id) => { calls.push(`up:${id}`); },
      stop: async () => undefined,
    });
    await runtime.onWillAppear(keyEvent(key) as never);
    await runtime.onKeyDown(keyEvent(key) as never);
    await runtime.onKeyUp(keyEvent(key) as never);
    await runtime.onWillDisappear(keyEvent(key) as never);
    assert.equal(calls.length, 2);
    assert.match(calls[0] ?? "", new RegExp(`^down:${uuid.replaceAll(".", "\\.")}:dictation:\\d+$`, "u"));
    assert.equal(calls[1], calls[0]?.replace(/^down:/u, "up:"));
    covered.add(uuid);
  }
  assert.deepEqual(covered, manifestIds, "every manifest action must be exercised by a family contract");
});
