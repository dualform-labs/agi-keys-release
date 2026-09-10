import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DidReceiveSettingsEvent, WillAppearEvent } from "@elgato/streamdeck";
import {
  DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS,
  displayLanguageFromLocale,
  parseActionPreferences,
  parseDialGesturePreferences,
  PreferenceAction,
  type ActionPreferences,
} from "../src/action-preferences.js";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";

test("action preferences normalize untrusted per-instance settings", () => {
  assert.deepEqual(parseActionPreferences(null), {
    language: "ja",
    focusBeforeAction: false,
    unopenedTaskBehavior: "current-window",
    label: "",
    textSize: "normal",
    showDetails: true,
    theme: "auto",
    animation: true,
    reverseDial: false,
    dialStep: 1,
    pressBehavior: "none",
    pressCommand: null,
  });
  assert.deepEqual(parseActionPreferences({
    language: "en",
    focusBeforeAction: true,
    unopenedTaskBehavior: "new-window",
    label: `  custom\u0000 ${"長".repeat(30)}  `,
    textSize: "large",
    showDetails: false,
    theme: "light",
    animation: false,
    reverseDial: true,
    dialStep: 3,
    pressBehavior: "command",
    pressCommand: "TERM",
  }), {
    language: "en",
    focusBeforeAction: true,
    unopenedTaskBehavior: "new-window",
    label: `custom ${"長".repeat(17)}`,
    textSize: "large",
    showDetails: false,
    theme: "light",
    animation: false,
    reverseDial: true,
    dialStep: 3,
    pressBehavior: "command",
    pressCommand: "TERM",
  });
  assert.deepEqual(parseActionPreferences("invalid"), parseActionPreferences(undefined));
  assert.equal(parseActionPreferences({ dialStep: "3", theme: "system", language: "fr" }).dialStep, 1);
  assert.equal(parseActionPreferences({ unopenedTaskBehavior: "new-window" }).unopenedTaskBehavior, "new-window");
  assert.equal(parseActionPreferences({ unopenedTaskBehavior: "invalid" }).unopenedTaskBehavior, "current-window");
  assert.deepEqual(
    parseActionPreferences({ pressBehavior: "command", pressCommand: "EMPT1" }),
    { ...parseActionPreferences(undefined), pressBehavior: "command" },
    "configurable placeholders are not executable commands",
  );
  assert.equal(parseActionPreferences({ pressBehavior: "command", pressCommand: "MIC" }).pressCommand, null);
  assert.equal(parseActionPreferences({ pressBehavior: "command", pressCommand: "MIC1" }).pressCommand, null);
  assert.equal(parseActionPreferences({ pressBehavior: "refresh", pressCommand: "TERM" }).pressBehavior, "refresh");
  for (const pressBehavior of ["model-next", "model-previous", "reasoning-increase", "reasoning-decrease"] as const) {
    assert.equal(parseActionPreferences({ pressBehavior }).pressBehavior, pressBehavior);
  }
  assert.equal(parseActionPreferences({ pressBehavior: "model-increase" }).pressBehavior, "none");
});

test("host locale supplies the default display language while explicit settings win", () => {
  assert.equal(displayLanguageFromLocale("en"), "en");
  assert.equal(displayLanguageFromLocale("en-US"), "en");
  assert.equal(displayLanguageFromLocale("en_GB"), "en");
  assert.equal(displayLanguageFromLocale("ja-JP"), "ja");
  assert.equal(displayLanguageFromLocale("fr-FR"), "ja");

  assert.equal(parseActionPreferences({}, "en").language, "en");
  assert.equal(parseActionPreferences({ language: "ja" }, "en").language, "ja");
  assert.equal(parseActionPreferences({ language: "en" }, "ja").language, "en");
  assert.equal(parseActionPreferences({ language: "fr" }, "en").language, "en");
});

test("dial gesture preferences normalize explicit and legacy touch settings", () => {
  assert.deepEqual(parseDialGesturePreferences(undefined), {
    touch: "press",
    longPress: "none",
  });
  assert.deepEqual(parseDialGesturePreferences({
    dialTouchBehavior: "none",
    dialLongPressBehavior: "press",
  }), {
    touch: "none",
    longPress: "press",
  });
  assert.deepEqual(parseDialGesturePreferences({
    gestures: {
      dialLongPress: { actionId: "dial-reasoning", gesture: "long-press" },
      touchTap: { actionId: "dial-reasoning", gesture: "touch" },
    },
  }), {
    touch: "press",
    longPress: "press",
  });
  assert.deepEqual(parseDialGesturePreferences({
    dialTouchBehavior: "unsafe-command",
    dialLongPressBehavior: "unsafe-command",
    gestures: { dialLongPress: { enabled: false } },
  }), {
    touch: "press",
    longPress: "none",
  });
});

test("common and specialized property inspectors expose every per-instance preference", async () => {
  const files = await Promise.all(["common.html", "agent.html", "usage-limit.html"].map(async (name) => ({
    name,
    source: await readFile(new URL(`../static/property-inspector/${name}`, import.meta.url), "utf8"),
  })));
  const shared = await readFile(new URL("../static/property-inspector/shared.js", import.meta.url), "utf8");
  const commonIds = ["label", "language", "textSize", "theme", "showDetails", "animation", "focusBeforeAction"];
  for (const { name, source } of files) {
    for (const id of commonIds) assert.match(source, new RegExp(`id=["']${id}["']`), `${name} lacks ${id}`);
    assert.match(source, /<script\s+src=["']shared\.js["']><\/script>/u, `${name} lacks the shared PI runtime`);
  }
  assert.match(shared, /event:\s*"setSettings"/u, "shared PI runtime does not send settings");
  assert.match(shared, /didReceiveSettings/u, "shared PI runtime does not apply settings responses");
  assert.match(shared, /globalSettings = \{ \.\.\.globalSettings, showContextRings:/u, "global settings must merge unknown fields");
  const common = files.find(({ name }) => name === "common.html")?.source ?? "";
  assert.match(shared, /action\.payload\?\.controller !== "Encoder"/u);
  assert.match(common, /id="reverseDial"/);
  assert.match(common, /id="dialStep"/);
  assert.match(common, /id="dialTouchBehavior"/);
  assert.match(common, /id="dialLongPressBehavior"/);
  assert.match(files.find(({ name }) => name === "agent.html")?.source ?? "", /show-context-rings/);
  assert.doesNotMatch(files.find(({ name }) => name === "agent.html")?.source ?? "", /id="unopenedTaskBehavior"/);
  assert.match(files.find(({ name }) => name === "agent.html")?.source ?? "", /id="unopened-task-help"/);
  assert.match(shared, /unopenedTaskBehavior/u);
  assert.match(shared, /current-window/u);
  assert.match(shared, /new-window/u);
  const usage = files.find(({ name }) => name === "usage-limit.html")?.source ?? "";
  assert.match(usage, /id="mode"/);
  assert.match(usage, /id="pressBehavior"/);
  assert.match(usage, /id="pressCommand"/);
  assert.match(usage, /value="command"/);
  assert.doesNotMatch(usage, /value="EMPT[1-5]"/);
  const commandSelect = usage.match(/<select id="pressCommand">([\s\S]*?)<\/select>/u)?.[1];
  assert.ok(commandSelect);
  const commandOptions = commandSelect.matchAll(/<option value="([^"]*)">/gu);
  assert.deepEqual(
    new Set([...commandOptions].map((match) => match[1]).filter(Boolean)),
    new Set(OFFICIAL_KEYCAP_IDS.filter((id) => !(DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS as readonly string[]).includes(id))),
    "the inspector command catalog must exactly match executable native keycaps",
  );
});

test("preference action synchronizes appearance and later instance setting changes", () => {
  const calls: Array<{ id: string; preferences: ActionPreferences }> = [];
  class HarnessAction extends PreferenceAction {
    constructor() {
      super({ setActionPreferences: (id, preferences) => { calls.push({ id, preferences }); } });
    }
    appear(ev: WillAppearEvent): void { this.syncActionPreferences(ev); }
  }
  const action = new HarnessAction();
  const actionRef = { id: "instance-a" };
  action.appear({ action: actionRef, payload: { settings: { language: "en", label: "First" } } } as unknown as WillAppearEvent);
  action.onDidReceiveSettings({ action: actionRef, payload: { settings: { focusBeforeAction: true, reverseDial: true, dialStep: 2 } } } as unknown as DidReceiveSettingsEvent);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.preferences.language, "en");
  assert.equal(calls[0]?.preferences.label, "First");
  assert.equal(calls[1]?.preferences.focusBeforeAction, true);
  assert.equal(calls[1]?.preferences.reverseDial, true);
  assert.equal(calls[1]?.preferences.dialStep, 2);
});

test("dial-only controls use the SDK ActionInfo payload controller field", async () => {
  const [uiTypes, actionTypes, common] = await Promise.all([
    readFile(new URL("../node_modules/@elgato/streamdeck/dist/api/registration/ui.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../node_modules/@elgato/streamdeck/dist/api/events/action.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../static/property-inspector/shared.js", import.meta.url), "utf8"),
  ]);
  assert.match(uiTypes, /readonly payload: MultiActionPayload<TSettings> \| SingleActionPayload<TSettings>/);
  assert.match(actionTypes, /readonly controller: TController/);
  assert.match(common, /action\.payload\?\.controller !== "Encoder"/u);
  assert.doesNotMatch(common, /action\.controller(?!\?)/u);
});
