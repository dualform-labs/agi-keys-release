import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import streamDeck from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";

type Manifest = {
  Actions: Array<{ UUID: string }>;
};

type RegisteredAction = {
  manifestId?: string;
  onKeyDown?: (...args: never[]) => unknown;
};

type ActionRegistrationSurface = {
  registerAction(action: RegisteredAction): void;
};

type StreamDeckSurface = {
  connect(): Promise<void>;
  devices: {
    onDeviceDidDisconnect(listener: () => void): unknown;
  };
  settings: {
    onDidReceiveGlobalSettings(listener: (event: unknown) => void): unknown;
  };
};

/**
 * Import the real plugin entrypoint while replacing only its external runtime
 * edges. The decorator-generated manifestId and every registerAction call are
 * left intact, so this is a registration oracle rather than a source scan.
 */
test("plugin registers exactly the manifest actions, including one context compaction action", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  const expectedIds = manifest.Actions.map(({ UUID }) => UUID);
  const expectedIdSet = new Set(expectedIds);
  assert.equal(expectedIds.length, 67, "the current Micro Plus manifest should expose 67 actions");
  assert.equal(expectedIdSet.size, expectedIds.length, "manifest action UUIDs must be unique");

  const registrations: RegisteredAction[] = [];
  const actionSurface = streamDeck.actions as unknown as ActionRegistrationSurface;
  const streamDeckSurface = streamDeck as unknown as StreamDeckSurface;
  const originalRegisterAction = actionSurface.registerAction;
  const originalConnect = streamDeckSurface.connect;
  const originalDisconnectListener = streamDeckSurface.devices.onDeviceDidDisconnect;
  const originalGlobalSettingsListener = streamDeckSurface.settings.onDidReceiveGlobalSettings;
  const originalStart = DeckController.prototype.start;
  const originalStop = DeckController.prototype.stop;

  actionSurface.registerAction = (action) => {
    registrations.push(action);
  };
  streamDeckSurface.connect = async () => undefined;
  streamDeckSurface.devices.onDeviceDidDisconnect = () => undefined;
  streamDeckSurface.settings.onDidReceiveGlobalSettings = () => undefined;
  DeckController.prototype.start = async () => undefined;
  DeckController.prototype.stop = () => Promise.resolve();

  try {
    await import("../src/plugin.js");
  } finally {
    actionSurface.registerAction = originalRegisterAction;
    streamDeckSurface.connect = originalConnect;
    streamDeckSurface.devices.onDeviceDidDisconnect = originalDisconnectListener;
    streamDeckSurface.settings.onDidReceiveGlobalSettings = originalGlobalSettingsListener;
    DeckController.prototype.start = originalStart;
    DeckController.prototype.stop = originalStop;
  }

  assert.equal(registrations.length, expectedIds.length, "plugin registration count must match the manifest");
  const registeredIds = registrations.map(({ manifestId }) => manifestId);
  assert.ok(registeredIds.every((id): id is string => typeof id === "string"), "every registered action must expose a manifestId");
  assert.equal(new Set(registeredIds).size, registrations.length, "plugin must register each action UUID once");
  assert.deepEqual(new Set(registeredIds), expectedIdSet, "runtime registrations must equal manifest UUIDs");

  const contextCompactionId = "io.local.codexdeck.microplus.context-compaction";
  const contextCompactionRegistrations = registrations.filter(({ manifestId }) => manifestId === contextCompactionId);
  assert.equal(contextCompactionRegistrations.length, 1, "context compaction must be registered exactly once");
  assert.equal(typeof contextCompactionRegistrations[0]?.onKeyDown, "function", "context compaction must be executable");
});
