import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { validateMicroplusProfile } from "../scripts/validate-microplus-profile.mjs";

const root = process.cwd();
const pluginUuid = "com.dualform.agikeys";

test("profile validator accepts the complete generated/live contract", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "microplus-profile-valid-"));
  const profile = await createProfileFixture(workspace);
  const result = await validateMicroplusProfile(profile, { repositoryRoot: root });

  assert.equal(result.status, "pass");
  assert.equal(result.activePages.length, 5);
  assert.equal(result.pageDirectoryCount, 6);
  assert.equal(result.activePages.every((page) => page.keys === 8 && page.pluginDials === 3), true);
});

test("profile validator accepts action instances created by an older installed plugin", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "microplus-profile-upgraded-"));
  const profile = await createProfileFixture(workspace);
  const rootManifest = await readJson(join(profile, "manifest.json"));
  for (const pageId of rootManifest.Pages.Pages) {
    const pagePath = join(profile, "Profiles", pageId.toUpperCase(), "manifest.json");
    const page = await readJson(pagePath);
    for (const controller of page.Controllers) {
      for (const action of Object.values(controller.Actions ?? {})) {
        if (action.Plugin?.UUID === pluginUuid) action.Plugin.Version = "0.1.0.6";
      }
    }
    await writeJson(pagePath, page);
  }

  const result = await validateMicroplusProfile(profile, { repositoryRoot: root });
  assert.equal(result.status, "pass");
});

test("profile validator fails a malformed fixture", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "microplus-profile-invalid-"));
  const profile = await createProfileFixture(workspace);
  const rootManifest = await readJson(join(profile, "manifest.json"));
  const pagePath = join(profile, "Profiles", rootManifest.Pages.Pages[0].toUpperCase(), "manifest.json");
  const page = await readJson(pagePath);
  delete page.Controllers.find((controller) => controller.Type === "Encoder").Actions["3,0"];
  await writeFile(pagePath, `${JSON.stringify(page)}\n`);

  await assert.rejects(
    validateMicroplusProfile(profile, { repositoryRoot: root }),
    /encoder positions must be exactly|rightmost dial must be/u,
  );
});

async function createProfileFixture(workspace) {
  const profile = join(workspace, "Codex-Micro-Plus.sdProfile");
  const pluginManifest = await readJson(resolve(root, "packages/microplus/static/manifest.json"));
  const keypadUuids = pluginManifest.Actions
    .filter((action) => action.Controllers?.includes("Keypad"))
    .map((action) => action.UUID);
  const dialUuids = ["dial-agent", "dial-reasoning", "dial-conversation"].map((id) => `${pluginUuid}.${id}`);
  const pageIds = Array.from({ length: 5 }, () => randomUUID());
  const defaultPageId = randomUUID();
  await mkdir(join(profile, "Profiles"), { recursive: true });
  await writeJson(join(profile, "manifest.json"), {
    Name: "AGI Keys",
    AppIdentifier: "/Applications/ChatGPT.app",
    Pages: { Current: pageIds[0], Default: defaultPageId, Pages: pageIds },
  });
  let keyCursor = 0;
  for (const pageId of pageIds) {
    const keys = {};
    for (const position of ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1", "3,0", "3,1"]) {
      const uuid = keypadUuids[keyCursor++ % keypadUuids.length];
      keys[position] = pluginAction(uuid, pluginManifest.Version, settingsFor(uuid));
    }
    const dials = Object.fromEntries(dialUuids.map((uuid, index) => [
      `${index},0`,
      pluginAction(uuid, pluginManifest.Version, { mode: ["agent-slots", "reasoning", "native-navigation"][index] }),
    ]));
    dials["3,0"] = { ActionID: randomUUID(), UUID: "com.elgato.streamdeck.keys.adaptor" };
    await writeJson(join(profile, "Profiles", pageId.toUpperCase(), "manifest.json"), {
      Controllers: [{ Type: "Keypad", Actions: keys }, { Type: "Encoder", Actions: dials }],
    });
  }
  await writeJson(join(profile, "Profiles", defaultPageId.toUpperCase(), "manifest.json"), { Controllers: [] });
  return profile;
}

function pluginAction(uuid, version, settings) {
  return { ActionID: randomUUID(), UUID: uuid, Plugin: { UUID: pluginUuid, Version: version }, Settings: settings };
}

function settingsFor(uuid) {
  const actionId = uuid.slice(`${pluginUuid}.`.length);
  const physicalIds = { fast: "ACT06", approve: "ACT07", decline: "ACT08", fork: "ACT09", dictation: "ACT10", act11: "ACT11", send: "ACT12" };
  const directions = { plan: "up", forward: "right", sidebar: "down", back: "left" };
  if (actionId in physicalIds) return { physicalId: physicalIds[actionId] };
  if (actionId in directions) return { direction: directions[actionId] };
  return {};
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
}
