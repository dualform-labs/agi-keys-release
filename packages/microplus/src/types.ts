export type AgentVisualStatus = "empty" | "idle" | "thinking" | "complete" | "input" | "error" | "unknown";
export type ThemeMode = "light" | "dark";
export type HostHealthState = "ready" | "degraded" | "offline" | "connecting";
export type UsageLimitMode = "auto" | "five-hour" | "weekly";
export type UsageWindowKind = Exclude<UsageLimitMode, "auto"> | "other";

export type HostHealth = {
  state: HostHealthState;
  reason?: "awaiting-snapshot" | "native-signals-unavailable" | "snapshot-stale" | "local-bridge-unavailable" | "missing-launcher";
  changedAt: number;
};

export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export type MicroAgentSlot = {
  /** Whether goal/question selectors were successfully read for this slot. */
  metadataAvailability?: "available" | "unavailable";
  goalStatus?: GoalStatus;
  pendingQuestion?: boolean;
  /** Native local-thread approval chip state; omitted when the renderer selector is unavailable. */
  approvalPending?: boolean;
  /** Native sidebar pin selector result; omitted when the renderer selector is unavailable. */
  threadPinned?: boolean;
  id: number;
  threadKey: string | null;
  title: string | null;
  status: string;
  selected: boolean;
  activityAt?: number;
  /** True when this host has the backing Codex rollout file for the task. */
  ownedByHost?: boolean;
  /** Percentage of the current model context window consumed by this task. */
  contextUsedPercent?: number;
};

/** Physical Codex Micro action positions. Keep ACT10 and ACT11 distinct. */
export type MicroActionSlot = "ACT06" | "ACT07" | "ACT08" | "ACT09" | "ACT10" | "ACT11" | "ACT12";
/** Layout key used by the native wide microphone key when its two switches are combined. */
export type MicroLayoutSlot = MicroActionSlot | "ACT10_ACT11";
export type MicroDirection = "up" | "right" | "down" | "left";
export type ReasoningAdjustment = "decrease" | "increase";

export type PhysicalInputPhase = "down" | "up" | "safety-up" | "tick" | "invoke";

/** Content-free correlation envelope carried with every renderer mutation. */
export type OperationRequest = {
  version: 1;
  requestId: string;
  operationId: string;
  connectionEpoch: number;
  pageEpoch: number;
  physicalId: string;
  phase: PhysicalInputPhase;
  mappingFingerprint: string;
  targetIdentity: string;
  /** Exact task identity required by commands that mutate the current view. */
  activeThreadKey?: string;
  /** Renderer-local identity used while a new composer has no task ID. */
  activeComposerKey?: string;
};

export type MutationConfirmation = {
  dispatch: "accepted";
  metadata: "matched";
  /** `confirmed` requires a content-free postcondition to match fresh renderer readback. */
  semanticOutcome: "confirmed" | "unverified" | "reasoning-changed" | "reasoning-unchanged";
  previousReasoningEffort?: string;
  currentReasoningEffort?: string;
  /** Fresh renderer readback already performed by the post-dispatch observer. */
  observedSnapshot?: MicroSnapshot;
};

export type RateLimitResetOutcome = {
  code: "reset" | "already_redeemed";
  /** Cache refresh is presentation work and does not change the consume result. */
  refresh: "updated" | "failed" | "unavailable";
  redeemRequestId: string;
};

/** Stream Deck+ encoder roles exposed by the MicroPlus action surface. */
export type MicroPlusDialKind = "agents" | "reasoning" | "navigation" | "commands" | "usage" | "model";

export type MicroLayout = {
  version: 1;
  /** Native layouts can expose a combined ACT10/ACT11 binding in addition to the physical entries. */
  slots: Partial<Record<MicroLayoutSlot, { keycapId: string; commandId?: string }>>;
  /** Absent in older snapshots; false means the native wide microphone key is combined. */
  separateMicrophoneKeys?: boolean;
  analogStick: Record<MicroDirection, unknown>;
};

export type HostSessionPresence = {
  threadId: string;
  activityAt: number;
  status: "idle" | "working" | "complete";
  /** Byte offset of the latest structural task_complete event; no task content is exposed. */
  completionRevision?: number;
  /** Content-free context utilization derived from the latest structural token-count event. */
  contextUsedPercent?: number;
};

export type UsageWindow = {
  id: string;
  kind: UsageWindowKind;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type UsageSnapshot = {
  windows: UsageWindow[];
  /** Native query update time. Absent means freshness is unknown. */
  observedAt?: number;
  resetCreditsAvailable: number | null;
  resetCreditsApplicable: number | null;
};

export type MicroSnapshot = {
  slots: MicroAgentSlot[];
  /** Task currently open in the Codex renderer, even when it is outside the six native Micro slots. */
  activeThreadKey?: string;
  /** User-visible title for the active task, including tasks outside the six Micro slots. */
  activeThreadTitle?: string;
  /** Context utilization for the active task, sourced from its owned rollout. */
  activeContextUsedPercent?: number;
  /** Byte revision of the active task's latest token-count observation. */
  activeContextRevision?: number;
  /** Renderer-local identity of the one unambiguous active composer root. */
  activeComposerKey?: string;
  /** Content-free values read from the one unambiguous active composer. */
  composerReadback?: {
    /** Canonical model ID from the pinned native model-picker owner props. */
    currentModelId?: string | null;
    modelLabel?: string | null;
    modelSelectionMode?: "default" | "model" | null;
    modelPickerOpen?: boolean;
    modelCandidateLabel?: string | null;
    activeThreadKey?: string;
    reasoningEffort: string | null;
    /** No stable passive source exists in the pinned build. */
    fastEnabled: null;
    /** No stable passive source exists in the pinned build. */
    dictationPhase: "unavailable";
    observedAt: number;
  };
  layout: MicroLayout;
  agentSource: "pinned" | "recent" | "priority" | "custom";
  lightingAutoOff: string;
  theme: ThemeMode;
  /** Account usage read from Codex's authenticated renderer client. */
  usage?: UsageSnapshot;
  /** Recent local rollout identities used to disambiguate cross-host mirrors. */
  hostSessions?: HostSessionPresence[];
  /** Native local-thread approval chip state for the active thread, when available. */
  approvalPending?: boolean;
  /** Native sidebar pin state for the active thread, when available. */
  threadPinned?: boolean;
  /** Monotonic revision of a successful native clipboard write for Markdown copy. */
  markdownCopyRevision?: number;
  /** Monotonic CDP connection generation assigned by the local adapter. */
  connectionEpoch: number;
  /** Monotonic Stream Deck visibility generation assigned by the controller. */
  pageEpoch: number;
  /** Hash of the currently observed native Micro mapping and settings. */
  mappingFingerprint: string;
  /** Stable identity of the connected Codex renderer target for this connection. */
  targetIdentity: string;
};
