import { spawn } from "node:child_process";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CodexOpenSpec = { executable: string; args: string[]; windowsHide: boolean };

export function codexThreadUrl(threadId: string): string {
  if (threadId !== "new" && !THREAD_ID.test(threadId)) throw new Error(`Invalid Codex task ID: ${threadId}`);
  return `codex://threads/${threadId}`;
}

export function codexOpenSpec(
  threadId: string
): CodexOpenSpec {
  const url = codexThreadUrl(threadId);
  return { executable: "/usr/bin/open", args: [url], windowsHide: false };
}

export function openCodexThread(threadId: string): Promise<void> {
  const spec = codexOpenSpec(threadId);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, { windowsHide: spec.windowsHide, stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (data) => { errorOutput += String(data); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Codex link could not be opened (${code ?? "unknown"}): ${errorOutput.trim()}`));
    });
  });
}
