import type { AgentVisualStatus } from "./types.js";

/**
 * The native renderer can add statuses independently of the plugin. Keep an
 * unrecognised status visible as an explicit display state instead of making
 * it look ready. `types.ts` owns the shared snapshot union; this local
 * extension lets the renderer fail closed while that contract is updated.
 */
export type DisplayAgentVisualStatus = AgentVisualStatus | "unknown";

export function visualStatusFromMicro(status: string): DisplayAgentVisualStatus {
  switch (status) {
    case "off": return "empty";
    case "idle":
    case "ready": return "idle";
    case "working":
    case "thinking":
      return "thinking";
    case "unread":
    case "complete":
    case "completed":
    case "done":
      return "complete";
    case "approval":
    case "awaiting-approval":
    case "awaiting-response":
      return "input";
    case "error": return "error";
    default: return "unknown";
  }
}

export function isKnownVisualStatus(status: string): status is AgentVisualStatus {
  return visualStatusFromMicro(status) !== "unknown";
}
