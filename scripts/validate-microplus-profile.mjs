#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CODEX_APP_IDENTIFIER,
  ENCODER_POSITIONS,
  EXPECTED_ACTIVE_PAGE_COUNT,
  EXPECTED_DIAL_MODES,
  EXPECTED_KEYPAD_COUNT,
  EXPECTED_PLUGIN_DIAL_COUNT,
  HOST_ADAPTOR_POSITION,
  HOST_ADAPTOR_UUID,
  KEYPAD_POSITIONS,
  PLUGIN_DIAL_UUIDS,
  PLUGIN_UUID,
  PROFILE_NAME,
  isObject,
  listPageDirectories,
  normalizeProfileId,
  readJson,
} from "./microplus-profile-contract.mjs";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPECTED_KEY_SETTINGS = new Map([
  ["fast", ["physicalId", "ACT06"]],
  ["approve", ["physicalId", "ACT07"]],
  ["decline", ["physicalId", "ACT08"]],
  ["fork", ["physicalId", "ACT09"]],
  ["dictation", ["physicalId", "ACT10"]],
  ["act11", ["physicalId", "ACT11"]],
  ["send", ["physicalId", "ACT12"]],
  ["plan", ["direction", "up"]],
  ["forward", ["direction", "right"]],
  ["sidebar", ["direction", "down"]],
  ["back", ["direction", "left"]],
]);
export async function validateMicroplusProfile(profilePath, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? fileURLToPath(new URL("..", import.meta.url)));
  const pluginManifestPath = resolve(options.pluginManifestPath ?? join(repositoryRoot, "packages/microplus/static/manifest.json"));
  const rootPackagePath = join(repositoryRoot, "package.json");
  const microplusPackagePath = join(repositoryRoot, "packages/microplus/package.json");
  const resolvedProfile = resolve(profilePath);

  const [root, pluginManifest, rootPackage, microplusPackage] = await Promise.all([
    readJson(join(resolvedProfile, "manifest.json"), "profile root manifest"),
    readJson(pluginManifestPath, "MicroPlus plugin manifest"),
    readJson(rootPackagePath, "root package manifest"),
    readJson(microplusPackagePath, "MicroPlus package manifest"),
  ]);

  const failures = [];
  check(root.Name === PROFILE_NAME, `profile Name must be ${PROFILE_NAME}`, failures);
  check(root.AppIdentifier === CODEX_APP_IDENTIFIER, `profile AppIdentifier must target ${CODEX_APP_IDENTIFIER}`, failures);
  check(pluginManifest.UUID === PLUGIN_UUID, `plugin manifest UUID must be ${PLUGIN_UUID}`, failures);
  check(typeof pluginManifest.Version === "string" && pluginManifest.Version.length > 0, "plugin manifest Version must be present", failures);
  check(pluginManifest.Version === rootPackage.version, "root package version must match plugin manifest Version", failures);
  check(pluginManifest.Version === microplusPackage.version, "MicroPlus package version must match plugin manifest Version", failures);

  const manifestActions = Array.isArray(pluginManifest.Actions) ? pluginManifest.Actions : [];
  const manifestActionUuids = new Set(manifestActions.map((action) => action?.UUID).filter((uuid) => typeof uuid === "string"));
  check(manifestActions.length >= 60, "plugin manifest must expose at least 60 actions", failures);
  check(manifestActionUuids.size === manifestActions.length, "plugin manifest action UUIDs must be unique", failures);

  const activePageIds = root?.Pages?.Pages;
  const defaultPageId = root?.Pages?.Default;
  check(Array.isArray(activePageIds), "profile Pages.Pages must be an array", failures);
  check(Array.isArray(activePageIds) && activePageIds.length === EXPECTED_ACTIVE_PAGE_COUNT, `profile must contain exactly ${EXPECTED_ACTIVE_PAGE_COUNT} active pages`, failures);
  check(typeof defaultPageId === "string" && defaultPageId.length > 0, "profile must contain a separate default page ID", failures);
  if (!Array.isArray(activePageIds)) throwValidation(resolvedProfile, failures);

  const normalizedActive = activePageIds.map(normalizeProfileId);
  check(normalizedActive.every(Boolean), "every active page ID must be a non-empty string", failures);
  check(new Set(normalizedActive).size === activePageIds.length, "active page IDs must be unique", failures);
  check(!normalizedActive.includes(normalizeProfileId(defaultPageId)), "default page must not be one of the 5 active pages", failures);
  check(normalizedActive.includes(normalizeProfileId(root?.Pages?.Current)), "current page must be one of the active pages", failures);

  const profileDirectories = await listPageDirectories(resolvedProfile);
  const expectedPageIds = new Set([...normalizedActive, normalizeProfileId(defaultPageId)].filter(Boolean));
  check(profileDirectories.size === EXPECTED_ACTIVE_PAGE_COUNT + 1, `profile must contain exactly ${EXPECTED_ACTIVE_PAGE_COUNT} active page directories plus 1 default page directory`, failures);
  check([...expectedPageIds].every((id) => profileDirectories.has(id)), "page directories must match active and default page IDs", failures);
  check([...profileDirectories.keys()].every((id) => expectedPageIds.has(id)), "profile contains an unreferenced page directory", failures);

  const actionIds = new Set();
  const pageSummaries = [];
  for (const pageId of activePageIds) {
    const directory = profileDirectories.get(normalizeProfileId(pageId));
    if (!directory) continue;
    const page = await readJson(join(directory, "manifest.json"), `active page ${pageId}`);
    const controllers = Array.isArray(page.Controllers) ? page.Controllers : [];
    const keypads = controllers.filter((controller) => controller?.Type === "Keypad");
    const encoders = controllers.filter((controller) => controller?.Type === "Encoder");
    const keypadActions = keypads[0]?.Actions;
    const encoderActions = encoders[0]?.Actions;
    check(keypads.length === 1, `${pageId}: exactly one Keypad controller is required`, failures);
    check(encoders.length === 1, `${pageId}: exactly one Encoder controller is required`, failures);
    checkPositions(keypadActions, KEYPAD_POSITIONS, `${pageId}: keypad`, failures);
    checkPositions(encoderActions, ENCODER_POSITIONS, `${pageId}: encoder`, failures);
    if (!isObject(keypadActions) || !isObject(encoderActions)) continue;

    for (const position of KEYPAD_POSITIONS) {
      const action = keypadActions[position];
      validatePluginAction(action, `${pageId}: key ${position}`, pluginManifest.Version, manifestActionUuids, actionIds, failures);
      const actionId = typeof action?.UUID === "string" ? action.UUID.slice(`${PLUGIN_UUID}.`.length) : "";
      const expectedSetting = EXPECTED_KEY_SETTINGS.get(actionId);
      if (expectedSetting) {
        const [key, value] = expectedSetting;
        check(action.Settings?.[key] === value, `${pageId}: ${actionId} must map ${key}=${value}`, failures);
      }
    }
    for (let index = 0; index < EXPECTED_PLUGIN_DIAL_COUNT; index += 1) {
      const position = `${index},0`;
      const action = encoderActions[position];
      validatePluginAction(action, `${pageId}: dial ${position}`, pluginManifest.Version, manifestActionUuids, actionIds, failures);
      check(action?.UUID === PLUGIN_DIAL_UUIDS[index], `${pageId}: dial ${position} must be ${PLUGIN_DIAL_UUIDS[index]}`, failures);
      check(action?.Settings?.mode === EXPECTED_DIAL_MODES[index], `${pageId}: dial ${position} must map mode=${EXPECTED_DIAL_MODES[index]}`, failures);
    }
    const hostAdaptor = encoderActions[HOST_ADAPTOR_POSITION];
    check(hostAdaptor?.UUID === HOST_ADAPTOR_UUID, `${pageId}: rightmost dial must be ${HOST_ADAPTOR_UUID}`, failures);
    check(typeof hostAdaptor?.ActionID === "string" && UUID_V4.test(hostAdaptor.ActionID), `${pageId}: host adaptor ActionID must be a UUID v4`, failures);
    if (typeof hostAdaptor?.ActionID === "string") {
      check(!actionIds.has(hostAdaptor.ActionID.toLowerCase()), `${pageId}: host adaptor ActionID must be unique`, failures);
      actionIds.add(hostAdaptor.ActionID.toLowerCase());
    }
    pageSummaries.push({ pageId, keys: EXPECTED_KEYPAD_COUNT, pluginDials: EXPECTED_PLUGIN_DIAL_COUNT, hostAdaptor: hostAdaptor?.UUID ?? null });
  }

  const defaultDirectory = profileDirectories.get(normalizeProfileId(defaultPageId));
  if (defaultDirectory) {
    const defaultManifest = await readJson(join(defaultDirectory, "manifest.json"), "default page manifest");
    check(Array.isArray(defaultManifest.Controllers), "default page must retain a Controllers array", failures);
  }

  throwValidation(resolvedProfile, failures);
  return {
    profile: resolvedProfile,
    plugin: { uuid: PLUGIN_UUID, version: pluginManifest.Version, manifestActions: manifestActions.length },
    activePages: pageSummaries,
    defaultPageId,
    pageDirectoryCount: profileDirectories.size,
    profileActionInstances: actionIds.size,
    status: "pass",
  };
}

export async function discoverMicroplusProfile() {
  const roots = [
    join(homedir(), "Library/Application Support/com.elgato.StreamDeck/ProfilesV3"),
    join(homedir(), "Library/Application Support/com.elgato.StreamDeck/ProfilesV2"),
  ];
  const matches = [];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name);
      const manifest = await readJson(join(candidate, "manifest.json"), "candidate profile").catch(() => undefined);
      if (manifest?.Name !== PROFILE_NAME) continue;
      const info = await stat(join(candidate, "manifest.json"));
      matches.push({ candidate, modifiedAt: info.mtimeMs });
    }
  }
  matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (matches.length === 0) throw new Error(`No installed ${PROFILE_NAME} profile was found in ProfilesV3 or ProfilesV2.`);
  if (matches.length > 1 && matches[0].modifiedAt === matches[1].modifiedAt) {
    throw new Error(`Multiple installed ${PROFILE_NAME} profiles have the same modification time; pass an explicit profile path.`);
  }
  return matches[0].candidate;
}

function validatePluginAction(action, label, version, manifestActionUuids, actionIds, failures) {
  check(isObject(action), `${label} must contain an action`, failures);
  if (!isObject(action)) return;
  check(typeof action.UUID === "string" && action.UUID.startsWith(`${PLUGIN_UUID}.`), `${label} must use the MicroPlus plugin UUID`, failures);
  check(manifestActionUuids.has(action.UUID), `${label} action UUID is absent from the plugin manifest: ${String(action.UUID)}`, failures);
  check(action.Plugin?.UUID === PLUGIN_UUID, `${label} Plugin.UUID must match the plugin manifest`, failures);
  check(
    isCompatibleStoredPluginVersion(action.Plugin?.Version, version),
    `${label} Plugin.Version must be a valid installed version no newer than ${version}`,
    failures,
  );
  check(typeof action.ActionID === "string" && UUID_V4.test(action.ActionID), `${label} ActionID must be a UUID v4`, failures);
  if (typeof action.ActionID === "string") {
    const id = action.ActionID.toLowerCase();
    check(!actionIds.has(id), `${label} ActionID must be unique`, failures);
    actionIds.add(id);
  }
}

function isCompatibleStoredPluginVersion(stored, installed) {
  const parse = (value) => typeof value === "string" && /^\d+(?:\.\d+){2,3}$/u.test(value)
    ? value.split(".").map(Number)
    : null;
  const left = parse(stored);
  const right = parse(installed);
  if (!left || !right) return false;
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return true;
}

function checkPositions(actions, expected, label, failures) {
  check(isObject(actions), `${label} Actions must be an object`, failures);
  if (!isObject(actions)) return;
  const actual = Object.keys(actions).sort();
  check(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label} positions must be exactly ${expected.join(" ")}`, failures);
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

function throwValidation(profilePath, failures) {
  if (failures.length > 0) throw new Error(`MicroPlus profile validation failed for ${profilePath}:\n- ${failures.join("\n- ")}`);
}

async function main(argv) {
  const explicit = argv[0];
  if (argv.length > 1 || explicit?.startsWith("--")) throw new Error("Usage: validate-microplus-profile.mjs [/absolute/profile.sdProfile]");
  const profile = explicit ? resolve(explicit) : await discoverMicroplusProfile();
  process.stdout.write(`${JSON.stringify(await validateMicroplusProfile(profile), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
