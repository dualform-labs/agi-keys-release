import { spawn } from "node:child_process";

const FOCUS_EXECUTABLE = "/usr/bin/open";
const FOCUS_ARGS = ["-b", "com.openai.codex"] as const;
const FOCUS_TIMEOUT_MS = 4_000;

type FocusChild = {
  once(event: "error", listener: () => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
};

export type FocusSpawn = (
  executable: string,
  args: readonly string[],
  options: { shell: false; stdio: "ignore"; windowsHide: true },
) => FocusChild;

export type CodexFocusDependencies = {
  spawn: FocusSpawn;
  timeoutMs: number;
};

function focusError(): Error {
  const error = new Error("E_FOCUS_FAILED");
  error.name = "E_FOCUS_FAILED";
  return error;
}

/** Bring the installed Codex app to the foreground without invoking a shell. */
export function focusCodexApp(
  dependencies: Partial<CodexFocusDependencies> = {},
): Promise<void> {
  const spawnProcess: FocusSpawn = dependencies.spawn ?? ((executable, args, options) =>
    spawn(executable, [...args], options));
  const timeoutMs = dependencies.timeoutMs ?? FOCUS_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let child: FocusChild;
    try {
      child = spawnProcess(FOCUS_EXECUTABLE, FOCUS_ARGS, {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      reject(focusError());
      return;
    }

    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      finish(focusError());
    }, Math.max(1, timeoutMs));

    child.once("error", () => finish(focusError()));
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) finish();
      else finish(focusError());
    });
  });
}
