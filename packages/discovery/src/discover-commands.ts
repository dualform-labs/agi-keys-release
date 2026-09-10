import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type {
  CommandInventory,
  CommandInventoryEntry,
  CommandKeybindings,
  ExecutableRegistryEntry,
  ExecutableRegistrySnapshot,
  KeybindingSet,
  MicroAction,
  MicroKeycapInventoryEntry,
  SourceArtifact,
  SourceRef,
  SourceRegion,
} from './types.js';
import {
  arrayObjects,
  keybindingList,
  literal,
  literalList,
  matchingDelimiter,
  property,
  topLevelProperties,
  type PropertyValue,
} from './source-scanner.js';

/** The subset of the installed asar package used by this read-only pass. */
export interface AsarReader {
  listPackage(archivePath: string): string[];
  extractFile(archivePath: string, archiveMember: string): Buffer;
}

export interface DiscoveryOptions {
  /** Test hook; the production default loads the installed asar package. */
  asar?: AsarReader;
  /** Test hook for stable snapshots. */
  now?: () => Date;
}

const DEFAULT_ASAR_MODULE = '/opt/homebrew/lib/node_modules/asar/lib/asar';
const SUPPORT_REASON =
  'Static source discovery only. It does not prove runtime availability, a supported external binding, or safe command execution.';
const EXTERNAL_BINDING_REASON =
  'The renderer source contains app-local mappings; no supported external binding API was observed by this read-only pass.';

interface ParsedCommand {
  id: string;
  label: string | null;
  titleIntlId: string | null;
  descriptionIntlId: string | null;
  kind: 'webview' | 'electron-only';
  availableIn: string[] | null;
  commandMenu: boolean | null;
  keybindings: CommandKeybindings;
  source: SourceRef;
}

interface ParsedKeycap {
  id: string;
  icon: string | null;
  size: 'single' | 'double' | null;
  label: string | null;
  action: MicroAction;
  source: SourceRef;
}

interface TextSource {
  archivePath: string;
  bytes: Buffer;
  text: string;
  artifact: SourceArtifact;
}

interface CommandCatalogSource {
  source: TextSource;
  webviewMarker: string;
  electronOnlyMarker: string;
}

// Minified identifiers are part of the installed asset shape, so keep the
// known layouts explicit. Do not infer arbitrary arrays from their contents:
// an unrelated descriptor array must never be promoted into the inventory.
const KNOWN_COMMAND_CATALOG_LAYOUTS = [
  { webviewMarker: 'Q2i=[', electronOnlyMarker: 'J2i=[' },
  { webviewMarker: 'i7i=[', electronOnlyMarker: 'e7i=[' },
] as const;

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function loadAsarReader(): AsarReader {
  const require = createRequire(import.meta.url);
  const candidates = [DEFAULT_ASAR_MODULE, 'asar'];
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate) as Partial<AsarReader>;
      if (typeof loaded.listPackage === 'function' && typeof loaded.extractFile === 'function') {
        return loaded as AsarReader;
      }
    } catch {
      // Try the next installation location. The error below is more useful.
    }
  }
  throw new Error(
    `The read-only asar reader is unavailable. Install asar at ${DEFAULT_ASAR_MODULE} or pass DiscoveryOptions.asar.`,
  );
}

function archivePathFor(appPath: string): { appPath: string; archivePath: string } {
  const resolved = resolve(appPath);
  if (resolved.endsWith('.asar')) {
    // /ChatGPT.app/Contents/Resources/app.asar -> /ChatGPT.app
    const looksLikeBundleArchive = resolved.endsWith(join('Contents', 'Resources', 'app.asar'));
    return {
      appPath: looksLikeBundleArchive ? dirname(dirname(dirname(resolved))) : dirname(resolved),
      archivePath: resolved,
    };
  }
  return { appPath: resolved, archivePath: join(resolved, 'Contents', 'Resources', 'app.asar') };
}

function readPlistValue(plistPath: string, key: string): string | null {
  if (!existsSync(plistPath)) return null;
  try {
    const value = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function normalizeMember(member: string): string {
  return member.replace(/^\/+/, '');
}

function archiveDisplayPath(member: string): string {
  return `/${normalizeMember(member)}`;
}

function sourceArtifact(source: TextSource, role: string): SourceArtifact {
  return { ...source.artifact, roles: Array.from(new Set([...source.artifact.roles, role])).sort() };
}

function sourceRef(source: TextSource, region: SourceRegion): SourceRef {
  return { archivePath: source.archivePath, region };
}

function uniqueSourceRefs(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.archivePath}:${ref.region.start}:${ref.region.end}:${ref.region.marker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keybindingSet(value: string | undefined): KeybindingSet | undefined {
  if (!value?.startsWith('{') || !value.endsWith('}')) return undefined;
  const nested = topLevelProperties(value);
  const result: KeybindingSet = {};
  const defaults = keybindingList(property(nested, 'defaultKeybindings'));
  const macOS = keybindingList(property(topLevelProperties(property(nested, 'platformDefaultKeybindings') ?? ''), 'macOS'));
  const platformDefault = keybindingList(property(topLevelProperties(property(nested, 'platformDefaultKeybindings') ?? ''), 'default'));
  if (defaults) result.default = defaults;
  if (macOS) result.macOS = macOS;
  if (platformDefault) result.platformDefault = platformDefault;
  return Object.keys(result).length > 0 ? result : undefined;
}

function commandKeybindings(properties: PropertyValue[]): CommandKeybindings {
  const result: CommandKeybindings = {};
  const electron = keybindingSet(property(properties, 'electron'));
  const browser = keybindingSet(property(properties, 'browser'));
  if (electron) result.electron = electron;
  if (browser) result.browser = browser;
  return result;
}

function firstArrayStart(text: string, marker: string): number {
  const markerOffset = text.indexOf(marker);
  if (markerOffset < 0) return -1;
  const arrayOffset = text.indexOf('[', markerOffset);
  return arrayOffset;
}

function sourceForArray(source: TextSource, marker: string, start: number, end: number, role: string): SourceRef {
  return sourceRef(source, { start, end, marker: `${role}:${marker}` });
}

function numericMapValues(source: TextSource, objectStart: number): number[] | null {
  // The current catalog has one source-level expansion:
  // ...[1,2,3,4,5,6,7,8,9].map(e=>({id:`focusTab${e}`, ...})).
  // Expand only this literal numeric-map shape. A template without this
  // directly adjacent source evidence is omitted instead of being guessed.
  const prefix = source.text.slice(Math.max(0, objectStart - 256), objectStart);
  const match = /\.\.\.\[([0-9]+(?:,[0-9]+)*)\]\.map\(e=>\(\s*$/.exec(prefix);
  return match ? match[1].split(',').map((value) => Number(value)) : null;
}

function parseCommandArray(source: TextSource, marker: string, kind: ParsedCommand['kind']): ParsedCommand[] {
  const arrayStart = firstArrayStart(source.text, marker);
  if (arrayStart < 0) return [];
  const arrayEnd = matchingDelimiter(source.text, arrayStart, '[', ']');
  const parsed: ParsedCommand[] = [];
  for (const object of arrayObjects(source.text, arrayStart)) {
    const rawProperties = topLevelProperties(object.text);
    const rawId = literal(property(rawProperties, 'id'));
    if (!rawId) continue;
    const values = rawId.includes('${') ? numericMapValues(source, object.start) : [null];
    if (values === null) continue;
    for (const value of values) {
      const objectText = value === null ? object.text : object.text.replaceAll('${e}', String(value));
      const properties = topLevelProperties(objectText);
      const electronProperties = topLevelProperties(property(properties, 'electron') ?? '');
      const id = literal(property(properties, 'id'));
      if (!id || id.includes('${')) continue;
      const sourceLocation = sourceForArray(source, marker, object.start, object.end, 'command-descriptor');
      parsed.push({
        id,
        // `menuTitle` is nested under the electron descriptor in the current
        // bundle. Keep the top-level fallback for older/currently unknown
        // descriptor shapes, but never infer a label from an Intl id.
        label: literal(property(electronProperties, 'menuTitle')) ?? literal(property(properties, 'menuTitle')),
        titleIntlId: literal(property(properties, 'titleIntlId')),
        descriptionIntlId: literal(property(properties, 'descriptionIntlId')),
        kind,
        availableIn: literalList(property(properties, 'availableIn')),
        commandMenu: property(properties, 'commandMenu') === undefined ? null : property(properties, 'commandMenu') === '!0',
        keybindings: commandKeybindings(properties),
        source: sourceLocation,
      });
    }
  }
  // Touch the calculated end so malformed input cannot silently look valid if
  // a future minifier changes the declaration shape.
  if (arrayEnd <= arrayStart) return [];
  return parsed;
}

function parseExecutableRegistry(source: TextSource): ExecutableRegistrySnapshot {
  const marker = '_xi=new Map([';
  const markerOffset = source.text.indexOf(marker);
  if (markerOffset < 0) {
    return {
      status: 'static-symbols-only',
      executableHere: false,
      reason: 'The renderer executable symbol map was not found in the inspected source.',
      entries: [],
      sources: [],
    };
  }
  const arrayStart = source.text.indexOf('[', markerOffset + marker.length - 1);
  const arrayEnd = matchingDelimiter(source.text, arrayStart, '[', ']');
  const body = source.text.slice(arrayStart, arrayEnd + 1);
  const entries: ExecutableRegistryEntry[] = [];
  for (const match of body.matchAll(/\[`((?:\\.|[^`])*)`,([A-Za-z0-9_$]+)\]/g)) {
    entries.push({
      commandId: match[1].replace(/\\([`\\])/g, '$1'),
      handlerSymbol: match[2],
      handlerPresent: true,
      executableHere: false,
    });
  }
  const sourceLocation = sourceRef(source, {
    start: markerOffset,
    end: arrayEnd + 1,
    marker: 'executable-registry:_xi',
  });
  return {
    status: 'static-symbols-only',
    executableHere: false,
    reason: 'Only command IDs and minified handler symbols were recorded; renderer code was never evaluated.',
    entries,
    sources: [sourceLocation],
  };
}

function parseMicroLabels(source: TextSource): Map<string, { label: string; region: SourceRegion }> {
  const start = source.text.indexOf('function pi');
  const end = start < 0 ? -1 : source.text.indexOf('function mi', start);
  const labels = new Map<string, { label: string; region: SourceRegion }>();
  if (start < 0 || end < 0) return labels;
  const body = source.text.slice(start, end);
  const casePositions = [...body.matchAll(/case`([^`]+)`/g)].map((match) => ({
    id: match[1],
    offset: (match.index ?? 0),
  }));
  const pendingAliases: string[] = [];
  for (let index = 0; index < casePositions.length; index += 1) {
    const current = casePositions[index];
    const nextOffset = casePositions[index + 1]?.offset ?? body.length;
    const segment = body.slice(current.offset, nextOffset);
    const label = segment.match(/defaultMessage:`((?:\\.|[^`])*)`/)?.[1];
    const ids = [...segment.matchAll(/case`([^`]+)`/g)].map((match) => match[1]);
    if (!label) {
      // A consecutive `case A:case B:` alias has no body in the first
      // segment. Keep only that shape pending; dynamic branches such as MIC
      // contain executable statements and are intentionally not guessed.
      const residue = segment.replace(/case`[^`]+`:/g, '').replace(/[{}\s]/g, '');
      if (residue.length === 0) pendingAliases.push(...ids);
      else pendingAliases.length = 0;
      continue;
    }
    const value = label.replace(/\\([`\\])/g, '$1');
    const allIds = [...pendingAliases, ...ids];
    pendingAliases.length = 0;
    for (const id of allIds) {
      labels.set(id, {
        label: value,
        region: { start: start + current.offset, end: start + nextOffset, marker: 'micro-labels:function-pi' },
      });
    }
  }
  return labels;
}

function parseMicroKeycaps(source: TextSource, labels: Map<string, { label: string; region: SourceRegion }>): ParsedKeycap[] {
  const marker = 's=[{id:';
  const arrayStart = firstArrayStart(source.text, marker);
  if (arrayStart < 0) return [];
  const keycaps: ParsedKeycap[] = [];
  for (const object of arrayObjects(source.text, arrayStart)) {
    const properties = topLevelProperties(object.text);
    const id = literal(property(properties, 'id'));
    if (!id) continue;
    const actionProperties = topLevelProperties(property(properties, 'action') ?? '');
    const type = literal(property(actionProperties, 'type'));
    if (!type) continue;
    let action: MicroAction;
    if (type === 'command') {
      const commandId = literal(property(actionProperties, 'command'));
      if (!commandId) continue;
      action = { type: 'command', commandId };
    } else if (type === 'named') {
      const label = literal(property(actionProperties, 'label'));
      if (!label) continue;
      action = { type: 'named', label };
    } else if (type === 'external-url') {
      const label = literal(property(actionProperties, 'label'));
      const url = literal(property(actionProperties, 'url'));
      if (!label || !url) continue;
      action = { type: 'external-url', label, url };
    } else if (type === 'composer-text') {
      const label = literal(property(actionProperties, 'label'));
      const text = literal(property(actionProperties, 'text'));
      if (!label || text === null) continue;
      action = { type: 'composer-text', label, text };
    } else if (type === 'custom-shortcut') {
      action = { type: 'custom-shortcut' };
    } else {
      continue;
    }
    const label = labels.get(id)?.label ?? ('label' in action ? action.label : null);
    const sourceLocation = sourceRef(source, {
      start: object.start,
      end: object.end,
      marker: 'micro-layout:keycap-catalog',
    });
    keycaps.push({
      id,
      icon: literal(property(properties, 'icon')),
      size: property(properties, 'size') === '`single`' || property(properties, 'size') === '`double`'
        ? (literal(property(properties, 'size')) as 'single' | 'double')
        : null,
      label,
      action,
      source: sourceLocation,
    });
  }
  return keycaps;
}

function commandIsElectronAvailable(command: ParsedCommand): boolean {
  return command.availableIn === null || command.availableIn.includes('electron');
}

function mergeCommands(commands: ParsedCommand[]): ParsedCommand[] {
  const merged = new Map<string, ParsedCommand>();
  for (const command of commands) {
    const previous = merged.get(command.id);
    if (!previous) {
      merged.set(command.id, command);
      continue;
    }
    // The current bundle has disjoint Q2i/J2i IDs. If a future bundle repeats
    // an ID, retain the first descriptor and let diagnostics report it rather
    // than guessing which minified object is executable.
  }
  return [...merged.values()];
}

function addSourceArtifact(artifacts: Map<string, SourceArtifact>, source: TextSource, role: string): void {
  artifacts.set(source.archivePath, sourceArtifact(source, role));
}

function readSource(
  reader: AsarReader,
  archiveFilePath: string,
  archiveMember: string,
  members: Set<string>,
  role: string,
): TextSource | null {
  const member = normalizeMember(archiveMember);
  if (!members.has(member)) return null;
  const bytes = reader.extractFile(archiveFilePath, member);
  return {
    archivePath: archiveDisplayPath(member),
    bytes,
    text: bytes.toString('utf8'),
    artifact: { archivePath: archiveDisplayPath(member), bytes: bytes.byteLength, sha256: sha256(bytes), roles: [role] },
  };
}

function findSourceMember(members: Set<string>, pattern: RegExp): string | null {
  return [...members].filter((member) => pattern.test(member)).sort()[0] ?? null;
}

function findCommandSource(reader: AsarReader, archiveFilePath: string, members: Set<string>): CommandCatalogSource | null {
  const candidates = [
    ...[...members].filter((member) => /^webview\/assets\/app-initial-[^/]+\.js$/.test(member)),
    ...[...members].filter((member) => /^\.vite\/build\/src-[^/]+\.js$/.test(member)),
  ].sort();
  for (const member of candidates) {
    const source = readSource(reader, archiveFilePath, member, members, 'command-catalog');
    if (!source) continue;
    for (const layout of KNOWN_COMMAND_CATALOG_LAYOUTS) {
      if (source.text.includes(layout.webviewMarker) && source.text.includes(layout.electronOnlyMarker)) {
        return { source, ...layout };
      }
    }
  }
  return null;
}

function findAssetSource(reader: AsarReader, archiveFilePath: string, members: Set<string>, prefix: string): TextSource | null {
  const member = findSourceMember(members, new RegExp(`^webview/assets/${prefix}-[^/]+\\.js$`));
  return member ? readSource(reader, archiveFilePath, member, members, prefix) : null;
}

function finalizeCommand(
  command: ParsedCommand,
  keycapsByCommand: Map<string, ParsedKeycap[]>,
  labels: Map<string, { label: string; region: SourceRegion }>,
  settingsSource: TextSource | null,
): CommandInventoryEntry {
  const keycaps = keycapsByCommand.get(command.id) ?? [];
  const keybindingObserved = Object.values(command.keybindings).some((set) => Object.keys(set ?? {}).length > 0);
  const status: CommandInventoryEntry['bindingFeasibility']['status'] = keycaps.length > 0
    ? 'micro-keycap'
    : keybindingObserved
      ? 'app-keybinding'
      : 'catalog-only';
  const keycapLabel = keycaps.find((keycap) => keycap.label)?.label ?? null;
  const sources: SourceRef[] = [command.source];
  for (const keycap of keycaps) {
    sources.push(keycap.source);
    const labelSource = labels.get(keycap.id);
    if (labelSource && settingsSource) sources.push(sourceRef(settingsSource, labelSource.region));
  }
  return {
    id: command.id,
    label: keycapLabel ?? command.label,
    titleIntlId: command.titleIntlId,
    descriptionIntlId: command.descriptionIntlId,
    registryKind: command.kind,
    availableIn: command.availableIn,
    commandMenu: command.commandMenu,
    keybindings: command.keybindings,
    microKeycapIds: keycaps.map((keycap) => keycap.id),
    bindingFeasibility: {
      status,
      observedInMicroKeycap: keycaps.length > 0,
      observedAppKeybinding: keybindingObserved,
      externalBinding: 'not-observed',
      reason: EXTERNAL_BINDING_REASON,
    },
    support: { status: 'unverified', reason: SUPPORT_REASON },
    sources: uniqueSourceRefs(sources),
  };
}

function emptyExecutableRegistry(reason: string): ExecutableRegistrySnapshot {
  return { status: 'static-symbols-only', executableHere: false, reason, entries: [], sources: [] };
}

/**
 * Discover the current Codex Micro command catalog from an app bundle.
 *
 * This function only reads `Info.plist`, `app.asar` metadata, and selected
 * renderer assets through the installed asar reader. It never extracts the
 * bundle to disk and never evaluates renderer JavaScript.
 */
export function discoverCommands(appPath: string, options: DiscoveryOptions = {}): CommandInventory {
  const { appPath: resolvedAppPath, archivePath } = archivePathFor(appPath);
  if (!existsSync(archivePath)) throw new Error(`Codex app.asar was not found at ${archivePath}`);
  const archiveStat = statSync(archivePath);
  if (!archiveStat.isFile()) throw new Error(`Codex app.asar is not a regular file: ${archivePath}`);
  const archiveBytes = readFileSync(archivePath);
  const reader = options.asar ?? loadAsarReader();
  const members = new Set(reader.listPackage(archivePath).map(normalizeMember));
  const diagnostics: string[] = [];
  const artifacts = new Map<string, SourceArtifact>();

  const commandSource = findCommandSource(reader, archivePath, members);
  const microCommandFilterSource = findAssetSource(reader, archivePath, members, 'codex-micro-commands');
  const layoutSource = findAssetSource(reader, archivePath, members, 'codex-micro-layout');
  const settingsSource = findAssetSource(reader, archivePath, members, 'codex-micro-settings');
  if (!commandSource) diagnostics.push('Renderer command descriptor source was not found.');
  if (!microCommandFilterSource) diagnostics.push('Codex Micro command filter source was not found.');
  if (!layoutSource) diagnostics.push('Codex Micro layout source was not found.');
  if (!settingsSource) diagnostics.push('Codex Micro settings label source was not found.');

  const labels = settingsSource ? parseMicroLabels(settingsSource) : new Map<string, { label: string; region: SourceRegion }>();
  const keycaps = layoutSource ? parseMicroKeycaps(layoutSource, labels) : [];
  const keycapsByCommand = new Map<string, ParsedKeycap[]>();
  for (const keycap of keycaps) {
    if (keycap.action.type !== 'command') continue;
    const existing = keycapsByCommand.get(keycap.action.commandId) ?? [];
    existing.push(keycap);
    keycapsByCommand.set(keycap.action.commandId, existing);
  }

  let executableRegistry = emptyExecutableRegistry('Renderer executable symbol map was not inspected.');
  let allCommands: ParsedCommand[] = [];
  if (commandSource) {
    addSourceArtifact(artifacts, commandSource.source, 'command-catalog');
    allCommands = mergeCommands([
      ...parseCommandArray(commandSource.source, commandSource.webviewMarker, 'webview'),
      ...parseCommandArray(commandSource.source, commandSource.electronOnlyMarker, 'electron-only'),
    ]);
    executableRegistry = parseExecutableRegistry(commandSource.source);
  }
  if (microCommandFilterSource) addSourceArtifact(artifacts, microCommandFilterSource, 'micro-command-filter');
  if (layoutSource) addSourceArtifact(artifacts, layoutSource, 'micro-layout');
  if (settingsSource) addSourceArtifact(artifacts, settingsSource, 'micro-labels');

  const executableIds = new Set(executableRegistry.entries.map((entry) => entry.commandId));
  const microCommands = allCommands
    .filter((command) => (command.kind === 'webview' && commandIsElectronAvailable(command)) ||
      (command.kind === 'electron-only' && executableIds.has(command.id)))
    .map((command) => finalizeCommand(command, keycapsByCommand, labels, settingsSource));

  const normalizedKeycaps: MicroKeycapInventoryEntry[] = [];
  for (const keycap of keycaps) {
    const labelSource = labels.get(keycap.id);
    const sources = [keycap.source];
    if (labelSource && settingsSource) sources.push(sourceRef(settingsSource, labelSource.region));
    const entry: MicroKeycapInventoryEntry = {
      id: keycap.id,
      icon: keycap.icon,
      size: keycap.size,
      label: keycap.label,
      action: keycap.action,
      support: { status: 'unverified', reason: SUPPORT_REASON },
      sources,
    };
    normalizedKeycaps.push(entry);
  }

  const plistPath = join(resolvedAppPath, 'Contents', 'Info.plist');
  const bundleShortVersion = readPlistValue(plistPath, 'CFBundleShortVersionString');
  const bundleVersion = readPlistValue(plistPath, 'CFBundleVersion');
  const bundleIdentifier = readPlistValue(plistPath, 'CFBundleIdentifier');
  const now = options.now?.() ?? new Date();
  return {
    schemaVersion: 1,
    discoveredAt: now.toISOString(),
    support: { status: 'unverified', reason: SUPPORT_REASON },
    app: {
      appPath: resolvedAppPath,
      archivePath,
      bundleIdentifier,
      bundleShortVersion,
      bundleVersion,
      archiveBytes: archiveBytes.byteLength,
      archiveSha256: sha256(archiveBytes),
    },
    sources: [...artifacts.values()].sort((left, right) => left.archivePath.localeCompare(right.archivePath)),
    commands: microCommands,
    keycaps: normalizedKeycaps,
    executableRegistry,
    diagnostics,
  };
}

/** Stable JSON serialization for reviewable `.cache` snapshots. */
export function serializeInventory(inventory: CommandInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}
