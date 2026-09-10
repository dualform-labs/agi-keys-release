import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawnSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { GlobalDictationAction } from "../src/global-dictation-action.js";
import {
  materializeGlobalDictationHelper,
  launchNativeRightCommand,
  launchNativeRightOptionToggle,
  preflightNativeRightCommand,
  RightCommandHold,
  stageGlobalDictationHelper,
  stopChild,
  type RightCommandSession
} from "../src/global-dictation.js";

class Session implements RightCommandSession {
  stops = 0;
  async stop(): Promise<void> { this.stops += 1; }
}

test("a new press waits for the previous native release to finish", async () => {
  let finishRelease!: () => void;
  let releaseStarted!: () => void;
  const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
  const released = new Promise<void>((resolve) => { finishRelease = resolve; });
  const replacement = new Session();
  let launches = 0;
  const hold = new RightCommandHold(async () => {
    launches += 1;
    return launches === 1
      ? { async stop() { releaseStarted(); await released; } }
      : replacement;
  });
  await hold.press("first");
  const releasing = hold.release("first");
  await started;
  const pressing = hold.press("second");
  await Promise.resolve();
  assert.equal(launches, 1, "a pending key-up must prevent overlapping native helpers");
  finishRelease();
  await Promise.all([releasing, pressing]);
  assert.equal(launches, 2);
  assert.equal(hold.activeOwnerCount, 1);
  await hold.release("second");
  assert.equal(replacement.stops, 1);
  assert.equal(hold.activeOwnerCount, 0);
});

test("materializes a non-executable packaged helper as an exact private executable", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "package", "global-dictation-helper");
  const stateRoot = join(directory, "state");
  const bytes = Buffer.from("packaged native helper\n", "utf8");
  await mkdir(join(directory, "package"));
  await writeFile(bundled, bytes, { mode: 0o666 });
  assert.equal((await stat(bundled)).mode & 0o111, 0, "fixture must reproduce the installer permission loss");

  const executable = await materializeGlobalDictationHelper(bundled, stateRoot);

  assert.deepEqual(await readFile(executable), bytes);
  assert.equal((await stat(executable)).mode & 0o777, 0o700);
  assert.equal((await stat(bundled)).mode & 0o111, 0, "packaged payload must remain untouched");
});

test("repairs permissions only after cached helper content is verified", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-cache-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "global-dictation-helper");
  const stateRoot = join(directory, "state");
  await writeFile(bundled, "trusted helper\n", { mode: 0o644 });
  const executable = await materializeGlobalDictationHelper(bundled, stateRoot);

  await chmod(executable, 0o666);
  assert.equal(await materializeGlobalDictationHelper(bundled, stateRoot), executable);
  assert.equal((await stat(executable)).mode & 0o777, 0o700);

  await chmod(executable, 0o666);
  await writeFile(executable, "different bytes\n");
  await assert.rejects(
    materializeGlobalDictationHelper(bundled, stateRoot),
    /E_GLOBAL_DICTATION_HELPER_INTEGRITY/u
  );
  assert.equal((await stat(executable)).mode & 0o777, 0o666, "untrusted content must not be chmodded");
});

test("refuses to chmod a cached helper with another hard link", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-link-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "global-dictation-helper");
  const stateRoot = join(directory, "state");
  await writeFile(bundled, "trusted helper\n", { mode: 0o644 });
  const executable = await materializeGlobalDictationHelper(bundled, stateRoot);
  await chmod(executable, 0o666);
  await link(executable, join(directory, "shared-link"));

  await assert.rejects(
    materializeGlobalDictationHelper(bundled, stateRoot),
    /E_GLOBAL_DICTATION_HELPER_UNSAFE/u
  );
  assert.equal((await stat(executable)).mode & 0o777, 0o666);
});

test("rejects a state directory with a symlinked ancestor", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-ancestor-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "global-dictation-helper");
  const realState = join(directory, "real-state");
  const symlinkedParent = join(directory, "state-parent");
  await writeFile(bundled, "trusted helper\n", { mode: 0o644 });
  await mkdir(realState);
  await symlink(realState, symlinkedParent, "dir");

  await assert.rejects(
    materializeGlobalDictationHelper(bundled, join(symlinkedParent, "native")),
    /E_GLOBAL_DICTATION_RUNTIME_UNSAFE/u
  );
  await assert.rejects(stat(join(realState, "native")), { code: "ENOENT" });
});

test("rejects a packaged helper below a symlinked ancestor", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-helper-ancestor-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const realPackage = join(directory, "real-package");
  const symlinkedPackage = join(directory, "package-link");
  const bundled = join(symlinkedPackage, "global-dictation-helper");
  await mkdir(realPackage);
  await writeFile(join(realPackage, "global-dictation-helper"), "trusted helper\n", { mode: 0o644 });
  await symlink(realPackage, symlinkedPackage, "dir");

  await assert.rejects(
    materializeGlobalDictationHelper(bundled, join(directory, "state")),
    /E_GLOBAL_DICTATION_RUNTIME_UNSAFE/u
  );
});

test("a packaged-helper replacement after verification cannot change the staged executable", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-stage-race-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "package", "global-dictation-helper");
  const stateRoot = join(directory, "state");
  await mkdir(join(directory, "package"));
  await writeFile(bundled, "#!/bin/sh\nprintf 'TRUSTED\\n'\n", { mode: 0o700 });

  const staged = await stageGlobalDictationHelper(bundled, stateRoot);
  t.after(staged.cleanup);
  const attacker = join(directory, "attacker-helper");
  await writeFile(attacker, "#!/bin/sh\nprintf 'ATTACKER\\n'\n", { mode: 0o700 });
  await rename(attacker, bundled);

  const result = spawnSync(staged.executablePath, [], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "TRUSTED\n");
  assert.notEqual(staged.executablePath, bundled, "spawn path must be a private single-use copy");

  const cleaning = staged.cleanup();
  assert.equal(staged.cleanup(), cleaning, "concurrent cleanup callers must await the same completion");
  await cleaning;
  await assert.rejects(stat(staged.executablePath), { code: "ENOENT" });
});

test("native preflight materializes the helper without executing its key-down path", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-dictation-preflight-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const bundled = join(directory, "package", "global-dictation-helper");
  const stateRoot = join(directory, "state");
  const marker = join(directory, "posted-key-event");
  await mkdir(join(directory, "package"));
  await writeFile(bundled, `#!/bin/sh\nif [ "$1" = "--preflight" ]; then printf 'READY\\n'; exit 0; fi\nprintf posted > '${marker}'\n`, { mode: 0o600 });

  await preflightNativeRightCommand(bundled, stateRoot);

  await assert.rejects(stat(marker), { code: "ENOENT" });
  assert.equal((await stat(stateRoot)).mode & 0o777, 0o700);
});

test("right Command remains held until every Stream Deck owner releases it", async () => {
  const sessions: Session[] = [];
  const hold = new RightCommandHold(async () => {
    const session = new Session();
    sessions.push(session);
    return session;
  });

  await hold.press("first");
  await hold.press("first");
  await hold.press("second");
  assert.equal(sessions.length, 1);

  await hold.release("first");
  assert.equal(sessions[0]?.stops, 0);
  await hold.release("second");
  assert.equal(sessions[0]?.stops, 1);
  await hold.release("second");
  assert.equal(sessions[0]?.stops, 1);
});

test("shutdown releases an active right Command hold exactly once", async () => {
  const session = new Session();
  const hold = new RightCommandHold(async () => session);
  await hold.press("key-a");
  await hold.press("key-b");

  await hold.stop();
  await hold.stop();
  assert.equal(session.stops, 1);
  assert.equal(hold.activeOwnerCount, 0);
});

test("device disconnect releases all owners and allows a later press", async () => {
  const sessions: Session[] = [];
  const hold = new RightCommandHold(async () => {
    const session = new Session();
    sessions.push(session);
    return session;
  });
  await hold.press("key-a");
  await hold.releaseAll();
  await hold.press("key-b");

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.stops, 1);
  assert.equal(hold.activeOwnerCount, 1);
  await hold.release("key-b");
});

test("a failed release quarantines the native hold until a retry confirms release", async () => {
  let launches = 0;
  let releaseAttempts = 0;
  const first: RightCommandSession = {
    stop: async () => {
      releaseAttempts += 1;
      if (releaseAttempts === 1) throw new Error("release confirmation unavailable");
    },
  };
  const second = new Session();
  const hold = new RightCommandHold(async () => {
    launches += 1;
    return launches === 1 ? first : second;
  });

  await hold.press("key-a");
  await assert.rejects(hold.release("key-a"), /release confirmation unavailable/u);
  await hold.press("key-b");

  assert.equal(releaseAttempts, 2, "the uncertain native hold must be retried before another launch");
  assert.equal(launches, 2);
  await hold.release("key-b");
});

test("a still-unconfirmed release blocks a replacement helper launch", async () => {
  let launches = 0;
  const hold = new RightCommandHold(async () => {
    launches += 1;
    return { stop: async () => { throw new Error("release still unconfirmed"); } };
  });

  await hold.press("key-a");
  await assert.rejects(hold.release("key-a"), /release still unconfirmed/u);
  await assert.rejects(hold.press("key-b"), /release still unconfirmed/u);

  assert.equal(launches, 1, "quarantine must prevent a second native helper");
  assert.equal(hold.activeOwnerCount, 0);
});

test("shutdown retries release when a delayed launch could not confirm cleanup", async () => {
  let resolveLaunch: ((session: RightCommandSession) => void) | undefined;
  let releaseAttempts = 0;
  const session: RightCommandSession = {
    stop: async () => {
      releaseAttempts += 1;
      if (releaseAttempts === 1) throw new Error("first shutdown release failed");
    },
  };
  const hold = new RightCommandHold(() => new Promise<RightCommandSession>((resolve) => { resolveLaunch = resolve; }));

  const press = hold.press("key-a");
  await Promise.resolve();
  assert.ok(resolveLaunch);
  const firstStop = hold.stop();
  resolveLaunch?.(session);

  await assert.rejects(press, /first shutdown release failed/u);
  await firstStop;
  await hold.stop();
  assert.equal(releaseAttempts, 2, "a later shutdown must retry the unconfirmed release");
});

test("a failed native press does not retain an owner", async () => {
  const hold = new RightCommandHold(async () => { throw new Error("right Command is already held"); });
  await assert.rejects(hold.press("key-a"), /already held/);
  assert.equal(hold.activeOwnerCount, 0);
});

test("a stale failed launch cannot delete a newer press from the same owner", async () => {
  let rejectFirst: ((error: Error) => void) | undefined;
  let launches = 0;
  const session = new Session();
  const hold = new RightCommandHold(() => {
    launches += 1;
    if (launches === 1) return new Promise<RightCommandSession>((_resolve, reject) => { rejectFirst = reject; });
    return Promise.resolve(session);
  });

  const first = hold.press("key-a");
  await Promise.resolve();
  assert.ok(rejectFirst);
  const released = hold.release("key-a");
  const second = hold.press("key-a");
  rejectFirst?.(new Error("first launch failed"));

  await assert.rejects(first, /first launch failed/);
  await released;
  await second;
  assert.equal(launches, 2);
  assert.equal(hold.activeOwnerCount, 1);
  await hold.release("key-a");
});

test("release and re-press during a successful launch retains the newer owner", async () => {
  let resolveLaunch: ((session: RightCommandSession) => void) | undefined;
  const session = new Session();
  const hold = new RightCommandHold(() => new Promise<RightCommandSession>((resolve) => { resolveLaunch = resolve; }));

  const first = hold.press("key-a");
  await Promise.resolve();
  assert.ok(resolveLaunch);
  const released = hold.release("key-a");
  const second = hold.press("key-a");
  resolveLaunch?.(session);

  await first;
  await released;
  await second;
  assert.equal(hold.activeOwnerCount, 1);
  assert.equal(session.stops, 0);
  await hold.release("key-a");
  assert.equal(session.stops, 1);
});

test("a quick key-up releases a hold that starts after delayed preparation", async (t) => {
  let finishPreparation: (() => void) | undefined;
  let launches = 0;
  const session = new Session();
  const nativeHold = new RightCommandHold(async () => { launches += 1; return session; });
  const controller = {
    setActionPreferences: () => undefined,
    prepareAction: () => new Promise<void>((resolve) => { finishPreparation = resolve; })
  };
  const action = new GlobalDictationAction(controller as never, nativeHold);
  const key = {
    id: "quick-dictation-key",
    isKey: () => true,
    setImage: async () => undefined,
    showAlert: async () => undefined
  };
  t.after(async () => { await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent); });
  action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent);

  const down = action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await Promise.resolve();
  assert.ok(finishPreparation, "key-down must be waiting for preparation");
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  finishPreparation?.();
  await down;

  assert.equal(nativeHold.activeOwnerCount, 0);
  assert.equal(launches, 0, "a released key must not start the native helper after preparation");
  assert.equal(session.stops, 0);
});

test("a stale delayed key-down does not release a newer press of the same key", async (t) => {
  let finishFirstPreparation: (() => void) | undefined;
  let preparations = 0;
  const session = new Session();
  const nativeHold = new RightCommandHold(async () => session);
  t.after(async () => { await nativeHold.releaseAll(); });
  const controller = {
    setActionPreferences: () => undefined,
    prepareAction: () => {
      preparations += 1;
      return preparations === 1
        ? new Promise<void>((resolve) => { finishFirstPreparation = resolve; })
        : Promise.resolve();
    }
  };
  const action = new GlobalDictationAction(controller as never, nativeHold);
  const key = {
    id: "repressed-dictation-key",
    isKey: () => true,
    setImage: async () => undefined,
    showAlert: async () => undefined
  };
  t.after(async () => { await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent); });
  action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent);

  const staleDown = action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await Promise.resolve();
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  finishFirstPreparation?.();
  await staleDown;

  assert.equal(nativeHold.activeOwnerCount, 1, "the newer physical press must remain held");
  assert.equal(session.stops, 0);
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  assert.equal(session.stops, 1);
});

test("a delayed key-down from a replaced key cannot release the replacement hold", async (t) => {
  let finishFirstPreparation: (() => void) | undefined;
  let preparations = 0;
  const session = new Session();
  const nativeHold = new RightCommandHold(async () => session);
  t.after(async () => { await nativeHold.releaseAll(); });
  const controller = {
    setActionPreferences: () => undefined,
    prepareAction: () => {
      preparations += 1;
      return preparations === 1
        ? new Promise<void>((resolve) => { finishFirstPreparation = resolve; })
        : Promise.resolve();
    }
  };
  const action = new GlobalDictationAction(controller as never, nativeHold);
  const oldKey = fakeActionKey("replaced-dictation-key");
  const replacementKey = fakeActionKey("replaced-dictation-key");
  t.after(async () => {
    await action.onWillDisappear({ action: replacementKey } as unknown as WillDisappearEvent);
  });
  action.onWillAppear({ action: oldKey, payload: { settings: {} } } as unknown as WillAppearEvent);

  const staleDown = action.onKeyDown({ action: oldKey } as unknown as KeyDownEvent);
  await Promise.resolve();
  await action.onWillDisappear({ action: oldKey } as unknown as WillDisappearEvent);
  action.onWillAppear({ action: replacementKey, payload: { settings: {} } } as unknown as WillAppearEvent);
  await action.onKeyDown({ action: replacementKey } as unknown as KeyDownEvent);
  finishFirstPreparation?.();
  await staleDown;

  assert.equal(nativeHold.activeOwnerCount, 1, "the replacement key must retain its own native hold");
  assert.equal(session.stops, 0);
  await action.onKeyUp({ action: replacementKey } as unknown as KeyUpEvent);
  assert.equal(session.stops, 1);
});

test("action releases right Command on key-up or disappearance", async () => {
  const calls: string[] = [];
  const hold = {
    press: async (owner: string) => { calls.push(`down:${owner}`); },
    release: async (owner: string) => { calls.push(`up:${owner}`); },
    stop: async () => undefined
  };
  const controller = {
    registerFixedAction: () => undefined,
    unregisterFixedAction: () => undefined,
    setActionPreferences: () => undefined,
    prepareAction: async () => undefined
  };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = { id: "dictation-key", isKey: () => true, setImage: async () => undefined, showAlert: async () => undefined };

  action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent);
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent);

  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? "", /^down:dictation-key:dictation:\d+$/u);
  assert.equal(calls[1], calls[0]?.replace(/^down:/u, "up:"));
});

test("action renders dictation and held feedback without Codex health", async () => {
  const images: string[] = [];
  let fixedRegistrations = 0;
  const hold = {
    press: async () => undefined,
    release: async () => undefined,
    stop: async () => undefined
  };
  const controller = {
    registerFixedAction: () => { fixedRegistrations += 1; },
    unregisterFixedAction: () => undefined,
    setActionPreferences: () => undefined,
    prepareAction: async () => undefined
  };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = {
    id: "dictation-render",
    isKey: () => true,
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
    showAlert: async () => undefined
  };

  action.onWillAppear({ action: key, payload: { settings: { language: "ja" } } } as unknown as WillAppearEvent);
  await flush();
  assert.equal(fixedRegistrations, 0, "controller health must not own this global key image");
  assert.match(images.at(-1) ?? "", /音声入力/u);

  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  assert.match(images.at(-1) ?? "", /data-operation-phase="held"/u);
  assert.match(images.at(-1) ?? "", /押下中/u);
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
});

test("focus preparation completes before READY makes the action held, then key-up releases", async (t) => {
  const order: string[] = [];
  let ready!: () => void;
  const readyGate = new Promise<void>((resolve) => { ready = resolve; });
  const session = new Session();
  const nativeHold = new RightCommandHold(async () => {
    order.push("helper:start");
    await readyGate;
    order.push("helper:READY");
    return session;
  });
  const controller = {
    setActionPreferences: () => undefined,
    prepareAction: async () => { order.push("focus:complete"); },
  };
  const action = new GlobalDictationAction(controller as never, nativeHold);
  const images: string[] = [];
  const key = {
    id: "dictation-ready-order",
    isKey: () => true,
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
    showAlert: async () => undefined,
  };
  t.after(async () => { await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent); });
  action.onWillAppear({ action: key, payload: { settings: { focusBeforeAction: true } } } as unknown as WillAppearEvent);
  await flush();

  const down = action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["focus:complete", "helper:start"]);
  assert.doesNotMatch(images.at(-1) ?? "", /data-operation-phase="held"/u);
  ready();
  await down;
  assert.deepEqual(order, ["focus:complete", "helper:start", "helper:READY"]);
  assert.match(images.at(-1) ?? "", /data-operation-phase="held"/u);

  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  assert.equal(session.stops, 1);
});

test("CGEvent permission failure renders a stable actionable diagnostic", async () => {
  const images: string[] = [];
  let alerts = 0;
  const hold = {
    press: async () => { throw new Error("E_GLOBAL_DICTATION_PERMISSION"); },
    release: async () => undefined,
    stop: async () => undefined,
  };
  const controller = { setActionPreferences: () => undefined, prepareAction: async () => undefined };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = {
    id: "dictation-permission",
    isKey: () => true,
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
    showAlert: async () => { alerts += 1; },
  };
  action.onWillAppear({ action: key, payload: { settings: { language: "ja" } } } as unknown as WillAppearEvent);
  await flush();

  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);

  assert.equal(alerts, 1);
  assert.match(images.at(-1) ?? "", /data-operation-phase="error"/u);
  assert.match(images.at(-1) ?? "", /data-operation-detail="入力操作…"/u);
});

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fakeActionKey(id: string) {
  return {
    id,
    isKey: () => true,
    setImage: async () => undefined,
    showAlert: async () => undefined
  };
}

test("repeated down events during one physical hold cannot leave an owner after key-up", async (t) => {
  const session = new Session();
  const hold = new RightCommandHold(async () => session);
  const runtime = new GlobalDictationAction({ setActionPreferences() {}, async prepareAction() {} } as never, hold);
  const key = { id: "duplicate-down", isKey: () => true, async setImage() {}, async showAlert() {} };
  runtime.onWillAppear({ action: key, payload: { settings: { animation: false } } } as unknown as WillAppearEvent);
  t.after(async () => {
    await runtime.onWillDisappear({ action: key } as unknown as WillDisappearEvent);
    await hold.stop();
  });
  await runtime.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await runtime.onKeyDown({ action: key } as unknown as KeyDownEvent);
  await runtime.onKeyUp({ action: key } as unknown as KeyUpEvent);
  assert.equal(hold.activeOwnerCount, 0, "one key-up must release the one physical hold");
  assert.equal(session.stops, 1);
});

test("late key-up from a replaced appearance does not release the new hold", async (t) => {
  const session = new Session();
  const hold = new RightCommandHold(async () => session);
  const runtime = new GlobalDictationAction({ setActionPreferences() {}, async prepareAction() {} } as never, hold);
  const oldKey = fakeActionKey("stale-up");
  const newKey = fakeActionKey("stale-up");
  const appear = (key: typeof oldKey) => runtime.onWillAppear({ action: key, payload: { settings: { animation: false } } } as unknown as WillAppearEvent);
  appear(oldKey);
  appear(newKey);
  t.after(async () => {
    await runtime.onWillDisappear({ action: newKey } as unknown as WillDisappearEvent);
    await hold.stop();
  });
  await runtime.onKeyDown({ action: newKey } as unknown as KeyDownEvent);
  await runtime.onKeyUp({ action: oldKey } as unknown as KeyUpEvent);
  assert.equal(hold.activeOwnerCount, 1);
  assert.equal(session.stops, 0);
  await runtime.onKeyUp({ action: newKey } as unknown as KeyUpEvent);
  assert.equal(hold.activeOwnerCount, 0);
  assert.equal(session.stops, 1);
});

test("SDK fresh disappearance context releases an active native hold", async () => {
  const session = new Session();
  const hold = new RightCommandHold(async () => session);
  const runtime = new GlobalDictationAction({ setActionPreferences() {}, async prepareAction() {} } as never, hold);
  const key = fakeActionKey("sdk-disappear");
  runtime.onWillAppear({ action: key, payload: { settings: { animation: false } } } as unknown as WillAppearEvent);
  try {
    await runtime.onKeyDown({ action: key } as unknown as KeyDownEvent);
    assert.equal(hold.activeOwnerCount, 1);
    await runtime.onWillDisappear({ action: { id: key.id } } as unknown as WillDisappearEvent);
    assert.equal(hold.activeOwnerCount, 0);
    assert.equal(session.stops, 1);
  } finally { await hold.stop(); }
});

test("already terminated helpers retain their release failure", async () => {
  for (const state of [{ exitCode: 75, signalCode: null }, { exitCode: null, signalCode: "SIGKILL" }]) {
    const child = state as ChildProcessWithoutNullStreams;
    await assert.rejects(stopChild(child, false), /E_GLOBAL_DICTATION_HELPER_RELEASE/u);
    await stopChild(child, true);
  }
  await stopChild({ exitCode: 0, signalCode: null } as ChildProcessWithoutNullStreams, false);
});

test("native executable remains present through key release", async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dictation-release-path-")));
  const helper = join(directory, "helper");
  await writeFile(helper, '#!/bin/sh\nprintf "READY\\n"\ncat >/dev/null\n[ -f "$0" ] || exit 75\n', { mode: 0o700 });
  const session = await launchNativeRightCommand(helper, join(directory, "runtime"));
  t.after(async () => { await session.stop(); });
  await session.stop();
  await session.stop();
});

test("failed native spawn cleans its staged executable without an exit event", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dictation-spawn-failure-")));
  const helper = join(directory, "helper");
  const runtime = join(directory, "runtime");
  await writeFile(helper, "#!/codex-keys-nonexistent-interpreter\n", { mode: 0o700 });
  await assert.rejects(launchNativeRightCommand(helper, runtime), { code: "ENOENT" });
  assert.deepEqual(await readdir(runtime), []);
});


test("right-Option backend selects native toggle mode and stops only once", async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dictation-toggle-mode-")));
  const helper = join(directory, "helper");
  await writeFile(helper, '#!/bin/sh\n[ "$1" = "--toggle-right-option" ] || exit 76\nprintf "READY\\n"\ncat >/dev/null\n', { mode: 0o700 });
  const session = await launchNativeRightOptionToggle(helper, join(directory, "runtime"));
  t.after(async () => { await session.stop(); });
  const first = session.stop();
  assert.equal(session.stop(), first);
  await first;
});
