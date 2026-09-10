#!/usr/bin/env node

/**
 * Build a Codex Micro-style Stream Deck+ profile from an existing profile.
 *
 * The source profile is never modified. A pre-change backup is always made:
 * - an existing destination is moved into the backup directory; or
 * - the source is copied into the backup directory when creating a new clone.
 *
 * Usage:
 *   node scripts/configure-microplus-profile.mjs \
 *     --source /absolute/path/source.sdProfile \
 *     --destination /absolute/path/Codex-Micro-Plus.sdProfile
 *
 * Add --dry-run to validate the source and print the plan without writing.
 */

import {
  cp,
  mkdir,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CODEX_APP_IDENTIFIER,
  HOST_ADAPTOR_POSITION,
  HOST_ADAPTOR_UUID,
  PAGE_DEFINITIONS,
  PLUGIN_MANIFEST_URL,
  PLUGIN_UUID,
  PROFILE_NAME,
  listPageDirectories,
  readJson,
} from "./microplus-profile-contract.mjs";

const BACKUP_DIR_NAME = ".codexdeck-microplus-backups";

const args = parseArgs(process.argv.slice(2));
const plan = await inspectPlan(args);

if (args.dryRun) {
  printPlan({ ...plan, dryRun: true, created: false });
} else {
  const result = await buildProfile(plan);
  printPlan({ ...plan, ...result, dryRun: false, created: true });
}

function parseArgs(argv) {
  const parsed = { source: undefined, destination: undefined, backupDir: undefined, dryRun: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (value === "--source" || value === "--destination" || value === "--backup-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a path`);
      parsed[{ "--source": "source", "--destination": "destination", "--backup-dir": "backupDir" }[value]] = next;
      index += 1;
      continue;
    }
    if (value.startsWith("--source=") || value.startsWith("--destination=") || value.startsWith("--backup-dir=")) {
      const [flag, ...rest] = value.split("=");
      const target = { "--source": "source", "--destination": "destination", "--backup-dir": "backupDir" }[flag];
      const pathValue = rest.join("=");
      if (!pathValue) throw new Error(`${flag} requires a path`);
      parsed[target] = pathValue;
      continue;
    }
    if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    positional.push(value);
  }
  if (!parsed.source && positional[0]) parsed.source = positional[0];
  if (!parsed.destination && positional[1]) parsed.destination = positional[1];
  if (positional.length > 2) throw new Error("Expected source and destination only");
  if (!parsed.source || !parsed.destination) {
    throw new Error(
      "Usage: configure-microplus-profile.mjs --source /absolute/source.sdProfile --destination /absolute/clone.sdProfile [--backup-dir /absolute/backups] [--dry-run]",
    );
  }
  return parsed;
}

async function inspectPlan(options) {
  const source = resolveRequiredAbsolute(options.source, "source");
  const destination = resolveRequiredAbsolute(options.destination, "destination");
  if (source === destination) throw new Error("Source and destination must be different paths");
  if (isInside(destination, source) || isInside(source, destination)) {
    throw new Error("Source and destination must not contain one another");
  }

  const sourceStats = await stat(source).catch(() => undefined);
  if (!sourceStats?.isDirectory()) throw new Error(`Source profile directory not found: ${source}`);
  const destinationStats = await stat(destination).catch(() => undefined);
  if (destinationStats && !destinationStats.isDirectory()) {
    throw new Error(`Destination exists but is not a profile directory: ${destination}`);
  }
  const backupDir = resolve(options.backupDir ?? join(dirname(destination), BACKUP_DIR_NAME));
  if (!isAbsolutePath(backupDir)) throw new Error("Backup directory must be an absolute path");
  if (isInside(backupDir, source) || isInside(source, backupDir) || isInside(backupDir, destination) || isInside(destination, backupDir)) {
    throw new Error("Backup directory must be separate from source and destination profiles");
  }

  const rootManifest = await readJson(join(source, "manifest.json"), "source profile manifest");
  const pluginManifest = await readJson(PLUGIN_MANIFEST_URL, "MicroPlus plugin manifest");
  if (pluginManifest.UUID !== PLUGIN_UUID || typeof pluginManifest.Version !== "string") {
    throw new Error("MicroPlus plugin manifest UUID or version is invalid");
  }
  const pageIds = rootManifest?.Pages?.Pages;
  if (!Array.isArray(pageIds) || pageIds.length === 0 || pageIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("Source profile manifest must contain a non-empty Pages.Pages array");
  }
  if (new Set(pageIds.map((id) => id.toLowerCase())).size !== pageIds.length) {
    throw new Error("Source profile Pages.Pages contains duplicate page IDs");
  }
  const pageDirectories = await listPageDirectories(source);
  const pageManifests = new Map();
  for (const pageId of new Set([...pageIds, rootManifest.Pages.Default].filter((id) => typeof id === "string"))) {
    const pageDirectory = pageDirectories.get(pageId.toLowerCase());
    if (!pageDirectory) throw new Error(`Page directory not found for page ID: ${pageId}`);
    const manifestPath = join(pageDirectory, "manifest.json");
    pageManifests.set(pageId.toLowerCase(), {
      id: pageId,
      directory: pageDirectory,
      manifestPath,
      manifest: await readJson(manifestPath, `page manifest ${pageId}`),
    });
  }
  const pageSwitch = await findPageSwitch(pageDirectories, pageManifests);
  const template = pageManifests.get(pageIds[0].toLowerCase());
  if (!template) throw new Error("The first active page has no manifest");
  if (!Array.isArray(template.manifest.Controllers)) throw new Error("Source page manifest has no Controllers array");
  const defaultTemplate = typeof rootManifest.Pages.Default === "string"
    ? pageManifests.get(rootManifest.Pages.Default.toLowerCase())
    : undefined;

  const destinationPageDirectories = destinationStats ? await listPageDirectories(destination) : new Map();
  const sourceProfileDirectoryIds = await listProfileDirectoryIds(source);
  const destinationProfileDirectoryIds = destinationStats ? await listProfileDirectoryIds(destination) : [];
  const destinationRootPageIds = destinationStats ? await optionalRootPageIds(destination) : [];
  const reservedPageIds = new Set([
    ...pageIds,
    rootManifest.Pages.Current,
    rootManifest.Pages.Default,
    ...pageDirectories.keys(),
    ...destinationPageDirectories.keys(),
    ...sourceProfileDirectoryIds,
    ...destinationProfileDirectoryIds,
    ...destinationRootPageIds,
  ].filter((id) => typeof id === "string").map((id) => id.toLowerCase()));
  const generatedPageIds = freshPageIds(PAGE_DEFINITIONS.length, reservedPageIds);
  const [generatedDefaultPageId] = freshPageIds(1, new Set([
    ...reservedPageIds,
    ...generatedPageIds.map((id) => id.toLowerCase()),
  ]));

  const backupKind = destinationStats ? "destination" : "source";
  const backupLabel = destinationStats ? basename(destination) : basename(source);
  return {
    source,
    destination,
    backupDir,
    backupKind,
    backupLabel,
    destinationExists: Boolean(destinationStats),
    rootManifest,
    pageIds,
    pageDirectories,
    pageManifests,
    template,
    defaultTemplate: defaultTemplate ?? template,
    pageSwitch,
    pluginVersion: pluginManifest.Version,
    generatedPageIds,
    generatedDefaultPageId,
    pageDefinitions: PAGE_DEFINITIONS,
  };
}

async function buildProfile(plan) {
  await mkdir(plan.backupDir, { recursive: true });
  const backupPath = await uniquePath(plan.backupDir, `${safeName(plan.backupLabel)}-before-microplus`);
  let destinationMoved = false;
  let staging;
  try {
    if (plan.destinationExists) {
      await rename(plan.destination, backupPath);
      destinationMoved = true;
    } else {
      await cp(plan.source, backupPath, { recursive: true, errorOnExist: true, force: false });
    }

    staging = `${plan.destination}.microplus-${randomUUID()}`;
    await createStagingProfile(plan, staging);
    await materialize(staging, plan);
    await rename(staging, plan.destination);
    return { backupPath, backupKind: plan.backupKind };
  } catch (error) {
    if (staging) {
      // Keep a failed staging tree recoverable instead of deleting it.
      const failedPath = await uniquePath(plan.backupDir, `${safeName(plan.backupLabel)}-failed-staging`);
      await rename(staging, failedPath).catch(() => undefined);
    }
    if (destinationMoved) {
      await rename(backupPath, plan.destination).catch(() => undefined);
    }
    throw error;
  }
}

async function materialize(destination, plan) {
  const rootPath = join(destination, "manifest.json");
  const root = await readJson(rootPath, "clone profile manifest");
  const profileDirectories = await listPageDirectories(destination);

  for (let index = 0; index < plan.generatedPageIds.length; index += 1) {
    const pageId = plan.generatedPageIds[index];
    const pageDirectory = profileDirectories.get(pageId.toLowerCase());
    if (!pageDirectory) throw new Error(`Clone page directory is missing for page ID: ${pageId}`);
    const pageManifestPath = join(pageDirectory, "manifest.json");
    const original = await readJson(pageManifestPath, `clone page manifest ${pageId}`);
    const definition = plan.pageDefinitions[index];
    const next = createPageManifest(original, definition, plan.pageSwitch, plan.pluginVersion);
    await writeJsonAtomic(pageManifestPath, next);
  }

  const nextRoot = {
    ...root,
    Name: PROFILE_NAME,
    AppIdentifier: CODEX_APP_IDENTIFIER,
    Pages: {
      ...(root.Pages ?? {}),
      Current: plan.generatedPageIds[0],
      // Stream Deck stores a separate, non-visible default page beside the
      // active Pages array. Reusing an active page here makes the host repair
      // the profile on startup and emit a duplicate-page warning.
      Default: plan.generatedDefaultPageId,
      Pages: plan.generatedPageIds,
    },
  };
  // MicroPlus is an app-specific profile even when the clean source is the
  // unbound Default Profile. Binding the clone keeps Default Profile generic.
  await writeJsonAtomic(rootPath, nextRoot);
}

async function createStagingProfile(plan, staging) {
  await mkdir(staging, { recursive: true });
  const entries = await readdir(plan.source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.toLowerCase() === "profiles") continue;
    await cp(join(plan.source, entry.name), join(staging, entry.name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }

  const profilesDirectory = join(staging, "Profiles");
  await mkdir(profilesDirectory, { recursive: true });
  for (const pageId of plan.generatedPageIds) {
    await cp(plan.template.directory, join(profilesDirectory, pageDirectoryName(pageId)), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  await cp(plan.defaultTemplate.directory, join(profilesDirectory, pageDirectoryName(plan.generatedDefaultPageId)), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}

function createPageManifest(template, definition, pageSwitch, pluginVersion) {
  const next = cloneJson(template);
  next.Name = definition.name;
  const controllers = Array.isArray(next.Controllers) ? next.Controllers.map(cloneJson) : [];
  let keypad = controllers.find((controller) => controller.Type === "Keypad");
  let encoder = controllers.find((controller) => controller.Type === "Encoder");
  if (!keypad) {
    keypad = { Type: "Keypad" };
    controllers.push(keypad);
  }
  if (!encoder) {
    encoder = { Type: "Encoder" };
    controllers.push(encoder);
  }
  keypad.Actions = Object.fromEntries(definition.keys.map(([id, label, settings], index) => [
    keyPosition(index), microAction(id, label, "key", settings, pluginVersion),
  ]));
  encoder.Actions = Object.fromEntries([
    ...definition.dials.map(([id, label, settings], index) => [
      `${index},0`, microAction(id, label, "encoder", settings, pluginVersion),
    ]),
    [HOST_ADAPTOR_POSITION, cloneJson(pageSwitch)],
  ]);
  next.Controllers = controllers;
  return next;
}

function microAction(actionId, label, kind, settings, pluginVersion) {
  const title = label;
  const actionSettings = {
    schemaVersion: 1,
    surface: "codex-micro-plus",
    actionId,
    kind,
    label,
    displaySource: displaySourceFor(actionId, settings),
    ...cloneJson(settings),
  };
  return {
    ActionID: randomUUID(),
    LinkedTitle: false,
    Name: title,
    Plugin: { Name: PROFILE_NAME, UUID: PLUGIN_UUID, Version: pluginVersion },
    Resources: null,
    Settings: actionSettings,
    State: 0,
    States: [{
      FontFamily: "",
      FontSize: kind === "encoder" ? 10 : 11,
      FontStyle: "Bold",
      FontUnderline: false,
      OutlineThickness: 2,
      ShowTitle: true,
      Title: title,
      TitleAlignment: "bottom",
      TitleColor: "#ffffff",
    }],
    UUID: `${PLUGIN_UUID}.${actionId}`,
  };
}

function displaySourceFor(actionId, settings) {
  if (/^agent-[1-6]$/u.test(actionId)) return { kind: "agent-slot", slot: settings.slot };
  if (["reasoning", "reasoning-down", "reasoning-up", "dial-reasoning"].includes(actionId)) return { kind: "reasoning" };
  if (["usage-limit", "usage-overview", "rate-limit-reset", "dial-usage"].includes(actionId)) return { kind: "usage" };
  if (actionId.startsWith("keycap-")) return { kind: "keycap", keycapId: settings.keycapId };
  if (["keycap-codex", "new-task"].includes(actionId)) return { kind: "codex" };
  return { kind: "codex-micro" };
}

function keyPosition(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 8) throw new Error(`Invalid key index: ${index}`);
  return `${index % 4},${Math.floor(index / 4)}`;
}

function freshPageIds(count, reservedPageIds) {
  const generated = [];
  const reserved = new Set(reservedPageIds);
  while (generated.length < count) {
    const pageId = randomUUID();
    const normalized = pageId.toLowerCase();
    if (reserved.has(normalized)) continue;
    reserved.add(normalized);
    generated.push(pageId);
  }
  return generated;
}

function pageDirectoryName(pageId) {
  return pageId.toUpperCase();
}

async function findPageSwitch(pageDirectories, pageManifests) {
  const candidates = [...pageManifests.values()];
  for (const directory of pageDirectories.values()) {
    if (!candidates.some((candidate) => candidate.directory === directory)) {
      const manifestPath = join(directory, "manifest.json");
      candidates.push({ directory, manifestPath, manifest: await readJson(manifestPath, "page manifest") });
    }
  }
  for (const candidate of candidates) {
    for (const controller of candidate.manifest.Controllers ?? []) {
      for (const action of Object.values(controller.Actions ?? {})) {
        if (action?.UUID === HOST_ADAPTOR_UUID) return cloneJson(action);
      }
    }
  }
  throw new Error(`Source profile does not contain ${HOST_ADAPTOR_UUID}`);
}

async function listProfileDirectoryIds(profileRoot) {
  const entries = await readdir(join(profileRoot, "Profiles"), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function optionalRootPageIds(profileRoot) {
  const manifest = await readJson(join(profileRoot, "manifest.json"), "existing destination profile manifest").catch(() => undefined);
  const pages = manifest?.Pages;
  return [
    ...(Array.isArray(pages?.Pages) ? pages.Pages : []),
    pages?.Current,
    pages?.Default,
  ].filter((id) => typeof id === "string");
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.microplus-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function uniquePath(directory, label) {
  const base = join(directory, `${label}-${timestamp()}.sdProfile`);
  let candidate = base;
  let suffix = 1;
  while (await stat(candidate).then(() => true).catch(() => false)) {
    candidate = join(directory, `${label}-${timestamp()}-${suffix}.sdProfile`);
    suffix += 1;
  }
  return candidate;
}

function resolveRequiredAbsolute(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} path is required`);
  if (!isAbsolutePath(value)) throw new Error(`${label} path must be absolute: ${value}`);
  return resolve(value);
}

function isAbsolutePath(value) {
  return typeof value === "string" && value.startsWith(sep);
}

function isInside(candidate, parent) {
  const relative = resolve(candidate).startsWith(`${resolve(parent)}${sep}`);
  return relative;
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "") || "profile";
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function printPlan(result) {
  process.stdout.write(`${JSON.stringify({
    source: result.source,
    destination: result.destination,
    backupDir: result.backupDir,
    backupPath: result.backupPath ?? null,
    backupKind: result.backupKind,
    dryRun: result.dryRun,
    created: result.created,
    profileName: PROFILE_NAME,
    pluginVersion: result.pluginVersion,
    pageCount: result.generatedPageIds.length,
    pageIds: result.generatedPageIds,
    defaultPageId: result.generatedDefaultPageId,
    pages: result.pageDefinitions.map((page) => ({
      name: page.name,
      keys: page.keys.map(([id]) => `${PLUGIN_UUID}.${id}`),
      dials: page.dials.map(([id]) => `${PLUGIN_UUID}.${id}`),
      pageSwitch: HOST_ADAPTOR_UUID,
    })),
  }, null, 2)}\n`);
}
