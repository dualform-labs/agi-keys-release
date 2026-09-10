import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { MissingMicroLauncherError } from "./bridge-error.js";
import { codexDeckStateRoot } from "./codex-deck-paths.js";

const execFileAsync = promisify(execFile);
const PORT_FILE = join(codexDeckStateRoot(), "codex-micro-bridge.json");
const CODEX_BUNDLE_ID = "com.openai.codex";
const CODEX_RENDERER_HOSTS = new Set(["-", "codex"]);
const CODEX_AUXILIARY_ROUTES = new Set([
  "/avatar-overlay",
  "/global-dictation",
  "/hotkey-window",
]);
const DEFAULT_CODEX_APP = "/Applications/ChatGPT.app";

export type DebugTarget = {
  id?: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type RendererFocusState = {
  hasFocus: boolean;
  visibilityState: string;
};

export const FOREGROUND_RENDERER_PROBE_EXPRESSION =
  "({hasFocus:document.hasFocus(),visibilityState:document.visibilityState})";

export function enumerateCodexMainTargets(targets: DebugTarget[]): DebugTarget[] {
  return targets.filter((target) => {
    if (target.type !== "page" || !target.webSocketDebuggerUrl) return false;
    try {
      const url = new URL(target.url);
      return url.protocol === "app:"
        && CODEX_RENDERER_HOSTS.has(url.host)
        && url.username === ""
        && url.password === ""
        && url.pathname === "/index.html"
        && !CODEX_AUXILIARY_ROUTES.has(url.searchParams.get("initialRoute") ?? "");
    } catch {
      return false;
    }
  });
}

export async function resolveForegroundCodexTarget(
  targets: DebugTarget[],
  probe: (target: DebugTarget) => Promise<RendererFocusState | undefined>
): Promise<DebugTarget | undefined> {
  const candidates = enumerateCodexMainTargets(targets);
  const states = await Promise.all(candidates.map(async (target) => {
    try {
      return await probe(target);
    } catch {
      return undefined;
    }
  }));
  const foreground = candidates.filter((_, index) => {
    const state = states[index];
    return state?.hasFocus === true && state.visibilityState === "visible";
  });
  return foreground.length === 1 ? foreground[0] : undefined;
}

export function selectCodexMainTarget(targets: DebugTarget[]): DebugTarget | undefined {
  const candidates = enumerateCodexMainTargets(targets);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function codexDebugTargetKey(target: DebugTarget): string {
  return createHash("sha256")
    .update(`${target.id ?? ""}\u0000${target.webSocketDebuggerUrl ?? ""}`)
    .digest("hex");
}

export function selectCodexObservationTarget(
  targets: DebugTarget[],
  foreground: DebugTarget | undefined,
  lastTargetKey = "",
): DebugTarget | undefined {
  const candidates = enumerateCodexMainTargets(targets);
  if (foreground && candidates.includes(foreground)) return foreground;
  if (lastTargetKey) {
    const sticky = candidates.find((candidate) => codexDebugTargetKey(candidate) === lastTargetKey);
    if (sticky) return sticky;
  }
  if (candidates.length === 1) return candidates[0];
  const sessionCandidates = candidates.filter((candidate) => {
    const initialRoute = new URL(candidate.url).searchParams.get("initialRoute") ?? "";
    return /^\/(?:local|cloud)\/[A-Za-z0-9_-]{8,128}$/u.test(initialRoute);
  });
  if (sessionCandidates.length === 1) return sessionCandidates[0];
  if (sessionCandidates.length > 1) {
    const routes = new Set(sessionCandidates.map((candidate) =>
      new URL(candidate.url).searchParams.get("initialRoute") ?? ""
    ));
    if (routes.size === 1) {
      return [...sessionCandidates].sort((left, right) =>
        codexDebugTargetKey(left).localeCompare(codexDebugTargetKey(right))
      )[0];
    }
  }
  return undefined;
}

export async function discoverDebugPort(): Promise<number> {
  const fromFile = await readPortFile();
  if (process.platform === "darwin") {
    const executablePath = await discoverCodexExecutable();
    const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], { timeout: 4000 });
    const port = await resolveMacCodexDebugPort({
      psOutput: stdout,
      executablePath,
      statePort: fromFile,
      ownsListener: processOwnsListener,
      isCodexEndpoint: (candidate) => isCodexDebugPort(candidate.port)
    });
    if (port) return port;
    throw new MissingMicroLauncherError();
  }
  if (process.platform !== "win32") throw new Error("Die native Codex-Micro-Brücke wird auf dieser Plattform nicht unterstützt.");

  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$processes = @(Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe'\")",
    "$listeners = @(Get-NetTCPConnection -State Listen)",
    "foreach ($process in $processes) {",
    "  $portMatch = [regex]::Match([string]$process.CommandLine, '(?:^|\\s)--remote-debugging-port(?:=|\\s+)(\\d+)(?:\\s|$)')",
    "  if (-not $portMatch.Success -or [string]$process.CommandLine -notmatch '(?:^|\\s)--remote-debugging-address(?:=|\\s+)127\\.0\\.0\\.1(?:\\s|$)') { continue }",
    "  $port = [int]$portMatch.Groups[1].Value",
    "  foreach ($listener in $listeners | Where-Object { $_.LocalPort -eq $port }) {",
    "    '{0}|{1}|{2}|{3}|{4}' -f $process.ProcessId, $port, $listener.OwningProcess, $listener.LocalAddress, $listener.State",
    "  }",
    "}",
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 4000 });
    const port = await resolveWindowsCodexDebugPort({
      attestationOutput: stdout,
      statePort: fromFile,
      isCodexEndpoint: (candidate) => isCodexDebugPort(candidate.port),
    });
    if (port) return port;
  } catch {
    // Missing process/socket inspection support is an unavailable attestation, not permission to trust state.
  }
  throw new Error("Codex wurde nicht über den Micro-Aktivierungsstarter geöffnet.");
}

async function readPortFile(): Promise<number | null> {
  try {
    const data = JSON.parse(await readFile(PORT_FILE, "utf8")) as { port?: unknown };
    const port = Number(data.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch { return null; }
}

export type CodexDebugProcess = { pid: number; port: number };

export function parseWindowsCodexDebugProcesses(stdout: string): CodexDebugProcess[] {
  return stdout.split("\n").flatMap((line) => {
    const fields = line.trim().split("|");
    if (fields.length !== 5) return [];
    const [rawPid, rawPort, rawOwnerPid, localAddress, state] = fields;
    const pid = Number(rawPid);
    const port = Number(rawPort);
    const ownerPid = Number(rawOwnerPid);
    return Number.isInteger(pid)
      && pid > 0
      && Number.isInteger(port)
      && port > 0
      && port <= 65_535
      && ownerPid === pid
      && localAddress === "127.0.0.1"
      && state === "Listen"
      ? [{ pid, port }]
      : [];
  });
}

export async function resolveWindowsCodexDebugPort(options: {
  attestationOutput: string;
  statePort: number | null;
  isCodexEndpoint: (candidate: CodexDebugProcess) => Promise<boolean>;
}): Promise<number | null> {
  const candidates = parseWindowsCodexDebugProcesses(options.attestationOutput);
  const ordered = options.statePort == null
    ? candidates
    : [...candidates].sort((left, right) => Number(right.port === options.statePort) - Number(left.port === options.statePort));
  for (const candidate of ordered) {
    if (await options.isCodexEndpoint(candidate)) return candidate.port;
  }
  return null;
}

export function parseCodexDebugProcesses(stdout: string, executablePath: string): CodexDebugProcess[] {
  return stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) return [];
    const command = match[2]!;
    if (command !== executablePath && !command.startsWith(`${executablePath} `)) return [];
    if (!/(?:^|\s)--remote-debugging-address(?:=|\s+)127\.0\.0\.1(?:\s|$)/.test(command)) return [];
    const port = Number.parseInt(command.match(/(?:^|\s)--remote-debugging-port(?:=|\s+)(\d+)(?:\s|$)/)?.[1] ?? "", 10);
    return Number.isInteger(port) && port > 0 && port <= 65_535
      ? [{ pid: Number(match[1]), port }]
      : [];
  });
}

export function listenerBelongsToProcess(stdout: string, pid: number, port: number): boolean {
  let currentPid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      currentPid = Number.isInteger(parsed) ? parsed : null;
      continue;
    }
    if (currentPid === pid && line === `n127.0.0.1:${port}`) return true;
  }
  return false;
}

export async function resolveMacCodexDebugPort(options: {
  psOutput: string;
  executablePath: string;
  statePort: number | null;
  ownsListener: (candidate: CodexDebugProcess) => Promise<boolean>;
  isCodexEndpoint: (candidate: CodexDebugProcess) => Promise<boolean>;
}): Promise<number | null> {
  const candidates = parseCodexDebugProcesses(options.psOutput, options.executablePath);
  const ordered = options.statePort == null
    ? candidates
    : [...candidates].sort((left, right) => Number(right.port === options.statePort) - Number(left.port === options.statePort));
  for (const candidate of ordered) {
    if (!await options.ownsListener(candidate)) continue;
    if (await options.isCodexEndpoint(candidate)) return candidate.port;
  }
  return null;
}

async function discoverCodexExecutable(): Promise<string> {
  const appPath = resolve(process.env.CODEX_MICRO_PLUS_APP_PATH ?? DEFAULT_CODEX_APP);
  const infoPath = join(appPath, "Contents", "Info.plist");
  const [{ stdout: bundleId }, { stdout: executable }] = await Promise.all([
    execFileAsync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPath], { timeout: 4000 }),
    execFileAsync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", infoPath], { timeout: 4000 })
  ]);
  if (bundleId.trim() !== CODEX_BUNDLE_ID) throw new MissingMicroLauncherError();
  return join(appPath, "Contents", "MacOS", executable.trim());
}

export async function processOwnsListener(candidate: CodexDebugProcess): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/lsof", [
      "-nP", "-a", "-p", String(candidate.pid), `-iTCP:${candidate.port}`, "-sTCP:LISTEN", "-Fn"
    ], { timeout: 4000 });
    return listenerBelongsToProcess(stdout, candidate.pid, candidate.port);
  } catch { return false; }
}

async function isCodexDebugPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return false;
    return enumerateCodexMainTargets(await response.json() as DebugTarget[]).length > 0;
  } catch { return false; }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`Codex-Debug-Endpunkt antwortete mit ${response.status}.`);
  return await response.json() as T;
}
