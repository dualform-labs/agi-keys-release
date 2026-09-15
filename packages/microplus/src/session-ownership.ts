import { constants } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";
import type { HostSessionPresence, MicroSnapshot } from "./types.js";

const SESSION_FILENAME = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const THREAD_KEY = /(?:^|:)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const COMPLETION_FRESHNESS_MS = 5 * 60_000;
// Node exposes O_NOFOLLOW on macOS. If a host ever omits it, rollout reads
// fail closed instead of silently falling back to a symlink-following open.
const ROLLOUT_READ_FLAGS = typeof constants.O_NOFOLLOW === "number"
  ? constants.O_RDONLY | constants.O_NOFOLLOW
  : undefined;
// Directory handles are used to attest that each traversal root is the
// directory we checked, rather than a symlink that changed underneath it.
// If the platform does not provide the no-follow/ directory flags, discovery
// fails closed instead of silently falling back to recursive path walking.
const DIRECTORY_OPEN_FLAGS = typeof constants.O_NOFOLLOW === "number" && typeof constants.O_DIRECTORY === "number"
  ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY
  : undefined;

/** Content-free context usage for the task currently open in the native renderer. */
export type ActiveThreadContextUsage = {
  threadKey: string;
  sessionId: string;
  contextUsedPercent: number;
  /** Byte offset of the latest valid token-count record in the local rollout. */
  contextRevision: number;
};

type SessionStatusReading = Pick<HostSessionPresence, "status" | "completionRevision" | "contextUsedPercent"> & {
  activityAt?: number;
  /** Kept local until the shared snapshot contract adopts this field. */
  contextRevision?: number;
};

type ContextUsage = Pick<ActiveThreadContextUsage, "contextUsedPercent" | "contextRevision">;

type RolloutFile = {
  threadId: string;
  path: string;
  metadata: Stats;
};

export class CodexSessionOwnershipIndex {
  private sessionIds = new Set<string>();
  private recentSessions: HostSessionPresence[] = [];
  private contextUsageBySession = new Map<string, ContextUsage>();
  private acknowledgedCompletions = new Map<string, number>();
  private contextAttemptedSessions = new Set<string>();
  private refreshedAt = 0;
  private refreshInFlight: Promise<void> | undefined;

  constructor(
    private readonly roots = defaultSessionRoots(),
    private readonly refreshIntervalMs = 5_000
  ) {}

  async annotate(snapshot: MicroSnapshot, now = Date.now()): Promise<MicroSnapshot> {
    const trackedSessions = new Set(snapshot.slots
      .map((slot) => sessionIdFromThreadKey(slot.threadKey))
      .filter((sessionId): sessionId is string => sessionId != null));
    const activeSessionId = sessionIdFromThreadKey(snapshot.activeThreadKey ?? null);
    if (activeSessionId) trackedSessions.add(activeSessionId);
    await this.refreshIfNeeded(now, trackedSessions);
    const selectedSessions = new Set(snapshot.slots
      .filter((slot) => slot.selected)
      .map((slot) => sessionIdFromThreadKey(slot.threadKey))
      .filter((sessionId): sessionId is string => sessionId != null));
    if (activeSessionId) selectedSessions.add(activeSessionId);
    for (const session of this.recentSessions) {
      if (session.status === "complete" && session.completionRevision != null && selectedSessions.has(session.threadId)) {
        this.acknowledgedCompletions.set(session.threadId, session.completionRevision);
      }
    }
    const visibleSessions = new Map(this.recentSessions.map((session) => {
      const completionIsAcknowledged = session.status === "complete" && session.completionRevision != null &&
        this.acknowledgedCompletions.get(session.threadId) === session.completionRevision;
      const completionIsStale = session.status === "complete" && now - session.activityAt > COMPLETION_FRESHNESS_MS;
      return [session.threadId, {
        ...session,
        status: completionIsAcknowledged || completionIsStale ? "idle" as const : session.status
      }];
    }));
    return {
      ...snapshot,
      hostSessions: [...visibleSessions.values()],
      slots: snapshot.slots.map((slot) => {
        const sessionId = sessionIdFromThreadKey(slot.threadKey);
        const session = sessionId ? visibleSessions.get(sessionId) : undefined;
        const ownedByHost = sessionId != null && this.sessionIds.has(sessionId);
        return {
          ...slot,
          ownedByHost,
          status: slot.threadKey == null
            ? slot.status
            : ownedByHost && session ? reconcileOwnedStatus(slot.status, session.status) : "unknown",
          ...(session?.contextUsedPercent != null
            ? { contextUsedPercent: session.contextUsedPercent }
            : {})
        };
      })
    };
  }

  /**
   * Return the content-free context source for the active task after annotate().
   * The active key must resolve to a rollout found in the local session roots.
   */
  getActiveThreadContextUsage(snapshot: Pick<MicroSnapshot, "activeThreadKey">): ActiveThreadContextUsage | null {
    const threadKey = snapshot.activeThreadKey;
    const sessionId = sessionIdFromThreadKey(threadKey ?? null);
    if (!threadKey || !sessionId || !this.sessionIds.has(sessionId)) return null;
    const usage = this.contextUsageBySession.get(sessionId);
    return usage ? { threadKey, sessionId, ...usage } : null;
  }

  /** Force one fresh, content-free rollout read after a native compaction request. */
  async refreshActiveThreadContextUsage(
    snapshot: Pick<MicroSnapshot, "activeThreadKey">,
    now = Date.now(),
  ): Promise<ActiveThreadContextUsage | null> {
    const sessionId = sessionIdFromThreadKey(snapshot.activeThreadKey ?? null);
    if (!sessionId) return null;
    this.contextAttemptedSessions.delete(sessionId);
    await this.refreshIfNeeded(now, new Set([sessionId]));
    return this.getActiveThreadContextUsage(snapshot);
  }

  markOpened(threadKey: string, _now = Date.now()): void {
    const sessionId = sessionIdFromThreadKey(threadKey);
    if (!sessionId) return;
    const session = this.recentSessions.find((candidate) => candidate.threadId === sessionId);
    if (session?.status === "complete" && session.completionRevision != null) {
      this.acknowledgedCompletions.set(sessionId, session.completionRevision);
    }
  }

  private async refreshIfNeeded(now: number, trackedSessions: Set<string>): Promise<void> {
    const needsContext = [...trackedSessions].some((sessionId) => !this.contextAttemptedSessions.has(sessionId));
    if (!needsContext && now - this.refreshedAt < this.refreshIntervalMs) return;
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      if ([...trackedSessions].some((sessionId) => !this.contextAttemptedSessions.has(sessionId))) {
        await this.refreshIfNeeded(now, trackedSessions);
      }
      return;
    }
    const pending = this.refresh(now, trackedSessions);
    this.refreshInFlight = pending;
    try { await pending; }
    finally { if (this.refreshInFlight === pending) this.refreshInFlight = undefined; }
  }

  private async refresh(now: number, trackedSessions: Set<string>): Promise<void> {
    const retainContextAttempts = now - this.refreshedAt < this.refreshIntervalMs;
    const discoveredFiles: Array<{ threadId: string; path: string }> = [];
    for (const root of this.roots) {
      discoveredFiles.push(...await discoverRolloutFiles(root));
    }
    const sessionFiles: RolloutFile[] = [];
    for (let index = 0; index < discoveredFiles.length; index += 32) {
      const batch = discoveredFiles.slice(index, index + 32);
      const resolved = await Promise.all(batch.map((file) => probeRolloutFile(file)));
      sessionFiles.push(...resolved.filter((value): value is RolloutFile => value != null));
    }
    const files = sessionFiles.map(({ threadId, path, metadata }) => ({
      threadId,
      path,
      metadata,
      activityAt: metadata.mtimeMs
    }));
    const uniqueRecent = new Map<string, typeof files[number]>();
    for (const file of files.sort((left, right) => right.activityAt - left.activityAt)) {
      if (!uniqueRecent.has(file.threadId)) uniqueRecent.set(file.threadId, file);
    }
    const recent = [...uniqueRecent.values()].slice(0, 128);
    const included = new Set(recent.map((session) => session.threadId));
    for (const sessionId of trackedSessions) {
      const tracked = uniqueRecent.get(sessionId);
      if (tracked && !included.has(sessionId)) {
        recent.push(tracked);
        included.add(sessionId);
      }
    }
    const contextParsed = new Set<string>();
    const invalidSessionIds = new Set<string>();
    const parsedSessions = await Promise.all(recent.map(async ({ threadId, path, metadata, activityAt: fileActivityAt }) => {
      const shouldRead = now - fileActivityAt <= 15 * 60_000 || trackedSessions.has(threadId);
      const recentStatus = shouldRead
        ? await readRecentSessionStatus(path, metadata)
        : { status: "idle" as const };
      if (!recentStatus) {
        // The candidate changed or disappeared between discovery and read.
        // Do not retain ownership from a path that was not revalidated.
        invalidSessionIds.add(threadId);
        return null;
      }
      if (shouldRead) contextParsed.add(threadId);
      if (recentStatus.contextUsedPercent != null && recentStatus.contextRevision != null) {
        const previousRevision = this.contextUsageBySession.get(threadId)?.contextRevision;
        this.contextUsageBySession.set(threadId, {
          contextUsedPercent: recentStatus.contextUsedPercent,
          contextRevision: Math.max(previousRevision ?? 0, recentStatus.contextRevision)
        });
      }
      // A bounded tail read can temporarily omit the latest token_count event
      // while the same validated session keeps producing output. Retain the
      // last observed value until the session itself disappears; callers use
      // contextRevision to require a genuinely newer value after compaction.
      const { activityAt, contextRevision: _contextRevision, ...status } = recentStatus;
      return { threadId, activityAt: activityAt ?? fileActivityAt, ...status };
    }));
    this.sessionIds = new Set(sessionFiles
      .map(({ threadId }) => threadId)
      .filter((threadId) => !invalidSessionIds.has(threadId)));
    this.recentSessions = parsedSessions.filter((value): value is NonNullable<typeof value> => value != null);
    this.contextAttemptedSessions = new Set([
      ...(retainContextAttempts ? this.contextAttemptedSessions : []),
      ...contextParsed,
      ...trackedSessions
    ]);
    const currentIds = new Set(this.recentSessions.map((session) => session.threadId));
    for (const threadId of this.contextUsageBySession.keys()) {
      if (!currentIds.has(threadId)) this.contextUsageBySession.delete(threadId);
    }
    for (const threadId of this.acknowledgedCompletions.keys()) {
      if (!currentIds.has(threadId)) this.acknowledgedCompletions.delete(threadId);
    }
    this.refreshedAt = now;
  }
}

/**
 * Enumerate rollout files without allowing a session root or an ancestor to
 * redirect the search through a symlink. Node's recursive readdir API does
 * not expose enough information to establish that boundary, so traversal is
 * explicit and every directory is lstat'd and opened with O_NOFOLLOW.
 */
async function discoverRolloutFiles(root: string): Promise<Array<{ threadId: string; path: string }>> {
  const opened = await openTrustedDirectory(root);
  if (!opened) return [];
  const files: Array<{ threadId: string; path: string }> = [];
  try {
    await walkTrustedDirectory(root, opened, files, new Set<string>());
    return files;
  } finally {
    await closeQuietly(opened.handle);
  }
}

type OpenedDirectory = {
  handle: FileHandle;
  metadata: Stats;
};

async function openTrustedDirectory(path: string, expected?: Stats): Promise<OpenedDirectory | null> {
  if (DIRECTORY_OPEN_FLAGS == null) return null;
  const trusted = await trustedDirectoryMetadata(path);
  if (!trusted || (expected && !sameDirectory(expected, trusted))) return null;
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, DIRECTORY_OPEN_FLAGS);
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || !sameDirectory(trusted, metadata) || (expected && !sameDirectory(expected, metadata))) {
      await closeQuietly(handle);
      return null;
    }
    return { handle, metadata };
  } catch {
    if (handle) await closeQuietly(handle);
    // Missing, replaced, inaccessible, and unsupported roots are all
    // unowned from the plugin's perspective. Never fall back to a path read.
    return null;
  }
}

/**
 * Check every component, including the root itself. A final lstat alone is
 * insufficient: `/safe/link/sessions` can have a real final directory while
 * `link` redirects the entire session search elsewhere.
 */
async function trustedDirectoryMetadata(path: string): Promise<Stats | null> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  let metadata: Stats | undefined;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      metadata = await lstat(current);
    } catch {
      return null;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return null;
  }
  return metadata ?? null;
}

async function walkTrustedDirectory(
  path: string,
  opened: OpenedDirectory,
  files: Array<{ threadId: string; path: string }>,
  visited: Set<string>,
): Promise<void> {
  const identity = `${opened.metadata.dev}:${opened.metadata.ino}`;
  if (visited.has(identity)) return;
  visited.add(identity);

  const entries = await readTrustedDirectoryEntries(path, opened);
  if (!entries) return;
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    let metadata: Stats;
    try {
      metadata = await lstat(childPath);
    } catch {
      // A concurrent removal or replacement cannot establish ownership.
      continue;
    }
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) {
      const child = await openTrustedDirectory(childPath, metadata);
      if (!child) continue;
      try {
        await walkTrustedDirectory(childPath, child, files, visited);
      } finally {
        await closeQuietly(child.handle);
      }
      continue;
    }
    if (!metadata.isFile()) continue;
    const threadId = sessionIdFromRolloutFilename(entry.name);
    if (threadId) files.push({ threadId, path: childPath });
  }
}

/**
 * There is no FileHandle overload for fs.promises.readdir in Node 20/22.
 * Keep the directory FD open and compare its identity immediately before and
 * after the path read; a root/child replacement is rejected instead of being
 * accepted as a new session source.
 */
async function readTrustedDirectoryEntries(path: string, opened: OpenedDirectory) {
  try {
    const before = await lstat(path);
    if (!sameDirectory(before, opened.metadata)) return null;
    const entries = await readdir(path, { withFileTypes: true });
    const after = await lstat(path);
    return sameDirectory(after, opened.metadata) ? entries : null;
  } catch {
    return null;
  }
}

export function sessionIdFromRolloutFilename(filename: string): string | null {
  return filename.match(SESSION_FILENAME)?.[1]?.toLowerCase() ?? null;
}

export function sessionIdFromThreadKey(threadKey: string | null): string | null {
  return threadKey?.match(THREAD_KEY)?.[1]?.toLowerCase() ?? null;
}

function defaultSessionRoots(): string[] {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  return [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
}

async function probeRolloutFile(file: { threadId: string; path: string }): Promise<RolloutFile | null> {
  if (ROLLOUT_READ_FLAGS == null) return null;
  let expected: Stats;
  try {
    // lstat keeps a symlink from being treated as the rollout itself.
    expected = await lstat(file.path);
  } catch {
    return null;
  }
  if (!expected.isFile()) return null;

  const opened = await openValidatedRollout(file.path, expected);
  if (!opened) return null;
  try {
    return { ...file, metadata: opened.metadata };
  } finally {
    await closeQuietly(opened.handle);
  }
}

async function openValidatedRollout(path: string, expected?: Stats): Promise<{
  handle: FileHandle;
  metadata: Stats;
} | null> {
  if (ROLLOUT_READ_FLAGS == null) return null;
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, ROLLOUT_READ_FLAGS);
    const metadata = await handle.stat();
    if (!metadata.isFile() || (expected && !sameRolloutFile(expected, metadata))) {
      await closeQuietly(handle);
      return null;
    }
    return { handle, metadata };
  } catch {
    if (handle) await closeQuietly(handle);
    return null;
  }
}

function sameRolloutFile(expected: Stats, actual: Stats): boolean {
  return expected.isFile() && actual.isFile() && expected.dev === actual.dev && expected.ino === actual.ino;
}

function sameDirectory(expected: Stats, actual: Stats): boolean {
  return expected.isDirectory() && actual.isDirectory() && expected.dev === actual.dev && expected.ino === actual.ino;
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  await handle.close().catch(() => undefined);
}

async function readRecentSessionStatus(
  path: string,
  expected: Stats,
): Promise<SessionStatusReading | null> {
  const opened = await openValidatedRollout(path, expected);
  if (!opened) return null;
  const { handle, metadata: info } = opened;
  try {
      const length = Math.min(info.size, 512 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, info.size - length));
      const baseOffset = info.size - length;
      let lifecycle: "working" | "complete" | "idle" | undefined;
      let completionRevision: number | undefined;
      let activityAt: number | undefined;
      let contextUsage: ContextUsage | null = null;
      let lineStart = baseOffset === 0 ? 0 : buffer.indexOf(0x0a) + 1;
      while (lineStart < buffer.length) {
        const newline = buffer.indexOf(0x0a, lineStart);
        const lineEnd = newline < 0 ? buffer.length : newline;
        try {
          const event = JSON.parse(buffer.subarray(lineStart, lineEnd).toString("utf8")) as {
            type?: string;
            timestamp?: string;
            payload?: {
              type?: string;
              role?: string;
              channel?: string;
              phase?: string;
              info?: { last_token_usage?: { total_tokens?: unknown }; model_context_window?: unknown };
            };
          };
          const eventType = event.type === "event_msg" ? event.payload?.type : undefined;
          const responseType = event.type === "response_item" ? event.payload?.type : undefined;
          const eventTime = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
          if (eventType === "token_count") {
            const total = event.payload?.info?.last_token_usage?.total_tokens;
            const window = event.payload?.info?.model_context_window;
            if (typeof total === "number" && Number.isFinite(total) && total >= 0 &&
              typeof window === "number" && Number.isFinite(window) && window > 0) {
              contextUsage = {
                contextUsedPercent: Math.max(0, Math.min(100, Math.round(total / window * 100))),
                contextRevision: baseOffset + lineStart
              };
            }
          } else if (eventType === "task_started" || eventType === "agent_reasoning" || eventType === "function_call") {
            lifecycle = "working";
            if (Number.isFinite(eventTime)) activityAt = eventTime;
          } else if (eventType === "turn_aborted") {
            lifecycle = "idle";
            if (Number.isFinite(eventTime)) activityAt = eventTime;
          } else if (eventType === "task_complete"
            || (responseType === "message" && event.payload?.role === "assistant"
              && (event.payload.channel === "final" || event.payload.phase === "final_answer"))) {
            lifecycle = "complete";
            completionRevision = baseOffset + lineStart;
            if (Number.isFinite(eventTime)) activityAt = eventTime;
          } else if (["reasoning", "custom_tool_call", "custom_tool_call_output"].includes(responseType ?? "") ||
            (responseType === "message" && event.payload?.role === "assistant" && lifecycle !== "complete" && lifecycle !== "idle")) {
            // Current Codex builds record active reasoning and tool work as
            // response_item entries. Long-lived threads can push the original
            // task_started record beyond this bounded tail read.
            lifecycle = "working";
            if (Number.isFinite(eventTime)) activityAt = eventTime;
          }
        } catch { /* Ignore a truncated first or last JSONL record. */ }
        if (newline < 0) break;
        lineStart = newline + 1;
      }
      if (lifecycle === "working") return {
        status: "working", ...(activityAt != null ? { activityAt } : {}),
        ...(contextUsage ?? {})
      };
      if (lifecycle === "complete" && completionRevision != null) return {
        status: "complete", completionRevision, ...(activityAt != null ? { activityAt } : {}),
        ...(contextUsage ?? {})
      };
      return { status: "idle", ...(contextUsage ?? {}) };
  } catch {
    // A file that disappears or changes while being opened is not an owned
    // rollout. Keep the failure content-free and fail closed.
    return null;
  } finally {
    await closeQuietly(handle);
  }
}

function reconcileOwnedStatus(nativeStatus: string, sessionStatus: HostSessionPresence["status"]): string {
  if (["approval", "awaiting-approval", "awaiting-response", "error"].includes(nativeStatus)) return nativeStatus;
  if (sessionStatus === "working") return "working";
  if (sessionStatus === "complete") return ["unread", "complete", "completed", "done"].includes(nativeStatus)
    ? nativeStatus
    : "complete";
  // A quiet rollout tail must not erase the renderer's live or unread state.
  return nativeStatus || "idle";
}
