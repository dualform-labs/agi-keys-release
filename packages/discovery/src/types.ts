/**
 * Data-only snapshot produced by the renderer source discovery pass.
 *
 * Nothing in this file (or in the discovery package) is callable renderer
 * code.  The snapshot is deliberately kept separate from any adapter that
 * may later decide whether a command can be executed.
 */

export type SupportStatus = 'unverified';

export interface SupportNote {
  status: SupportStatus;
  reason: string;
}

export interface SourceRegion {
  /** Byte offsets are UTF-16 source offsets, matching String#slice. */
  start: number;
  end: number;
  marker: string;
}

export interface SourceRef {
  archivePath: string;
  region: SourceRegion;
}

export interface SourceArtifact {
  archivePath: string;
  bytes: number;
  sha256: string;
  roles: string[];
}

export interface KeybindingSet {
  default?: string[];
  macOS?: string[];
  /** Platform defaults for non-macOS platforms, retained as source data. */
  platformDefault?: string[];
}

export interface CommandKeybindings {
  electron?: KeybindingSet;
  browser?: KeybindingSet;
}

export interface BindingFeasibility {
  /** This is evidence classification, not permission to execute the command. */
  status: 'micro-keycap' | 'app-keybinding' | 'catalog-only';
  observedInMicroKeycap: boolean;
  observedAppKeybinding: boolean;
  externalBinding: 'not-observed';
  reason: string;
}

export interface CommandInventoryEntry {
  id: string;
  label: string | null;
  /** The translation resource identifier, when the bundle supplies one. */
  titleIntlId: string | null;
  descriptionIntlId: string | null;
  registryKind: 'webview' | 'electron-only';
  availableIn: string[] | null;
  commandMenu: boolean | null;
  keybindings: CommandKeybindings;
  microKeycapIds: string[];
  bindingFeasibility: BindingFeasibility;
  support: SupportNote;
  sources: SourceRef[];
}

export type MicroAction =
  | { type: 'command'; commandId: string }
  | { type: 'named'; label: string }
  | { type: 'external-url'; label: string; url: string }
  | { type: 'composer-text'; label: string; text: string }
  | { type: 'custom-shortcut' };

export interface MicroKeycapInventoryEntry {
  id: string;
  icon: string | null;
  size: 'single' | 'double' | null;
  label: string | null;
  action: MicroAction;
  support: SupportNote;
  sources: SourceRef[];
}

export interface ExecutableRegistryEntry {
  commandId: string;
  /** The minified symbol that is present in the renderer map. */
  handlerSymbol: string;
  handlerPresent: true;
  executableHere: false;
}

export interface ExecutableRegistrySnapshot {
  status: 'static-symbols-only';
  executableHere: false;
  reason: string;
  entries: ExecutableRegistryEntry[];
  sources: SourceRef[];
}

export interface AppProvenance {
  appPath: string;
  archivePath: string;
  bundleIdentifier: string | null;
  bundleShortVersion: string | null;
  bundleVersion: string | null;
  archiveBytes: number;
  archiveSha256: string;
}

export interface CommandInventory {
  schemaVersion: 1;
  discoveredAt: string;
  support: SupportNote;
  app: AppProvenance;
  sources: SourceArtifact[];
  commands: CommandInventoryEntry[];
  keycaps: MicroKeycapInventoryEntry[];
  executableRegistry: ExecutableRegistrySnapshot;
  diagnostics: string[];
}
