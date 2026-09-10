import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codexDeckStateRoot } from "./codex-deck-paths.js";
import type { RateLimitResetOutcome } from "./types.js";

export type PersistedResetAttempt = {
  version: 1;
  redeemRequestId: string;
  creditId?: string;
  outcome?: RateLimitResetOutcome;
};

const RESET_STATE_PATH = join(codexDeckStateRoot(), "rate-limit-reset-attempt.json");

export async function readResetAttempt(path = RESET_STATE_PATH): Promise<PersistedResetAttempt | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as PersistedResetAttempt;
    if (value?.version !== 1 || !validRequestId(value.redeemRequestId)) throw stateError();
    if (value.creditId != null && !validCreditId(value.creditId)) throw stateError();
    if ("outcome" in value && (
      !value.outcome || typeof value.outcome !== "object" ||
      value.outcome.redeemRequestId !== value.redeemRequestId ||
      !["reset", "already_redeemed"].includes(value.outcome.code) ||
      !["updated", "failed", "unavailable"].includes(value.outcome.refresh)
    )) throw stateError();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    if (error instanceof Error && error.message === "E_RESET_STATE_INVALID") throw error;
    throw stateError();
  }
}

export async function writeResetAttempt(value: PersistedResetAttempt, path = RESET_STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function validCreditId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,240}$/.test(value);
}

function stateError(): Error {
  const error = new Error("E_RESET_STATE_INVALID");
  error.name = "E_RESET_STATE_INVALID";
  return error;
}
import { randomUUID } from "node:crypto";
