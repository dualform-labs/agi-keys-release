import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { codexDeckStateRoot } from "./codex-deck-paths.js";

export interface RightCommandSession {
  stop(): Promise<void>;
}

export * from "./dictation-shortcut.js";
import { normalizeGlobalDictationShortcut, globalDictationShortcutKey, type GlobalDictationShortcut, type GlobalDictationShortcutSetting } from "./dictation-shortcut.js";

export type RightCommandLauncher = (shortcut: GlobalDictationShortcut) => Promise<RightCommandSession>;

type HoldOwner = {
  token: symbol;
  shortcut: GlobalDictationShortcut;
};

/**
 * Holds one native right-Command key across any number of Stream Deck owners.
 * The native process owns the matching key-up and releases on stdin EOF.
 */
export class RightCommandHold {
  private readonly owners = new Map<string, HoldOwner>();
  private session: RightCommandSession | undefined;
  private releaseUnconfirmed = false;
  private transitions: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly launch: RightCommandLauncher = launchNativeDictationToggle) {}

  get activeOwnerCount(): number { return this.owners.size; }

  async press(owner: string, requestedShortcut: GlobalDictationShortcutSetting = "right-option"): Promise<void> {
    if (this.stopped) throw new Error("E_GLOBAL_DICTATION_STOPPED");
    if (this.owners.has(owner)) { await this.transitions; return; }
    const shortcut = normalizeGlobalDictationShortcut(requestedShortcut);
    for (const current of this.owners.values()) {
      if (globalDictationShortcutKey(current.shortcut) !== globalDictationShortcutKey(shortcut)) {
        throw new Error("E_GLOBAL_DICTATION_SHORTCUT_CONFLICT");
      }
    }
    const token = Symbol(owner);
    this.owners.set(owner, { token, shortcut });
    try {
      await this.enqueue(async () => {
        if (this.releaseUnconfirmed) await this.releaseSession();
        if (this.owners.get(owner)?.token !== token || this.session) return;
        const session = await this.launch(shortcut);
        this.session = session;
        if (this.owners.size === 0 || this.stopped) await this.releaseSession();
      });
    } catch (error) {
      if (this.owners.get(owner)?.token === token) this.owners.delete(owner);
      throw error;
    }
  }

  async release(owner: string): Promise<void> {
    if (!this.owners.delete(owner)) return;
    await this.enqueue(async () => {
      if (this.owners.size === 0) await this.releaseSession();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.owners.clear();
    await this.enqueue(() => this.releaseSession());
  }

  async releaseAll(): Promise<void> {
    this.owners.clear();
    await this.enqueue(() => this.releaseSession());
  }

  private async releaseSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.releaseUnconfirmed = true;
    await session.stop();
    this.session = undefined;
    this.releaseUnconfirmed = false;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transitions.then(operation, operation);
    this.transitions = result.catch(() => undefined);
    return result;
  }
}

export const globalDictationHold = new RightCommandHold(launchNativeDictationToggle);

export function globalDictationHelperPath(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "global-dictation-helper");
}

export interface StagedGlobalDictationHelper {
  executablePath: string;
  cleanup(): Promise<void>;
}

/**
 * Copies the verified packaged helper bytes to a fresh private execution path.
 *
 * The stable content-addressed cache is useful for installation repair, but it
 * must not be the path passed to spawn: a same-user process could replace that
 * pathname after verification. A fresh random directory makes each launch path
 * single-use, and the bytes come from the already-opened packaged file rather
 * than a pathname that is read again after validation.
 */
export async function stageGlobalDictationHelper(
  bundledPath: string,
  stateDirectory = join(codexDeckStateRoot(), "native")
): Promise<StagedGlobalDictationHelper> {
  const safeBundledPath = resolve(bundledPath);
  const safeStateDirectory = resolve(stateDirectory);
  await validateDirectoryPath(dirname(safeBundledPath));
  const bundled = await readRegularFile(safeBundledPath, false);
  const digest = createHash("sha256").update(bundled).digest("hex");
  await ensurePrivateRuntimeDirectory(safeStateDirectory);

  const launchDirectory = await mkdtemp(join(safeStateDirectory, ".launch-"));
  const executablePath = join(launchDirectory, basename(safeBundledPath));
  let executableExists = false;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleaning ??= (async () => {
      if (executableExists) await unlink(executablePath).catch(() => undefined);
      await rmdir(launchDirectory).catch(() => undefined);
    })();
    return cleaning;
  };

  try {
    const directory = await lstat(launchDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        !isOwnedByCurrentUser(directory.uid) || (directory.mode & 0o077) !== 0) {
      throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
    }
    const handle = await open(
      executablePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    executableExists = true;
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || !isOwnedByCurrentUser(metadata.uid)) {
        throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
      }
      await handle.writeFile(bundled);
      await handle.sync();
      await handle.chmod(0o700);
    } finally {
      await handle.close();
    }
    await verifyOwnedExecutable(executablePath, bundled, digest);
    return { executablePath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function materializeGlobalDictationHelper(
  bundledPath: string,
  stateDirectory = join(codexDeckStateRoot(), "native")
): Promise<string> {
  const safeBundledPath = resolve(bundledPath);
  const safeStateDirectory = resolve(stateDirectory);
  await validateDirectoryPath(dirname(safeBundledPath));
  const bundled = await readRegularFile(safeBundledPath, false);
  const digest = createHash("sha256").update(bundled).digest("hex");
  await ensurePrivateRuntimeDirectory(safeStateDirectory);

  const destination = join(safeStateDirectory, `${basename(safeBundledPath)}-${digest}`);
  try {
    await verifyOwnedExecutable(destination, bundled, digest);
    return destination;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const temporary = join(stateDirectory, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    temporaryExists = true;
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || !isOwnedByCurrentUser(metadata.uid)) {
        throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
      }
      await handle.writeFile(bundled);
      await handle.sync();
      await handle.chmod(0o700);
    } finally {
      await handle.close();
    }

    try { await link(temporary, destination); }
    catch (error) { if (!isAlreadyExists(error)) throw error; }
    await unlink(temporary);
    temporaryExists = false;
    await verifyOwnedExecutable(destination, bundled, digest);
    return destination;
  } finally {
    if (temporaryExists) await unlink(temporary).catch(() => undefined);
  }
}

export async function launchNativeRightCommand(
  bundledPath = globalDictationHelperPath(), stateDirectory?: string,
  arguments_: string[] = [],
): Promise<RightCommandSession> {
  const staged = await stageGlobalDictationHelper(bundledPath, stateDirectory);
  let child: ChildProcessWithoutNullStreams;
  let ready: Promise<void>;
  try {
    child = spawn(staged.executablePath, arguments_, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    child.once("close", () => { void staged.cleanup(); });
    ready = waitUntilReady(child);
  } catch (error) {
    await staged.cleanup();
    throw error;
  }
  try {
    // The same executable posts both down and up. Preserve its pathname for
    // the entire native lifetime, including permission checks during release.
    await ready;
  }
  catch (error) {
    try { await stopChild(child, true); } catch {}
    if (child.exitCode !== null || child.signalCode !== null) await staged.cleanup();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    stop(): Promise<void> {
      stopping ??= stopChild(child, false).finally(async () => {
        if (child.exitCode !== null || child.signalCode !== null) await staged.cleanup();
      });
      return stopping;
    }
  };
}

/** Launches one validated toggle pulse and keeps the helper alive for release. */
export function launchNativeDictationToggle(
  shortcut: GlobalDictationShortcutSetting = "right-option",
  bundledPath = globalDictationHelperPath(), stateDirectory?: string,
): Promise<RightCommandSession> {
  const selected = normalizeGlobalDictationShortcut(shortcut);
  return launchNativeRightCommand(
    bundledPath,
    stateDirectory,
    [
      "--shortcut", JSON.stringify(selected),
    ],
  );
}

export function launchNativeRightOptionToggle(
  bundledPath = globalDictationHelperPath(), stateDirectory?: string,
): Promise<RightCommandSession> {
  return launchNativeRightCommand(bundledPath, stateDirectory, ["--toggle-right-option"]);
}

/** Validates the packaged helper and CGEvent access without posting a key event. */
export async function preflightNativeRightCommand(
  bundledPath = globalDictationHelperPath(),
  stateDirectory = join(codexDeckStateRoot(), "native")
): Promise<void> {
  const staged = await stageGlobalDictationHelper(bundledPath, stateDirectory);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(staged.executablePath, ["--preflight"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
  } catch (error) {
    await staged.cleanup();
    throw error;
  }
  try {
    // The read-only helper also needs its pathname until TCC preflight returns.
    await waitUntilReady(child);
    await staged.cleanup();
  } catch (error) {
    await staged.cleanup();
    try { await stopChild(child, true); } catch {}
    throw error;
  }
}

async function readRegularFile(path: string, requireSingleLink: boolean): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (requireSingleLink && metadata.nlink !== 1)) {
      throw new Error("E_GLOBAL_DICTATION_HELPER_UNSAFE");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Validates every directory component before reading a packaged helper.
 * `open(..., O_NOFOLLOW)` protects the final file only; an ancestor symlink
 * would otherwise redirect the lookup before that flag is applied.
 */
async function validateDirectoryPath(path: string): Promise<void> {
  await walkDirectoryPath(path, false);
}

/**
 * Creates a private state path one component at a time. Recursive mkdir would
 * follow a pre-existing symlink in an ancestor, so every component is lstat'd
 * before continuing and again after a missing component is created.
 */
async function ensureDirectoryPath(path: string): Promise<void> {
  await walkDirectoryPath(path, true);
}

async function ensurePrivateRuntimeDirectory(path: string): Promise<void> {
  await ensureDirectoryPath(path);
  const directory = await lstat(path);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !isOwnedByCurrentUser(directory.uid)) {
    throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
  }
  if ((directory.mode & 0o077) !== 0) throw new Error("E_GLOBAL_DICTATION_RUNTIME_PERMISSIONS");
}

async function walkDirectoryPath(path: string, createMissing: boolean): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (!createMissing || !isMissing(error)) throw error;
      try {
        await mkdir(current, { recursive: false, mode: 0o700 });
      } catch (mkdirError) {
        if (!isAlreadyExists(mkdirError)) throw mkdirError;
      }
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
    }
    if (!metadata.isDirectory()) {
      throw new Error("E_GLOBAL_DICTATION_RUNTIME_UNSAFE");
    }
  }
}

async function verifyOwnedExecutable(path: string, expected: Buffer, expectedDigest: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 || !isOwnedByCurrentUser(metadata.uid)) {
      throw new Error("E_GLOBAL_DICTATION_HELPER_UNSAFE");
    }
    const actual = await handle.readFile();
    const actualDigest = createHash("sha256").update(actual).digest("hex");
    if (actualDigest !== expectedDigest || !actual.equals(expected)) {
      throw new Error("E_GLOBAL_DICTATION_HELPER_INTEGRITY");
    }
    await handle.chmod(0o700);
    if (((await handle.stat()).mode & 0o777) !== 0o700) {
      throw new Error("E_GLOBAL_DICTATION_HELPER_PERMISSIONS");
    }
  } finally {
    await handle.close();
  }
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function waitUntilReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    let errorOutput = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("E_GLOBAL_DICTATION_HELPER_TIMEOUT")), 2_500);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onErrorData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.split(/\r?\n/u).includes("READY")) finish();
    };
    const onErrorData = (chunk: Buffer) => { errorOutput += chunk.toString("utf8"); };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(new Error(
      errorOutput.trim() || `E_GLOBAL_DICTATION_HELPER_EXIT_${code ?? "SIGNAL"}`
    ));
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export function stopChild(child: ChildProcessWithoutNullStreams, cleanupOnly: boolean): Promise<void> {
  return new Promise((resolveStop, rejectStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (!cleanupOnly && (child.exitCode !== 0 || child.signalCode !== null)) {
        rejectStop(new Error("E_GLOBAL_DICTATION_HELPER_RELEASE"));
      } else resolveStop();
      return;
    }
    let settled = false;
    const terminate = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
    }, 1_000);
    const kill = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 2_000);
    const deadline = setTimeout(() => finish(new Error("E_GLOBAL_DICTATION_HELPER_STOP_TIMEOUT")), 3_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(terminate);
      clearTimeout(kill);
      clearTimeout(deadline);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) rejectStop(error);
      else resolveStop();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!cleanupOnly && (code !== 0 || signal !== null)) finish(new Error("E_GLOBAL_DICTATION_HELPER_RELEASE"));
      else finish();
    };
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdin.end();
  });
}
