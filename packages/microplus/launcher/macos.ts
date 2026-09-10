import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { applyRuntimeOverride, fetchRuntimeTargetSetSignature, verifyMicroRuntime } from "./runtime-override.js";
import { enumerateCodexMainTargets, processOwnsListener, type DebugTarget } from "../src/codex-debug-discovery.js";

const CODEX_BUNDLE_ID = "com.openai.codex";
const AGENT_LABEL = "io.local.codexdeck.microplus.watcher";
const STATE_ROOT = join(homedir(), "Library", "Application Support", "CodexMicroPlus");
const BRIDGE_STATE_PATH = join(STATE_ROOT, "codex-micro-bridge.json");
const INSTALLED_RUNTIME_PATH = join(STATE_ROOT, "codex-micro-plus-macos.mjs");
const WATCHER_LAUNCHER_PATH = join(STATE_ROOT, "watcher-launch.sh");
const WATCHER_LOG_PATH = join(STATE_ROOT, "watcher.log");
const WATCHER_STDERR_PATH = join(STATE_ROOT, "watcher.stderr.log");
const LAUNCH_AGENT_PATH = join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);

export const EXIT_OK = 0;
export const EXIT_RESTART_REQUIRED = 2;
export const EXIT_LAUNCH_REQUIRED = 3;
export const EXIT_AMBIGUOUS_PROCESS = 4;

export type CodexInstallation = {
  appPath: string;
  bundleId: string;
  version: string;
  executablePath: string;
};

export type MainProcess = {
  pid: number;
  command: string;
  installation: CodexInstallation;
};

export type CodexStatus = {
  installation: CodexInstallation;
  main: MainProcess | null;
  mainCount: number;
  port: number | null;
};

function run(command: string, args: string[], allowFailure = false): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error((result.stderr || result.stdout || `${command} exited ${result.status}`).trim());
  }
  return result.stdout.trim();
}

function plistValue(path: string, key: string): string {
  return run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path]);
}

export async function discoverCodexInstallation(appPath = "/Applications/ChatGPT.app"): Promise<CodexInstallation> {
  const resolved = resolve(process.env.CODEX_MICRO_PLUS_APP_PATH ?? appPath);
  const info = join(resolved, "Contents", "Info.plist");
  const bundleId = plistValue(info, "CFBundleIdentifier");
  if (bundleId !== CODEX_BUNDLE_ID) throw new Error(`Unexpected Codex bundle identifier: ${bundleId}`);
  const executable = plistValue(info, "CFBundleExecutable");
  const executablePath = join(resolved, "Contents", "MacOS", executable);
  if (!await stat(executablePath).then((value) => value.isFile()).catch(() => false)) {
    throw new Error(`Codex executable is missing: ${executablePath}`);
  }
  return {
    appPath: resolved,
    bundleId,
    version: plistValue(info, "CFBundleShortVersionString"),
    executablePath
  };
}

type ProcessRow = { pid: number; ppid: number; command: string };

function processRows(): ProcessRow[] {
  return run("/bin/ps", ["-axo", "pid=,ppid=,command="]).split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }] : [];
  });
}

export function selectMainProcessRows(rows: ProcessRow[], executablePath: string): ProcessRow[] {
  return rows
    .filter((candidate) => candidate.command === executablePath || candidate.command.startsWith(`${executablePath} `))
    // Prefer the ordinary launchd-owned process when more than one exact
    // executable is present, but do not reject a terminal-launched Codex.
    .sort((left, right) => Number(right.ppid === 1) - Number(left.ppid === 1) || left.pid - right.pid);
}

export function findMainProcesses(installation: CodexInstallation): MainProcess[] {
  return selectMainProcessRows(processRows(), installation.executablePath)
    .map((row) => ({ pid: row.pid, command: row.command, installation }));
}

export function findMainProcess(installation: CodexInstallation): MainProcess | null {
  return findMainProcesses(installation)[0] ?? null;
}

export function parseDebugPort(command: string): number | null {
  const value = Number(command.match(/(?:^|\s)--remote-debugging-port(?:=|\s+)(\d+)(?:\s|$)/)?.[1]);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : null;
}

function hasLoopbackAddress(command: string): boolean {
  return /(?:^|\s)--remote-debugging-address(?:=|\s+)127\.0\.0\.1(?:\s|$)/.test(command);
}

export async function healthyPort(
  main: MainProcess | null,
  ownsListener = processOwnsListener,
): Promise<number | null> {
  if (!main || !hasLoopbackAddress(main.command)) return null;
  const port = parseDebugPort(main.command);
  if (!port) return null;
  try {
    if (!await ownsListener({ pid: main.pid, port })) return null;
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return null;
    const targets = await response.json() as DebugTarget[];
    return enumerateCodexMainTargets(targets).length > 0 ? port : null;
  } catch { return null; }
}

export async function chooseLoopbackPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

export function buildCodexLaunchSpec(installation: Pick<CodexInstallation, "appPath">, port: number): { command: string; args: string[] } {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid debugging port: ${port}`);
  return {
    command: "/usr/bin/open",
    args: ["-n", "-a", installation.appPath, "--args", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`]
  };
}

/**
 * Validate and create launcher directories component by component. Recursive
 * mkdir follows an existing symlink in an ancestor, so a state write could be
 * redirected outside the intended directory.
 */
export async function ensureSafeDirectoryPath(path: string, mode = 0o700): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (!isMissing(error)) throw error;
      try {
        await mkdir(current, { recursive: false, mode });
      } catch (mkdirError) {
        if (!isAlreadyExists(mkdirError)) throw mkdirError;
      }
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error("E_CODEX_KEYS_PATH_UNSAFE");
    }
    if (!metadata.isDirectory()) {
      throw new Error("E_CODEX_KEYS_PATH_UNSAFE");
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function atomicWrite(path: string, contents: string, mode = 0o600): Promise<void> {
  const parent = dirname(path);
  await ensureSafeDirectoryPath(parent);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

/**
 * Install a runtime without ever opening the destination through a final
 * symlink. A direct `copyFile(source, destination)` follows that symlink and
 * can write outside the private state directory. The temporary file is
 * created exclusively with O_NOFOLLOW, then renamed into place so the final
 * replacement is atomic and replaces a pre-existing symlink itself.
 */
export async function safeInstallRuntime(source: string, destination: string, mode = 0o700): Promise<void> {
  const parent = dirname(destination);
  await ensureSafeDirectoryPath(parent);
  const contents = await readFile(source);
  const temporary = join(parent, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  let installed = false;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    await handle.writeFile(contents);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;

    // rename replaces a final symlink rather than following it. The parent
    // was checked above and the unique temporary was opened with O_EXCL.
    await rename(temporary, destination);
    installed = true;
    const metadata = await lstat(destination);
    if (!metadata.isFile()) throw new Error("E_CODEX_KEYS_RUNTIME_PATH_UNSAFE");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (!installed) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeBridgeState(port: number, installation: CodexInstallation): Promise<void> {
  await atomicWrite(BRIDGE_STATE_PATH, `${JSON.stringify({
    port,
    platform: "darwin",
    codexVersion: installation.version,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`);
}

async function enableBridge(installation: CodexInstallation, port: number): Promise<unknown> {
  const override = await applyRuntimeOverride(port, 30_000);
  const verification = await verifyMicroRuntime(port, 30_000, override.targetId);
  await writeBridgeState(port, installation);
  return verification;
}

async function launchCodex(installation: CodexInstallation, port: number): Promise<void> {
  const spec = buildCodexLaunchSpec(installation, port);
  const child = spawn(spec.command, spec.args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function terminateCodex(main: MainProcess): Promise<void> {
  process.kill(main.pid, "SIGTERM");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { process.kill(main.pid, 0); }
    catch { return; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Codex process ${main.pid} did not exit; it was not force-killed.`);
}

export async function inspectStatus(): Promise<CodexStatus> {
  const installation = await discoverCodexInstallation();
  const mains = findMainProcesses(installation);
  for (const main of mains) {
    const port = await healthyPort(main);
    if (port) return { installation, main, mainCount: mains.length, port };
  }
  return { installation, main: mains[0] ?? null, mainCount: mains.length, port: null };
}

function printStatus(current: CodexStatus): void {
  console.log(`Codex app: ${current.installation.appPath}`);
  console.log(`Codex version: ${current.installation.version}`);
  console.log(`Main process: ${current.main?.pid ?? "not running"}`);
  console.log(`Main process count: ${current.mainCount}`);
  console.log(`Reusable loopback bridge: ${current.port ?? "none"}`);
  console.log("Codex was not changed.");
}

async function status(): Promise<void> {
  const current = await inspectStatus();
  printStatus(current);
}

export function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/CDP|renderer|Codex[- ]Runtime|Micro.*(?:bridge|runtime|event|slot)|debug(?:ging)? endpoint|VS Code event bus|Statsig|persisted signal/i.test(message)) {
    return "cdp-unavailable";
  }
  if (/did not exit|SIGTERM|process .* exit/i.test(message)) return "codex-process-did-not-exit";
  if (/bundle identifier|executable is missing|ChatGPT\.app/i.test(message)) return "codex-installation-invalid";
  if (/Node\.js 20|runtime is missing/i.test(message)) return "runtime-unavailable";
  if (/Invalid debugging port|Usage:/i.test(message)) return "invalid-launch-argument";
  return "operation-failed";
}

export function safeErrorMessage(error: unknown): string {
  switch (safeErrorCode(error)) {
    case "cdp-unavailable": return "Codex Micro bridge is unavailable or incompatible.";
    case "codex-process-did-not-exit": return "Codex did not exit within the safe timeout; no force-kill was attempted.";
    case "codex-installation-invalid": return "The configured Codex installation could not be verified.";
    case "runtime-unavailable": return "A supported Node.js runtime was not found.";
    case "invalid-launch-argument": return "The launcher arguments are invalid.";
    default: return "Codex Keys could not complete the requested operation.";
  }
}

async function dryRun(): Promise<number> {
  const current = await inspectStatus();
  printStatus(current);
  if (current.main && !current.port) {
    if (current.mainCount > 1) {
      console.log("Dry-run result: ambiguous-processes (exit 4); no restart or launch would be attempted.");
      return EXIT_AMBIGUOUS_PROCESS;
    }
    console.log("Dry-run result: restart-required (exit 2); no restart was performed.");
    return EXIT_RESTART_REQUIRED;
  }
  if (!current.main) {
    console.log("Dry-run result: launch-required (exit 3); no launch was performed.");
    return EXIT_LAUNCH_REQUIRED;
  }
  console.log("Dry-run result: ready (exit 0); the current loopback bridge would be reused.");
  return EXIT_OK;
}

async function start(allowRestart: boolean): Promise<number> {
  let { installation, main, mainCount, port } = await inspectStatus();
  if (main && !port && !allowRestart) {
    console.error("Codex is running without a reusable loopback bridge.");
    console.error("Codex was left unchanged. Save composer text, then explicitly run `start --restart`.");
    return EXIT_RESTART_REQUIRED;
  }
  if (main && !port && mainCount > 1) {
    console.error("Multiple Codex main processes were detected without a reusable bridge.");
    console.error("Codex was left unchanged to avoid terminating one process and launching a duplicate.");
    return EXIT_AMBIGUOUS_PROCESS;
  }
  if (main && !port) {
    await terminateCodex(main);
    installation = await discoverCodexInstallation();
    main = null;
  }
  if (!main) {
    port = await chooseLoopbackPort();
    await launchCodex(installation, port);
  }
  assert.ok(port);
  const verification = await enableBridge(installation, port);
  console.log(`Codex Keys ready on 127.0.0.1:${port}.`);
  console.log(JSON.stringify(verification, null, 2));
  return 0;
}

async function watch(): Promise<number> {
  console.log("Observer started. It never launches, stops, or restarts Codex.");
  let lastPort: number | null = null;
  let lastTargetSet: string | null = null;
  while (true) {
    try {
      const current = await inspectStatus();
      const targetSet = current.port ? await fetchRuntimeTargetSetSignature(current.port) : null;
      if (current.port && (current.port !== lastPort || targetSet !== lastTargetSet)) {
        await enableBridge(current.installation, current.port);
        await atomicWrite(WATCHER_LOG_PATH, `${new Date().toISOString()} observed bridge ${current.port}\n`);
      }
      lastPort = current.port;
      lastTargetSet = targetSet;
    } catch (error) {
      await atomicWrite(WATCHER_LOG_PATH, `${new Date().toISOString()} observer error: ${safeErrorCode(error)}\n`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
}

export function buildWatcherLaunchScript(runtimePath = INSTALLED_RUNTIME_PATH): string {
  const quoted = `'${runtimePath.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/zsh\nset -u\nfor node_candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node(N) /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node; do\n  [[ -x "$node_candidate" ]] || continue\n  node_version=$("$node_candidate" --version 2>/dev/null) || continue\n  node_major=\${node_version#v}\n  node_major=\${node_major%%.*}\n  [[ "$node_major" == <-> && "$node_major" -ge 20 ]] || continue\n  exec "$node_candidate" ${quoted} watch\ndone\nprint -u2 "Node.js 20 or newer was not found."\nexit 78\n`;
}

export function buildLaunchAgentPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${AGENT_LABEL}</string>\n<key>ProgramArguments</key><array><string>/bin/zsh</string><string>${WATCHER_LAUNCHER_PATH}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>/dev/null</string>\n<key>StandardErrorPath</key><string>${WATCHER_STDERR_PATH}</string>\n</dict></plist>\n`;
}

async function install(): Promise<void> {
  const source = resolve(process.argv[1]!);
  await ensureSafeDirectoryPath(STATE_ROOT, 0o700);
  await ensureSafeDirectoryPath(dirname(LAUNCH_AGENT_PATH), 0o777);
  await safeInstallRuntime(source, INSTALLED_RUNTIME_PATH);
  await atomicWrite(WATCHER_LAUNCHER_PATH, buildWatcherLaunchScript(), 0o700);
  await atomicWrite(LAUNCH_AGENT_PATH, buildLaunchAgentPlist(), 0o644);
  run("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, LAUNCH_AGENT_PATH], true);
  run("/bin/launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, LAUNCH_AGENT_PATH]);
  console.log("Observer installed. It will only attach to Codex sessions that already expose a loopback CDP port.");
}

async function uninstall(): Promise<void> {
  run("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, LAUNCH_AGENT_PATH], true);
  for (const path of [LAUNCH_AGENT_PATH, INSTALLED_RUNTIME_PATH, WATCHER_LAUNCHER_PATH, WATCHER_LOG_PATH, WATCHER_STDERR_PATH, BRIDGE_STATE_PATH]) {
    await rm(path, { force: true });
  }
  console.log("Codex Keys observer removed. Codex and its application bundle were unchanged.");
}

async function selfTest(): Promise<void> {
  const port = await chooseLoopbackPort();
  assert.ok(port > 0 && port <= 65_535);
  const spec = buildCodexLaunchSpec({ appPath: "/Applications/ChatGPT.app" }, port);
  assert.deepEqual(spec.args.slice(-2), ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`]);
  assert.equal(parseDebugPort(spec.args.join(" ")), port);
  assert.doesNotMatch(spec.args.join(" "), /0\.0\.0\.0/);
  assert.match(buildWatcherLaunchScript(), / watch/);
  assert.match(buildWatcherLaunchScript(), /--version/);
  assert.match(buildWatcherLaunchScript(), /-ge 20/);
  assert.doesNotMatch(buildWatcherLaunchScript(), /--restart/);
  const executablePath = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT";
  const rows = selectMainProcessRows([
    { pid: 900, ppid: 333, command: executablePath },
    { pid: 901, ppid: 1, command: `${executablePath} --remote-debugging-port=4567` },
    { pid: 902, ppid: 444, command: "/Applications/ChatGPT.app/Contents/MacOS/Helper" }
  ], executablePath);
  assert.deepEqual(rows.map((row) => row.pid), [901, 900]);
  const bodyError = new Error("CDP renderer exception: user secret and prompt text");
  assert.equal(safeErrorCode(bodyError), "cdp-unavailable");
  assert.doesNotMatch(safeErrorMessage(bodyError), /user secret|prompt text/);
  console.log("Self-test passed: random loopback port, launch spec, and observe-only watcher policy.");
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "status";
  if (command === "status") { await status(); return 0; }
  if (command === "dry-run") return await dryRun();
  if (command === "self-test") { await selfTest(); return 0; }
  if (command === "start") return await start(process.argv.includes("--restart"));
  if (command === "watch") return await watch();
  if (command === "install") { await install(); return 0; }
  if (command === "uninstall") { await uninstall(); return 0; }
  if (command === "print-launch-agent") { process.stdout.write(buildLaunchAgentPlist()); return 0; }
  throw new Error("Usage: start-microplus.sh [status|dry-run|self-test|start [--restart]|watch|install|uninstall|print-launch-agent]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`Codex Keys: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
