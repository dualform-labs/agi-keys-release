import { OFFICIAL_KEYCAP_IDS, type OfficialKeycapId } from "./keycaps.js";
import type { MicroSnapshot, OperationRequest } from "./types.js";

const MAX_SEEN_OPERATIONS = 512;

export const OPERATION_INTEGRITY_FAILURE_CODES = [
  "E_UNSUPPORTED_ENVELOPE",
  "E_INVALID_REQUEST_ID",
  "E_INVALID_OPERATION_ID",
  "E_INVALID_PHASE",
  "E_MAPPING_STALE",
  "E_TARGET_STALE",
  "E_INVALID_ACTIVE_THREAD",
  "E_INVALID_ACTIVE_COMPOSER",
  "E_CONNECTION_STALE",
  "E_PAGE_STALE",
  "E_UNKNOWN_PHYSICAL",
  "E_DUPLICATE_OPERATION",
  "E_DUPLICATE_REQUEST",
  "E_DUPLICATE_DOWN",
  "E_OUT_OF_ORDER_UP",
  "E_INVALID_SAFETY_RELEASE",
] as const;

export class OperationIntegrityGuard {
  private readonly seen = new Set<string>();
  private readonly seenRequests = new Set<string>();
  private readonly pressed = new Map<string, string>();

  accept(request: OperationRequest, connectionEpoch: number, pageEpoch: number): void {
    if (request.version !== 1) throw integrityError("E_UNSUPPORTED_ENVELOPE");
    if (!request.requestId || request.requestId.length > 128) throw integrityError("E_INVALID_REQUEST_ID");
    if (!request.operationId || request.operationId.length > 128) throw integrityError("E_INVALID_OPERATION_ID");
    if (!["down", "up", "safety-up", "tick", "invoke"].includes(request.phase)) throw integrityError("E_INVALID_PHASE");
    if (!request.mappingFingerprint) throw integrityError("E_MAPPING_STALE");
    if (!request.targetIdentity) throw integrityError("E_TARGET_STALE");
    if (request.activeThreadKey != null && (!request.activeThreadKey || request.activeThreadKey.length > 240)) {
      throw integrityError("E_INVALID_ACTIVE_THREAD");
    }
    if (request.activeComposerKey != null && !/^composer-[1-9][0-9]{0,9}$/.test(request.activeComposerKey)) {
      throw integrityError("E_INVALID_ACTIVE_COMPOSER");
    }
    if (request.connectionEpoch !== connectionEpoch) throw integrityError("E_CONNECTION_STALE");
    if (request.pageEpoch !== pageEpoch) throw integrityError("E_PAGE_STALE");
    if (!isKnownPhysicalId(request.physicalId)) throw integrityError("E_UNKNOWN_PHYSICAL");
    if (this.seen.has(request.operationId)) throw integrityError("E_DUPLICATE_OPERATION");
    if (this.seenRequests.has(request.requestId)) throw integrityError("E_DUPLICATE_REQUEST");
    if (request.phase === "down" && this.pressed.has(request.physicalId)) throw integrityError("E_DUPLICATE_DOWN");
    if (request.phase === "up" && !this.pressed.has(request.physicalId)) throw integrityError("E_OUT_OF_ORDER_UP");
    if (request.phase === "safety-up" && request.physicalId !== "ACT10" && request.physicalId !== "ACT11") {
      throw integrityError("E_INVALID_SAFETY_RELEASE");
    }

    this.seen.add(request.operationId);
    this.seenRequests.add(request.requestId);
    if (this.seen.size > MAX_SEEN_OPERATIONS) {
      this.seen.delete(this.seen.values().next().value!);
      this.seenRequests.delete(this.seenRequests.values().next().value!);
    }
    if (request.phase === "down") this.pressed.set(request.physicalId, request.operationId);
    if (request.phase === "up" || request.phase === "safety-up") this.pressed.delete(request.physicalId);
  }

  /** Retire the exact down retained by this guard after its leased up succeeds. */
  completeLeasedRelease(
    held: OperationRequest,
    release: OperationRequest,
    connectionEpoch: number,
    pageEpoch: number,
  ): boolean {
    if (held.phase !== "down"
      || release.phase !== "up"
      || release.physicalId !== held.physicalId
      || release.connectionEpoch !== held.connectionEpoch
      || release.pageEpoch !== held.pageEpoch
      || release.mappingFingerprint !== held.mappingFingerprint
      || release.targetIdentity !== held.targetIdentity) {
      throw integrityError("E_INVALID_SAFETY_RELEASE");
    }
    if (held.connectionEpoch !== connectionEpoch || held.pageEpoch !== pageEpoch) return false;
    if (this.pressed.get(held.physicalId) !== held.operationId) return false;
    this.pressed.delete(held.physicalId);
    return true;
  }

  /** Cancel only the exact down that is proven not to have reached dispatch. */
  cancelUnsentDown(operation: OperationRequest): boolean {
    if (operation.phase !== "down") return false;
    if (this.pressed.get(operation.physicalId) !== operation.operationId) return false;
    this.pressed.delete(operation.physicalId);
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.seenRequests.clear();
    this.pressed.clear();
  }
}

function isKnownPhysicalId(physicalId: string): boolean {
  if (/^AG0[0-5]$/.test(physicalId)) return true;
  if (/^ACT(?:0[6-9]|1[0-2])$/.test(physicalId)) return true;
  if (["JOY_UP", "JOY_RIGHT", "JOY_DOWN", "JOY_LEFT", "ENC_CLK", "ENC_CW", "ENC_CC"].includes(physicalId)) return true;
  if (physicalId === "KEYCAP_SIDE_TO_MAIN") return true;
  if (physicalId === "CONTEXT_COMPACT") return true;
  if (!physicalId.startsWith("KEYCAP_")) return false;
  return OFFICIAL_KEYCAP_IDS.includes(physicalId.slice("KEYCAP_".length) as OfficialKeycapId);
}

export function assertFreshOperationTarget(expected: MicroSnapshot, current: MicroSnapshot): void {
  if (expected.mappingFingerprint !== current.mappingFingerprint) throw integrityError("E_MAPPING_STALE");
  if (expected.targetIdentity !== current.targetIdentity) throw integrityError("E_TARGET_STALE");
  if (expected.connectionEpoch !== current.connectionEpoch) throw integrityError("E_CONNECTION_STALE");
  if (expected.pageEpoch !== current.pageEpoch) throw integrityError("E_PAGE_STALE");
}

export function assertFreshActiveThread(expected: MicroSnapshot, current: MicroSnapshot): void {
  if (expected.activeThreadKey) {
    if (expected.activeThreadKey !== current.activeThreadKey) throw integrityError("E_ACTIVE_THREAD_STALE");
    if (expected.activeComposerKey && expected.activeComposerKey !== current.activeComposerKey) {
      throw integrityError("E_ACTIVE_COMPOSER_STALE");
    }
    return;
  }
  if (!expected.activeComposerKey || expected.activeComposerKey !== current.activeComposerKey) {
    throw integrityError("E_ACTIVE_COMPOSER_STALE");
  }
}

export function integrityError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}
