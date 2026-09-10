import assert from "node:assert/strict";
import test from "node:test";
import type { DialAction, DialRotateEvent, KeyAction, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { Agent1, KeycapMic, KeycapTerminal, RateLimitReset } from "../src/actions.js";
import { DeckController } from "../src/controller.js";
import { GlobalDictationAction } from "../src/global-dictation-action.js";
import { PlusModelDial } from "../src/plus-actions.js";

type ActionRef = {
  id: string;
  alerts: number;
  oks: number;
  isKey(): boolean;
  showAlert(): Promise<void>;
  showOk(): Promise<void>;
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function action(id: string): ActionRef {
  const value: ActionRef = {
    id,
    alerts: 0,
    oks: 0,
    isKey: () => true,
    showAlert: async () => { value.alerts += 1; },
    showOk: async () => { value.oks += 1; },
  };
  return value;
}

function event(value: ActionRef): WillAppearEvent {
  return { action: value, payload: { settings: {} } } as unknown as WillAppearEvent;
}

function keyAction(id: string): ActionRef & KeyAction {
  return Object.assign(action(id), {
    setImage: async () => {},
    setTitle: async () => {},
  }) as unknown as ActionRef & KeyAction;
}

function dialAction(id: string): ActionRef & DialAction {
  return Object.assign(action(id), {
    isKey: () => false,
    isDial: () => true,
    setFeedbackLayout: async () => {},
    setFeedback: async () => {},
  }) as unknown as ActionRef & DialAction;
}

test("a delayed Agent disappearance cannot unregister a same-context replacement", async () => {
  const controller = new DeckController();
  const release = deferred<void>();
  controller.releaseInput = async () => release.promise;
  const runtime = new Agent1(controller);
  const oldAction = keyAction("replacement-context");
  const newAction = keyAction("replacement-context");

  runtime.onWillAppear(event(oldAction));
  const disappearance = runtime.onWillDisappear(event(oldAction) as unknown as WillDisappearEvent);
  runtime.onWillAppear(event(newAction));
  release.resolve(undefined);
  await disappearance;

  assert.equal(controller.isCurrentAction(newAction), true);
  assert.equal(controller.isCurrentAction(oldAction), false);
});

test("a delayed Plus dial disappearance cannot unregister a same-context replacement", async () => {
  const controller = new DeckController();
  const release = deferred<void>();
  controller.plusDialUp = async () => release.promise;
  const runtime = new PlusModelDial(controller);
  const oldAction = dialAction("replacement-dial-context");
  const newAction = dialAction("replacement-dial-context");

  runtime.onWillAppear(event(oldAction));
  const disappearance = runtime.onWillDisappear(event(oldAction) as unknown as WillDisappearEvent);
  runtime.onWillAppear(event(newAction));
  release.resolve(undefined);
  await disappearance;

  assert.equal(controller.isCurrentAction(newAction), true);
  assert.equal(controller.isCurrentAction(oldAction), false);
});

test("a rejected Plus dial operation cannot alert a same-context replacement", async () => {
  const controller = new DeckController();
  const oldFailure = deferred<void>();
  controller.plusDialRotate = async () => oldFailure.promise;
  const runtime = new PlusModelDial(controller);
  const oldAction = dialAction("alert-dial-context");
  const newAction = dialAction("alert-dial-context");

  runtime.onWillAppear(event(oldAction));
  const oldRotation = runtime.onDialRotate({ action: oldAction, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  runtime.onWillAppear(event(newAction));
  oldFailure.reject(new Error("old dial operation failed late"));
  await oldRotation;
  assert.equal(oldAction.alerts, 0);
  assert.equal(newAction.alerts, 0);

  controller.plusDialRotate = async () => { throw new Error("current dial operation failed"); };
  await runtime.onDialRotate({ action: newAction, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  assert.equal(newAction.alerts, 1, "a failure from the registered dial must still alert");
});

test("a late same-action Plus rotation cannot alert after a newer success, but the latest failure does", async () => {
  const oldFailure = deferred<void>();
  const firstStarted = deferred<void>();
  let calls = 0;
  const controller = {
    setActionPreferences: () => {},
    registerPlusDial: () => {},
    unregisterPlusDial: () => {},
    isCurrentAction: () => true,
    plusDialRotate: async () => {
      calls += 1;
      if (calls === 1) {
        firstStarted.resolve(undefined);
        return oldFailure.promise;
      }
    },
  } as unknown as DeckController;
  const runtime = new PlusModelDial(controller);
  const value = dialAction("late-same-dial");
  runtime.onWillAppear(event(value));

  const oldRotation = runtime.onDialRotate({ action: value, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  await firstStarted.promise;
  await runtime.onDialRotate({ action: value, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  oldFailure.reject(new Error("late old rotation failure"));
  await oldRotation;
  assert.equal(value.alerts, 0);

  controller.plusDialRotate = async () => { throw new Error("latest rotation failure"); };
  await runtime.onDialRotate({ action: value, payload: { ticks: 1 } } as unknown as DialRotateEvent);
  assert.equal(value.alerts, 1, "the latest rotation failure must still alert");
});

test("a rejected operation from a disappeared action cannot alert its same-context replacement", async () => {
  let current: ActionRef | undefined;
  const operations: Array<Promise<never>> = [];
  const controller = {
    setActionPreferences: () => {},
    registerFixedAction: (_id: string, value: ActionRef) => { current = value; },
    unregisterFixedAction: (value: ActionRef) => { if (current === value) current = undefined; },
    isCurrentAction: (value: ActionRef) => current === value,
    runKeycap: async () => operations.shift(),
  } as unknown as DeckController;
  const runtime = new KeycapTerminal(controller);
  const oldAction = action("same-context");
  const newAction = action("same-context");
  const oldFailure = deferred<never>();
  const newFailure = deferred<never>();
  operations.push(oldFailure.promise, newFailure.promise);

  runtime.onWillAppear(event(oldAction));
  const oldPress = runtime.onKeyDown(event(oldAction) as unknown as KeyDownEvent);
  runtime.onWillDisappear(event(oldAction) as unknown as WillDisappearEvent);
  runtime.onWillAppear(event(newAction));
  oldFailure.reject(new Error("old operation failed late"));
  await oldPress;
  assert.equal(oldAction.alerts, 0);
  assert.equal(newAction.alerts, 0);

  const newPress = runtime.onKeyDown(event(newAction) as unknown as KeyDownEvent);
  newFailure.reject(new Error("current operation failed"));
  await newPress;
  assert.equal(newAction.alerts, 1, "a failure from the registered action must still alert");
});

test("a late key-down failure from the same action cannot alert after a newer success", async () => {
  const oldFailure = deferred<void>();
  const firstStarted = deferred<void>();
  let calls = 0;
  const controller = {
    setActionPreferences: () => {},
    registerFixedAction: () => {},
    unregisterFixedAction: () => {},
    isCurrentAction: () => true,
    runKeycap: async () => {
      calls += 1;
      if (calls === 1) {
        firstStarted.resolve(undefined);
        return oldFailure.promise;
      }
    },
  } as unknown as DeckController;
  const runtime = new KeycapTerminal(controller);
  const value = action("late-same-action");
  runtime.onWillAppear(event(value));

  const oldPress = runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  await firstStarted.promise;
  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  oldFailure.reject(new Error("late old failure"));
  await oldPress;

  assert.equal(value.alerts, 0);
});

test("the latest same-action key-down failure still alerts", async () => {
  let calls = 0;
  const controller = {
    setActionPreferences: () => {},
    registerFixedAction: () => {},
    unregisterFixedAction: () => {},
    isCurrentAction: () => true,
    runKeycap: async () => {
      calls += 1;
      if (calls > 1) throw new Error("latest failure");
    },
  } as unknown as DeckController;
  const runtime = new KeycapTerminal(controller);
  const value = action("latest-same-action");
  runtime.onWillAppear(event(value));

  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);

  assert.equal(value.alerts, 1);
});

test("a late key-up failure from the same action cannot alert after a newer success", async () => {
  const oldFailure = deferred<void>();
  const firstStarted = deferred<void>();
  let releases = 0;
  const controller = {
    setActionPreferences: () => {},
    registerAgent: () => {},
    unregisterAgent: () => {},
    isCurrentAction: () => true,
    pressConfiguredDisplayAction: () => undefined,
    releaseConfiguredDisplayAction: () => undefined,
    pressAgent: async () => {},
    releaseInput: async () => {
      releases += 1;
      if (releases === 1) {
        firstStarted.resolve(undefined);
        return oldFailure.promise;
      }
    },
  } as unknown as DeckController;
  const runtime = new Agent1(controller);
  const value = action("late-same-key-up");
  runtime.onWillAppear(event(value));

  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  const oldRelease = runtime.onKeyUp(event(value) as unknown as KeyUpEvent);
  await firstStarted.promise;
  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  oldFailure.reject(new Error("late old release failure"));
  await oldRelease;

  assert.equal(value.alerts, 0);
});

test("a current voice down failure remains alertable after its own key-up", async () => {
  const downFailure = deferred<void>();
  const downStarted = deferred<void>();
  let presses = 0;
  const controller = {
    setActionPreferences: () => {},
    registerFixedAction: () => {},
    unregisterFixedAction: () => {},
    isCurrentAction: () => true,
    resolveMicrophoneSlot: () => 0,
    pressMicroAction: async () => {
      presses += 1;
      if (presses === 1) {
        downStarted.resolve(undefined);
        return downFailure.promise;
      }
    },
    releaseInput: async () => {},
  } as unknown as DeckController;
  const runtime = new KeycapMic(controller);
  const value = action("same-voice-cycle");
  runtime.onWillAppear(event(value));

  const down = runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  await downStarted.promise;
  await runtime.onKeyUp(event(value) as unknown as KeyUpEvent);
  downFailure.reject(new Error("current down failure"));
  await down;

  assert.equal(value.alerts, 1, "a failed current down must remain visible after its own up");
});

test("a late global-dictation failure cannot alert after a newer success", async () => {
  const oldFailure = deferred<void>();
  const firstStarted = deferred<void>();
  let presses = 0;
  const hold = {
    press: async () => {
      presses += 1;
      if (presses === 1) {
        firstStarted.resolve(undefined);
        return oldFailure.promise;
      }
    },
    release: async () => {},
    stop: async () => {},
  };
  const controller = {
    setActionPreferences: () => {},
    prepareAction: async () => {},
  };
  const runtime = new GlobalDictationAction(controller as never, hold);
  const value = action("late-global-dictation");
  runtime.onWillAppear(event(value));

  const oldPress = runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  await firstStarted.promise;
  await runtime.onKeyUp(event(value) as unknown as KeyUpEvent);
  await runtime.onKeyDown(event(value) as unknown as KeyDownEvent);
  oldFailure.reject(new Error("late old dictation failure"));
  await oldPress;

  assert.equal(value.alerts, 0);
  await runtime.onKeyUp(event(value) as unknown as KeyUpEvent);
});

test("an error delivered before controller registration still alerts its source action", async () => {
  const controller = {
    setActionPreferences: () => {},
    runKeycap: async () => { throw new Error("input arrived before registration"); },
  } as unknown as DeckController;
  const runtime = new KeycapTerminal(controller);
  const source = action("early-context");

  await runtime.onKeyDown(event(source) as unknown as KeyDownEvent);

  assert.equal(source.alerts, 1);
});

test("a successful reset from a disappeared action cannot show OK on its same-context replacement", async () => {
  let current: ActionRef | undefined;
  const oldResult = deferred<boolean>();
  const results: Array<Promise<boolean>> = [oldResult.promise, Promise.resolve(true)];
  const controller = {
    setActionPreferences: () => {},
    registerRateLimitReset: (value: ActionRef) => { current = value; },
    unregisterRateLimitReset: (value: ActionRef) => { if (current === value) current = undefined; },
    isCurrentAction: (value: ActionRef) => current === value,
    pressConfiguredDisplayAction: () => undefined,
    releaseConfiguredDisplayAction: () => undefined,
    beginRateLimitReset: () => {},
    finishRateLimitReset: async () => results.shift(),
  } as unknown as DeckController;
  const runtime = new RateLimitReset(controller);
  const oldAction = action("same-reset-context");
  const newAction = action("same-reset-context");

  runtime.onWillAppear(event(oldAction));
  const oldUp = runtime.onKeyUp(event(oldAction) as unknown as KeyUpEvent);
  runtime.onWillDisappear(event(oldAction) as unknown as WillDisappearEvent);
  runtime.onWillAppear(event(newAction));
  oldResult.resolve(true);
  await oldUp;
  assert.equal(oldAction.oks, 0);
  assert.equal(newAction.oks, 0);

  await runtime.onKeyUp(event(newAction) as unknown as KeyUpEvent);
  assert.equal(newAction.oks, 1, "a successful reset from the registered action must still show OK");
});
