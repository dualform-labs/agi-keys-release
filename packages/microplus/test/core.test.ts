import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCodexLaunchSpec, chooseLoopbackPort, parseDebugPort } from "../launcher/macos.js";
import { ADDITIONAL_KEYCAPS, EXCLUDED_KEYCAP_IDS, OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";
import { visualStatusFromMicro } from "../src/status.js";

type Manifest = {
  UUID: string;
  Name: string;
  OS: Array<{ Platform: string }>;
  Actions: Array<{
    UUID: string;
    Name: string;
    Tooltip?: string;
    Icon?: string;
    Controllers?: string[];
    Encoder?: { TriggerDescription?: Record<string, string> };
  }>;
};

test("manifest is an independent Mac-only plugin with no remote-host action", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  assert.equal(manifest.UUID, "io.local.codexdeck.microplus");
  assert.equal(manifest.Name, "Codex Keys");
  assert.deepEqual(manifest.OS, [{ Platform: "mac", MinimumVersion: "13" }]);
  assert.equal(manifest.Actions.some(({ UUID }) => UUID.endsWith(".host-toggle")), false);
  assert.equal(new Set(manifest.Actions.map(({ UUID }) => UUID)).size, manifest.Actions.length);
});

test("ACT11 manifest entry is backed by a registered runtime action", async () => {
  const plugin = await readFile(new URL("../src/plugin.ts", import.meta.url), "utf8");
  const actions = await readFile(new URL("../src/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /UUID: "io\.local\.codexdeck\.microplus\.act11"/);
  assert.match(plugin, /new Act11\(controller\)/);
});

test("raw Micro actions advertise physical IDs and defer meaning to Codex settings", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  const expected = {
    fast: "ACT06",
    approve: "ACT07",
    decline: "ACT08",
    fork: "ACT09",
    dictation: "ACT10",
    act11: "ACT11",
    send: "ACT12",
    plan: "JOY_UP",
    back: "JOY_LEFT",
    forward: "JOY_RIGHT",
    sidebar: "JOY_DOWN",
    reasoning: "ENC_CLK",
  } as const;
  for (const [suffix, physicalId] of Object.entries(expected)) {
    const action = manifest.Actions.find(({ UUID }) => UUID === `io.local.codexdeck.microplus.${suffix}`);
    assert.ok(action, `${suffix} is missing from the manifest`);
    assert.match(action.Name, new RegExp(`^${physicalId} · `));
    assert.match(action.Tooltip ?? "", new RegExp(`${physicalId}`));
    assert.match(action.Tooltip ?? "", /現在の割当|エンコーダー割当/u);
    assert.doesNotMatch(action.Name, /既定:|承認|拒否|分岐|送信|Plan|戻る|進む|サイドバー|思考レベル/u);
  }
});

test("raw Micro action icons identify physical positions without fixed semantics", async () => {
  const expected = {
    fast: ["action-fast", "ACT06"],
    approve: ["action-approve", "ACT07"],
    decline: ["action-decline", "ACT08"],
    fork: ["action-fork", "ACT09"],
    dictation: ["action-dictation", "ACT10"],
    act11: ["action-act11", "ACT11"],
    send: ["action-send", "ACT12"],
    plan: ["action-plan", "JOY_UP"],
    back: ["action-back", "JOY_LEFT"],
    forward: ["action-forward", "JOY_RIGHT"],
    sidebar: ["action-sidebar", "JOY_DOWN"],
    reasoning: ["action-reasoning", "ENC_CLK"],
  } as const;
  for (const [suffix, [iconName, physicalId]] of Object.entries(expected)) {
    const action = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
    const manifestAction = action.Actions.find(({ UUID }) => UUID === `io.local.codexdeck.microplus.${suffix}`);
    assert.equal(manifestAction?.Icon, `static/imgs/${iconName}`, suffix);
    const svg = await readFile(new URL(`../static/imgs/${iconName}.svg`, import.meta.url), "utf8");
    const svg2x = await readFile(new URL(`../static/imgs/${iconName}@2x.svg`, import.meta.url), "utf8");
    assert.match(svg, new RegExp(`aria-label="Codex Micro (?:physical action|physical direction|physical encoder click) ${physicalId}"`));
    assert.match(svg2x, new RegExp(`aria-label="Codex Micro (?:physical action|physical direction|physical encoder click) ${physicalId}"`));
    assert.doesNotMatch(svg, /承認|拒否|分岐|送信|Plan|戻る|進む|サイドバー|思考レベル/u);
    assert.doesNotMatch(svg2x, /承認|拒否|分岐|送信|Plan|戻る|進む|サイドバー|思考レベル/u);
  }
});

test("six agents, Micro controls, and 34 executable keycaps are exposed from the 39-entry catalog", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  const ids = new Set(manifest.Actions.map(({ UUID }) => UUID));
  for (let slot = 1; slot <= 6; slot += 1) assert.ok(ids.has(`io.local.codexdeck.microplus.agent-${slot}`));
  for (const id of ["fast", "approve", "decline", "fork", "dictation", "act11", "send", "plan", "back", "forward", "sidebar"]) {
    assert.ok(ids.has(`io.local.codexdeck.microplus.${id}`), id);
  }
  const act11 = manifest.Actions.find(({ UUID }) => UUID === "io.local.codexdeck.microplus.act11");
  assert.deepEqual(
    { name: act11?.Name, icon: act11?.Icon },
    { name: "ACT11 · 物理キー", icon: "static/imgs/action-act11" }
  );
  const act11Icon = await readFile(new URL("../static/imgs/action-act11.svg", import.meta.url), "utf8");
  const act11Icon2x = await readFile(new URL("../static/imgs/action-act11@2x.svg", import.meta.url), "utf8");
  assert.match(act11Icon, />11<\/text>/);
  assert.match(act11Icon2x, />11<\/text>/);
  const excluded = new Set(EXCLUDED_KEYCAP_IDS);
  for (const keycap of ADDITIONAL_KEYCAPS) {
    const actionId = `io.local.codexdeck.microplus.keycap-${keycap.slug}`;
    if (excluded.has(keycap.id as (typeof EXCLUDED_KEYCAP_IDS)[number])) assert.equal(ids.has(actionId), false, keycap.id);
    else assert.ok(ids.has(actionId), keycap.id);
  }
  assert.equal(6 + 4 + ADDITIONAL_KEYCAPS.length - EXCLUDED_KEYCAP_IDS.length, 44);
  assert.equal(OFFICIAL_KEYCAP_IDS.length, 39);
  assert.equal(ADDITIONAL_KEYCAPS.length - EXCLUDED_KEYCAP_IDS.length, 34);
  assert.equal(EXCLUDED_KEYCAP_IDS.length, 5);
  assert.equal(new Set(OFFICIAL_KEYCAP_IDS).size, OFFICIAL_KEYCAP_IDS.length);
  assert.equal(new Set(ADDITIONAL_KEYCAPS.map(({ id }) => id)).size, ADDITIONAL_KEYCAPS.length);
  const executableActions = manifest.Actions.filter(({ UUID }) => UUID.includes(".keycap-"));
  assert.equal(executableActions.length, 34);
  for (const action of executableActions) {
    if (action.UUID.endsWith(".keycap-codex")) assert.equal(action.Name, "Codexに送信");
    else assert.match(action.Name, /^キーキャップ · /);
  }
  for (const id of ["MIC", "MIC1", "BRANCH", "EMPT1", "EMPT2", "EMPT3", "EMPT4", "YOLO", "YEET", "EMPT5"]) {
    assert.ok(OFFICIAL_KEYCAP_IDS.includes(id as (typeof OFFICIAL_KEYCAP_IDS)[number]), id);
  }
});

test("all six encoder actions advertise touch and long-touch semantics", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as Manifest;
  const encoderIds = [
    "dial-agent",
    "dial-reasoning",
    "dial-conversation",
    "dial-commands",
    "dial-usage",
    "dial-model",
  ];
  for (const id of encoderIds) {
    const action = manifest.Actions.find(({ UUID }) => UUID === `io.local.codexdeck.microplus.${id}`);
    assert.ok(action, `${id} is missing from the manifest`);
    assert.ok(action.Controllers?.includes("Encoder"), `${id} is not registered as an Encoder action`);
    assert.equal(typeof action.Encoder?.TriggerDescription?.Touch, "string", `${id} lacks Touch description`);
    assert.equal(typeof action.Encoder?.TriggerDescription?.LongTouch, "string", `${id} lacks LongTouch description`);
  }
});

test("native Micro state palette preserves official semantics", () => {
  assert.equal(visualStatusFromMicro("off"), "empty");
  assert.equal(visualStatusFromMicro("working"), "thinking");
  assert.equal(visualStatusFromMicro("unread"), "complete");
  assert.equal(visualStatusFromMicro("awaiting-approval"), "input");
  assert.equal(visualStatusFromMicro("error"), "error");
});

test("Mac launcher uses a random loopback-only CDP port", async () => {
  const port = await chooseLoopbackPort();
  const spec = buildCodexLaunchSpec({ appPath: "/Applications/ChatGPT.app" }, port);
  assert.equal(spec.command, "/usr/bin/open");
  assert.equal(parseDebugPort(spec.args.join(" ")), port);
  assert.match(spec.args.join(" "), /--remote-debugging-address=127\.0\.0\.1/);
  assert.doesNotMatch(spec.args.join(" "), /0\.0\.0\.0/);
});

test("active source tree has no relay, mobile, manager, or server imports", async () => {
  const files = ["plugin.ts", "controller.ts", "actions.ts"];
  const sources = await Promise.all(files.map((file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8")));
  const active = sources.join("\n");
  assert.doesNotMatch(active, /CodexRelay|relay-client|relay-server|mobile-local|manager|server/);
});
