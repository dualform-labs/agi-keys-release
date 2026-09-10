export class MissingMicroLauncherError extends Error {
  constructor() {
    super("Codex Micro connection launcher is required.");
  }
}

const BRIDGE_FAILURE_CODES = [
  "E_ACTIVE_VIEW_UNAVAILABLE",
  "E_BRIDGE_CLOSED",
  "E_CDP_PROTOCOL",
  "E_CONNECTION_STALE",
  "E_DEBUG_WEBSOCKET_CONNECT",
  "E_DEBUG_WEBSOCKET_TIMEOUT",
  "E_FOREGROUND_TARGET_STALE",
  "E_FOREGROUND_TARGET_UNAVAILABLE",
  "E_INVALID_DEBUG_WEBSOCKET",
  "E_MAPPING_STALE",
  "E_PAGE_STALE",
  "E_RELEASE_TARGET_GONE",
  "E_RENDERER_EVALUATION",
  "E_RENDERER_EVALUATION_TIMEOUT",
  "E_BRIDGE_DISCONNECTED",
  "E_TARGET_STALE",
] as const;

type ReviewedBridgeFailureCode = typeof BRIDGE_FAILURE_CODES[number];
export type BridgeFailureCode = "missing-launcher" | "unavailable" | ReviewedBridgeFailureCode;

const BRIDGE_FAILURE_CODE_SET: ReadonlySet<string> = new Set(BRIDGE_FAILURE_CODES);

/** Preserve reviewed infrastructure codes without exposing exception text. */
export function bridgeFailureCode(error: unknown): BridgeFailureCode {
  if (error instanceof MissingMicroLauncherError) return "missing-launcher";
  if (!(error instanceof Error)) return "unavailable";
  for (const candidate of [error.message, error.name]) {
    if (BRIDGE_FAILURE_CODE_SET.has(candidate)) return candidate as ReviewedBridgeFailureCode;
  }
  return "unavailable";
}
