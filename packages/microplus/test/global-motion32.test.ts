import assert from "node:assert/strict";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { GlobalDictationAction } from "../src/global-dictation-action.js";

const controller = {
  setActionPreferences: () => undefined,
  prepareAction: async () => undefined
};

test("global dictation animates press and release contact by elapsed time, then stops", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000 });
  const images: string[] = [];
  const hold = {
    press: async () => undefined,
    release: async () => undefined,
    stop: async () => undefined
  };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = fakeKey("global-motion", images);

  action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent);
  await flush();
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  assert.deepEqual(contact(images.at(-1)), { phase: "press", age: 0 });

  t.mock.timers.tick(66);
  await flush();
  const heldContact = contact(images.at(-1));
  assert.equal(heldContact?.phase, "press");
  assert.ok((heldContact?.age ?? 0) >= 33, "held ticks must retain and advance press contact");

  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  assert.deepEqual(contact(images.at(-1)), { phase: "release", age: 0 });
  t.mock.timers.tick(66);
  await flush();
  const releasedContact = contact(images.at(-1));
  assert.equal(releasedContact?.phase, "release");
  assert.ok((releasedContact?.age ?? 0) >= 33, "release ticks must advance after the hold ends");

  t.mock.timers.tick(254);
  await flush();
  assert.equal(contact(images.at(-1)), undefined, "contact must be removed at the 320ms boundary");
  const settledCount = images.length;
  t.mock.timers.tick(330);
  await flush();
  assert.equal(images.length, settledCount, "the release animation interval must stop after expiry");

  await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent);
});

test("global dictation animation off never paints a contact overlay", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 2_000 });
  const images: string[] = [];
  const hold = {
    press: async () => undefined,
    release: async () => undefined,
    stop: async () => undefined
  };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = fakeKey("global-motion-off", images);

  action.onWillAppear({ action: key, payload: { settings: { animation: false } } } as unknown as WillAppearEvent);
  await flush();
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  t.mock.timers.tick(99);
  await flush();
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
  t.mock.timers.tick(400);
  await flush();

  assert.ok(images.length >= 3);
  assert.equal(images.some((image) => contact(image) !== undefined), false);
  await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent);
});

test("global dictation stops animation after a render error", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 3_000 });
  let renders = 0;
  const hold = {
    press: async () => undefined,
    release: async () => undefined,
    stop: async () => undefined
  };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = {
    id: "global-motion-error",
    isKey: () => true,
    setImage: async () => {
      renders += 1;
      if (renders === 3) throw new Error("display failed");
    },
    showAlert: async () => undefined
  };

  action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent);
  await flush();
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  t.mock.timers.tick(33);
  await flush();
  assert.equal(renders, 3);

  t.mock.timers.tick(330);
  await flush();
  assert.equal(renders, 3, "a failed frame must stop further animation renders");
  await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent);
});

function fakeKey(id: string, images: string[]) {
  return {
    id,
    isKey: () => true,
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
    showAlert: async () => undefined
  };
}

function contact(image: string | undefined): { phase: string; age: number } | undefined {
  if (!image) return undefined;
  const match = /data-key-contact="(press|release)" data-contact-age="([0-9.]+)"/u.exec(image);
  return match ? { phase: match[1] ?? "", age: Number(match[2]) } : undefined;
}

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
