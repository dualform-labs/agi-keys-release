export type AgentWindowObservation = {
  targetKey: string;
  activeThreadKey: string | null;
  focusedVisible: boolean;
};

export type AgentWindowSelection =
  | { kind: "unopened" }
  | { kind: "existing"; targetKey: string };

/**
 * A native window creation has no correlated acknowledgement. Keep the task
 * reserved until a separately enumerated window proves the requested route.
 */
export class AgentWindowCreationGuard {
  readonly #uncertain = new Set<string>();

  begin(threadKey: string): void {
    if (this.#uncertain.has(threadKey)) throw new Error("E_AGENT_WINDOW_CREATION_UNCERTAIN");
    this.#uncertain.add(threadKey);
  }

  confirm(threadKey: string): void {
    this.#uncertain.delete(threadKey);
  }
}

/** Refuse success if the source window navigated while another window opened. */
export function assertAgentSourceUnchanged(
  expectedThreadKey: string | null | undefined,
  observedThreadKey: string | null | undefined,
  expectedComposerKey?: string | null,
  observedComposerKey?: string | null,
): void {
  if (expectedThreadKey) {
    if (observedThreadKey !== expectedThreadKey) throw new Error("E_AGENT_SOURCE_CHANGED");
    return;
  }
  if (expectedComposerKey && observedThreadKey == null && observedComposerKey === expectedComposerKey) return;
  throw new Error("E_AGENT_SOURCE_UNVERIFIED");
}

/** Every main renderer must be classified before deciding a task is unopened. */
export function assertCompleteAgentWindowObservations(expectedCount: number, observedCount: number): void {
  if (expectedCount < 1 || observedCount !== expectedCount) throw new Error("E_AGENT_WINDOW_UNVERIFIED");
}

export function selectAgentWindowFromCompleteScan(
  expectedCount: number,
  observations: AgentWindowObservation[],
  requestedThreadKey: string,
  knownTargetKey = "",
): AgentWindowSelection {
  const existing = selectExistingAgentWindow(observations, requestedThreadKey, knownTargetKey);
  if (existing.kind === "existing") return existing;
  // An unobserved renderer might own the requested task. Require a complete
  // scan only before classifying it as unopened and mutating/creating a window.
  assertCompleteAgentWindowObservations(expectedCount, observations.length);
  return existing;
}

/** Select a proven task window without choosing an arbitrary duplicate. */
export function selectExistingAgentWindow(
  observations: AgentWindowObservation[],
  requestedThreadKey: string,
  knownTargetKey = "",
): AgentWindowSelection {
  const matches = observations.filter((item) => item.activeThreadKey === requestedThreadKey);
  if (matches.length === 0) return { kind: "unopened" };
  if (matches.length === 1) return { kind: "existing", targetKey: matches[0]!.targetKey };
  const focused = matches.filter((item) => item.focusedVisible);
  if (focused.length === 1) return { kind: "existing", targetKey: focused[0]!.targetKey };
  const known = matches.filter((item) => item.targetKey === knownTargetKey);
  if (known.length === 1) return { kind: "existing", targetKey: known[0]!.targetKey };
  throw new Error("E_AGENT_WINDOW_AMBIGUOUS");
}

/** Exact route builder traced from Codex's installed local-thread command. */
export function localAgentWindowPath(threadKey: string): string | null {
  if (!threadKey.startsWith("local:")) return null;
  const conversationId = threadKey.slice("local:".length);
  if (!/^[A-Za-z0-9_-]+$/u.test(conversationId)) return null;
  return `/local/${conversationId}`;
}
