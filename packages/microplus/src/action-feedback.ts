import {
  DRAFT_TRANSFER_FAILURE_CODES,
  MODEL_PICKER_FAILURE_CODES,
  RESET_FAILURE_CODES,
  RENDERER_FAILURE_CODES,
} from "./failure-codes.js";
import { OPERATION_INTEGRITY_FAILURE_CODES } from "./operation-integrity.js";

const ACTION_FAILURE_CODE_VALUES = [
  "E_AGENT_ACTIVATION_UNCHANGED",
  "E_AGENT_WINDOW_UNVERIFIED",
  "E_AGENT_SOURCE_UNVERIFIED",
  "E_AGENT_WINDOW_CREATION_UNCERTAIN",
  "E_AGENT_SOURCE_CHANGED",
  "E_AGENT_WINDOW_AMBIGUOUS",
  "E_AGENT_NEW_WINDOW_UNSUPPORTED",
  "E_ACTIVE_VIEW_UNAVAILABLE",
  "E_ACTIVE_THREAD_STALE",
  "E_ACTIVE_COMPOSER_STALE",
  "E_COMMAND_RUNNER_INCOMPATIBLE",
  "E_COMMAND_INACTIVE",
  "E_MICRO_EVENT_BUS_UNAVAILABLE",
  "E_MICRO_HANDLER_INACTIVE",
  "E_COMMAND_METADATA_UNAVAILABLE",
  "E_COMMAND_SCOPE_UNAVAILABLE",
  "E_COMMAND_ACCESS_REQUIRED",
  "E_COMMAND_CAPABILITY_REQUIRED",
  "E_CONNECTION_STALE",
  "E_PAGE_STALE",
  "E_MAPPING_STALE",
  "E_MAPPING_INACTIVE",
  "E_TARGET_STALE",
  "E_OPERATION_UNOBSERVED",
  "E_CDP_PROTOCOL",
  "E_RENDERER_EVALUATION",
  "E_RENDERER_EVALUATION_TIMEOUT",
  "E_DEBUG_WEBSOCKET_CONNECT",
  "E_DEBUG_WEBSOCKET_TIMEOUT",
  "E_INVALID_DEBUG_WEBSOCKET",
  "E_BRIDGE_CLOSED",
  "E_BRIDGE_DISCONNECTED",
  "E_FOREGROUND_TARGET_UNAVAILABLE",
  "E_FOREGROUND_TARGET_STALE",
  "E_RELEASE_TARGET_GONE",
  "E_FOCUS_FAILED",
  "E_CONTEXT_COMPACTION_UNAVAILABLE",
  "E_CONTEXT_COMPACTION_BUSY",
  "E_CONTEXT_COMPACTION_DRAFT_NOT_EMPTY",
  "E_CONTEXT_COMPACTION_SCOPE_UNAVAILABLE",
  "E_CONTEXT_COMPACTION_MANAGER_UNAVAILABLE",
  "E_CONTEXT_COMPACTION_RESULT_UNVERIFIED",
  "E_CONTEXT_NOT_ELIGIBLE",
  "E_CONTEXT_PRESS_UNSUPPORTED",
  "E_EXTERNAL_URL_NOT_ALLOWED",
  "E_INPUT_OWNED",
  "E_RELEASE_UNVERIFIED",
  "E_RELEASE_ALREADY_ATTEMPTED",
  "E_RESULT_UNVERIFIED",
  ...OPERATION_INTEGRITY_FAILURE_CODES,
  ...RENDERER_FAILURE_CODES,
  ...RESET_FAILURE_CODES,
  ...MODEL_PICKER_FAILURE_CODES,
  ...DRAFT_TRANSFER_FAILURE_CODES,
  "E_DISPLAY_PRESS_COMMAND_INVALID",
] as const;

const ACTION_FAILURE_CODES: ReadonlySet<string> = new Set(ACTION_FAILURE_CODE_VALUES);

export type ActionFailureCode = typeof ACTION_FAILURE_CODE_VALUES[number];

export type ActionFeedbackTarget = {
  id: string;
  showAlert?: () => Promise<void>;
  showOk?: () => Promise<void>;
};

export type ActionFeedbackToken = {
  owner: object;
  sequence: number;
};

const actionFeedbackSequences = new WeakMap<object, number>();

export type CurrentActionGuard = {
  isCurrentAction?(action: { id: string }): boolean;
};

/** Start an input generation before awaiting any action operation. */
export function beginActionFeedback(action: { id: string }): ActionFeedbackToken {
  const owner = action as object;
  const sequence = (actionFeedbackSequences.get(owner) ?? 0) + 1;
  actionFeedbackSequences.set(owner, sequence);
  return { owner, sequence };
}

/** Reuse the current physical input cycle for its release-side operation. */
export function currentActionFeedback(action: { id: string }): ActionFeedbackToken {
  const owner = action as object;
  const sequence = actionFeedbackSequences.get(owner);
  return sequence === undefined ? beginActionFeedback(action) : { owner, sequence };
}

function isCurrentActionFeedback(action: ActionFeedbackTarget, token: ActionFeedbackToken): boolean {
  return token.owner === action && actionFeedbackSequences.get(action) === token.sequence;
}

/** Preserve only reviewed diagnostics; exception text never reaches logs or displays. */
export function safeActionFailureCode(error: unknown): ActionFailureCode | "E_ACTION_UNKNOWN" {
  if (!(error instanceof Error)) return "E_ACTION_UNKNOWN";
  if (ACTION_FAILURE_CODES.has(error.message as ActionFailureCode)) return error.message as ActionFailureCode;
  if (ACTION_FAILURE_CODES.has(error.name as ActionFailureCode)) return error.name as ActionFailureCode;
  return "E_ACTION_UNKNOWN";
}

export async function showAlertIfCurrent(
  controller: CurrentActionGuard,
  action: ActionFeedbackTarget,
  token?: ActionFeedbackToken,
): Promise<void> {
  if (token && !isCurrentActionFeedback(action, token)) return;
  if ((controller.isCurrentAction?.(action) ?? true) && action.showAlert) {
    // Notification delivery is not the operation result and must never abort
    // release/unregister cleanup. The caller retains the original failure.
    try { await action.showAlert(); } catch { /* Host notification unavailable. */ }
  }
}

export async function showOkIfCurrent(
  controller: CurrentActionGuard,
  action: ActionFeedbackTarget,
  token?: ActionFeedbackToken,
): Promise<void> {
  if (token && !isCurrentActionFeedback(action, token)) return;
  if ((controller.isCurrentAction?.(action) ?? true) && action.showOk) {
    try { await action.showOk(); } catch { /* Host notification unavailable. */ }
  }
}
