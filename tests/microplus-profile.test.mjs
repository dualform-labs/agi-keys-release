import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const script = resolve(root, "scripts/configure-microplus-profile.mjs");
const switchUuid = "com.elgato.streamdeck.keys.adaptor";
const pluginUuid = "io.local.codexdeck.microplus";

test("dry-run validates a source profile without writing a clone or backup", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "codex-microplus-dry-run-"));
  const source = await createFixture(workspace, "source.sdProfile");
  const destination = join(workspace, "clone.sdProfile");
  const backupDir = join(workspace, "backups");
  const sourceBefore = await hashTree(source);

  const result = await run(source, destination, backupDir, "--dry-run");
  const plan = JSON.parse(result.stdout);

  assert.equal(plan.dryRun, true);
  assert.equal(plan.created, false);
  assert.equal(plan.pageCount, 5);
  assert.equal(plan.pages.length, 5);
  assert.equal(plan.pages.every((page) => page.pageSwitch === switchUuid), true);
  assert.equal(await hashTree(source), sourceBefore);
  assert.equal(await exists(destination), false);
  assert.equal(await exists(backupDir), false);
});

test("build creates five MicroPlus pages, preserves the fixed page switch, and leaves source unchanged", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "codex-microplus-build-"));
  const source = await createFixture(workspace, "source.sdProfile");
  const destination = join(workspace, "clone.sdProfile");
  const backupDir = join(workspace, "backups");
  const sourceBefore = await hashTree(source);
  const expectedSwitch = await getPageSwitch(source);
  const sourceManifest = await readJson(join(source, "manifest.json"));
  const sourcePageIds = new Set([
    ...sourceManifest.Pages.Pages,
    sourceManifest.Pages.Current,
    sourceManifest.Pages.Default,
  ].map((id) => id.toLowerCase()));

  const result = await run(source, destination, backupDir);
  const output = JSON.parse(result.stdout);
  const rootManifest = await readJson(join(destination, "manifest.json"));
  const pluginManifest = await readJson(resolve(root, "packages/microplus/static/manifest.json"));
  const manifestActionUuids = new Set(pluginManifest.Actions.map((action) => action.UUID));
  assert.equal(pluginManifest.UUID, pluginUuid);
  assert.equal(Array.isArray(pluginManifest.Actions), true);
  assert.equal(manifestActionUuids.size, pluginManifest.Actions.length, "manifest contains duplicate Action UUIDs");

  assert.equal(output.created, true);
  assert.equal(rootManifest.Name, "Codex Micro Plus");
  assert.equal(rootManifest.AppIdentifier, "/Applications/ChatGPT.app");
  assert.equal(rootManifest.Pages.Pages.length, 5);
  assert.equal(new Set(rootManifest.Pages.Pages).size, 5);
  assert.equal(rootManifest.Pages.Pages.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)), true);
  assert.equal(rootManifest.Pages.Pages.every((id) => !sourcePageIds.has(id.toLowerCase())), true);
  assert.equal(rootManifest.Pages.Pages.includes(rootManifest.Pages.Current), true);
  assert.equal(rootManifest.Pages.Pages.includes(rootManifest.Pages.Default), false);
  assert.equal(rootManifest.Pages.Current, rootManifest.Pages.Pages[0]);
  assert.match(rootManifest.Pages.Default, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(sourcePageIds.has(rootManifest.Pages.Default.toLowerCase()), false);
  assert.equal(await hashTree(source), sourceBefore);
  assert.equal(await exists(output.backupPath), true);
  assert.equal(await exists(join(output.backupPath, "manifest.json")), true);

  const pageDirectoryNames = await listPageDirectoryNames(destination);
  assert.equal(pageDirectoryNames.length, 6, "destination must contain five active pages plus one host default page");
  assert.deepEqual(
    new Set(pageDirectoryNames),
    new Set([...rootManifest.Pages.Pages, rootManifest.Pages.Default].map((id) => id.toUpperCase())),
    "destination page directories must match active and host-default page IDs",
  );
  const generatedDefault = await readJson(join(destination, "Profiles", rootManifest.Pages.Default.toUpperCase(), "manifest.json"));
  assert.equal(Array.isArray(generatedDefault.Controllers), true, "host default page must retain a valid controller manifest");

  const pages = [];
  const generatedActionUuids = new Set();
  for (const pageId of rootManifest.Pages.Pages) {
    const page = await readJson(join(destination, "Profiles", pageId.toUpperCase(), "manifest.json"));
    const keypad = page.Controllers.find((controller) => controller.Type === "Keypad");
    const encoder = page.Controllers.find((controller) => controller.Type === "Encoder");
    assert.ok(keypad);
    assert.ok(encoder);
    const keyEntries = Object.entries(keypad.Actions);
    const dialEntries = Object.entries(encoder.Actions).filter(([position]) => position !== "3,0");
    assert.equal(keyEntries.length, 8, "each page must contain exactly 8 keys");
    assert.equal(dialEntries.length, 3, "each page must contain exactly 3 MicroPlus dials");
    assert.deepEqual(Object.keys(keypad.Actions).sort(), ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1", "3,0", "3,1"]);
    assert.deepEqual(Object.keys(encoder.Actions).sort(), ["0,0", "1,0", "2,0", "3,0"]);
    assert.deepEqual(encoder.Actions["3,0"], expectedSwitch);
    assert.deepEqual(
      ["0,0", "1,0", "2,0"].map((position) => encoder.Actions[position].UUID),
      ["dial-agent", "dial-reasoning", "dial-conversation"].map((id) => `${pluginUuid}.${id}`),
      "all pages must keep the same left-to-right dial muscle memory",
    );
    for (const [, action] of [...keyEntries, ...dialEntries]) {
      assert.match(action.UUID, new RegExp(`^${pluginUuid.replaceAll(".", "\\.")}\\.`));
      assert.equal(manifestActionUuids.has(action.UUID), true, `manifest missing ${action.UUID}`);
      assert.equal(action.Plugin.Version, pluginManifest.Version, `${action.UUID} plugin version must match the manifest`);
      generatedActionUuids.add(action.UUID);
    }
    pages.push({ page, keypad, encoder });
  }
  for (const uuid of generatedActionUuids) {
    assert.equal(manifestActionUuids.has(uuid), true, `generated profile action is absent from manifest: ${uuid}`);
  }

  const keyUuids = pages.flatMap(({ keypad }) => Object.values(keypad.Actions).map((action) => action.UUID));
  for (const required of [
    "agent-1",
    "agent-6",
    "fast",
    "approve",
    "decline",
    "fork",
    "dictation",
    "act11",
    "send",
    "new-task",
    "keycap-pin",
    "keycap-openai-docs",
    "plan",
    "back",
    "reasoning",
    "keycap-diff",
    "keycap-terminal",
    "keycap-pull-request",
    "keycap-mic",
    "usage-overview",
    "keycap-settings",
  ]) {
    assert.equal(keyUuids.includes(`${pluginUuid}.${required}`), true, `missing ${required}`);
  }
  const pageTwoActions = pages[1].keypad.Actions;
  for (const actionId of ["fast", "approve", "decline", "fork", "dictation", "act11", "send"]) {
    const generated = Object.values(pageTwoActions).find((action) => action.UUID === `${pluginUuid}.${actionId}`);
    const contract = pluginManifest.Actions.find((action) => action.UUID === generated?.UUID);
    assert.ok(generated, `page 2 is missing ${actionId}`);
    assert.ok(contract, `manifest is missing ${actionId}`);
    assert.equal(generated.Name, contract.Name, `${actionId} title must follow the manifest contract`);
    assert.equal(generated.Settings.physicalId, contract.Name.match(/^ACT\d+/u)?.[0], `${actionId} must retain its physical ACT position`);
  }
  assert.equal(keyUuids.some((uuid) => uuid.includes("open-manager") || uuid.includes("start-manager")), false);
});

test("rerunning over an existing clone backs it up before replacing it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "codex-microplus-rerun-"));
  const source = await createFixture(workspace, "source.sdProfile");
  const destination = join(workspace, "clone.sdProfile");
  const backupDir = join(workspace, "backups");

  await run(source, destination, backupDir);
  const previousCloneManifest = await readFile(join(destination, "manifest.json"), "utf8");
  const previousRoot = await readJson(join(destination, "manifest.json"));
  const previousPageIds = new Set(previousRoot.Pages.Pages);
  const previousDefaultId = previousRoot.Pages.Default;
  const second = JSON.parse((await run(source, destination, backupDir)).stdout);

  assert.equal(second.backupKind, "destination");
  assert.notEqual(second.backupPath, null);
  assert.equal(await readFile(join(second.backupPath, "manifest.json"), "utf8"), previousCloneManifest);
  const nextManifest = await readJson(join(destination, "manifest.json"));
  assert.equal(nextManifest.Name, "Codex Micro Plus");
  assert.equal(nextManifest.Pages.Pages.length, 5);
  assert.equal(nextManifest.Pages.Pages.every((id) => !previousPageIds.has(id)), true, "rerun must allocate fresh page IDs");
  assert.equal(nextManifest.Pages.Pages.includes(nextManifest.Pages.Default), false);
  assert.notEqual(nextManifest.Pages.Default, previousDefaultId, "rerun must allocate a fresh host default page");
  assert.equal(await exists(join(destination, "Profiles", previousDefaultId.toUpperCase())), false, "rerun must not retain the previous host default directory");
  assert.equal((await listPageDirectoryNames(destination)).length, 6, "rerun must keep only five active pages and one host default page");
});

test("invalid source or destination paths fail closed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "codex-microplus-invalid-"));
  const source = await createFixture(workspace, "source.sdProfile");
  const destination = join(workspace, "clone.sdProfile");

  await assert.rejects(() => run(source, source, join(workspace, "backups")), /different paths/u);
  await assert.rejects(() => run("relative-profile", destination, join(workspace, "backups")), /must be absolute/u);

  const broken = await createFixture(workspace, "broken.sdProfile");
  const brokenDefault = await readJson(join(broken, "Profiles", "DEFAULT-TEMPLATE", "manifest.json"));
  delete brokenDefault.Controllers[1].Actions;
  await writeFile(join(broken, "Profiles", "DEFAULT-TEMPLATE", "manifest.json"), `${JSON.stringify(brokenDefault)}\n`);
  await assert.rejects(() => run(broken, join(workspace, "broken-clone.sdProfile"), join(workspace, "backups-2")), /does not contain .*keys\.adaptor/u);
});

async function run(source, destination, backupDir, ...extra) {
  return execFile(process.execPath, [script, "--source", source, "--destination", destination, "--backup-dir", backupDir, ...extra], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
}

async function createFixture(workspace, name) {
  const profile = join(workspace, name);
  const pageIds = ["PAGE-ONE", "PAGE-TWO", "PAGE-THREE", "PAGE-FOUR", "PAGE-FIVE"];
  const defaultId = "DEFAULT-TEMPLATE";
  await mkdir(join(profile, "Profiles"), { recursive: true });
  await writeJson(join(profile, "manifest.json"), {
    Name: "Fixture Profile",
    Device: "com.elgato.StreamDeckPlus",
    Version: 1,
    Pages: { Current: pageIds[0], Default: defaultId, Pages: pageIds },
  });
  for (const pageId of pageIds) {
    await writeJson(join(profile, "Profiles", pageId, "manifest.json"), {
      Controllers: [
        { Type: "Keypad", Actions: {} },
        { Type: "Encoder", Actions: {} },
      ],
      Icon: "",
      Name: `Fixture ${pageId}`,
    });
  }
  await writeJson(join(profile, "Profiles", defaultId, "manifest.json"), {
    Controllers: [
      { Type: "Keypad", Actions: null },
      {
        Type: "Encoder",
        Actions: {
          "3,0": {
            ActionID: "switch-action-id",
            Actions: [
              { ActionID: "goto", UUID: "com.elgato.streamdeck.page.goto", Settings: { PageIndex: 1 } },
              { ActionID: "previous", UUID: "com.elgato.streamdeck.page.previous", Settings: {} },
              { ActionID: "next", UUID: "com.elgato.streamdeck.page.next", Settings: {} },
            ],
            LinkedTitle: true,
            Name: "Action Trigger",
            Plugin: { Name: "Keys", UUID: "com.elgato.streamdeck.keys", Version: "1.0" },
            Resources: null,
            Settings: {},
            State: 0,
            States: [{}],
            UUID: "com.elgato.streamdeck.keys.adaptor",
          },
        },
      },
    ],
    Icon: "",
    Name: "Default",
  });
  return profile;
}

async function getPageSwitch(profile) {
  const manifest = await readJson(join(profile, "Profiles", "DEFAULT-TEMPLATE", "manifest.json"));
  return manifest.Controllers.find((controller) => controller.Type === "Encoder").Actions["3,0"];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function exists(path) {
  return stat(path).then(() => true).catch(() => false);
}

async function listPageDirectoryNames(profile) {
  return (await readdir(join(profile, "Profiles"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function hashTree(path) {
  const hash = createHash("sha256");
  async function visit(current, relative = "") {
    const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = join(current, entry.name);
      const childRelative = join(relative, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${childRelative}\n`);
        await visit(child, childRelative);
      } else {
        hash.update(`file:${childRelative}\n`);
        hash.update(await readFile(child));
      }
    }
  }
  await visit(path);
  return hash.digest("hex");
}
