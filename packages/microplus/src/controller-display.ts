import type { DisplayLifecycleState, MicroPlusFeedbackStatus } from "./render.js";
import type { HostHealth } from "./types.js";
import type { ReasoningAdjustment } from "./types.js";

/** Keep display feedback content-free and bounded before it reaches a small LCD. */
export function truncateFeedback(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return clean.length > limit ? `${clean.slice(0, Math.max(0, limit - 1))}…` : clean;
}

/** The renderer has no current-effort field, so describe only the observed value and requested operation. */
export function reasoningDialValue(
  health: string,
  adjustment?: ReasoningAdjustment,
  current?: string | null,
): string {
  const operation = adjustment === "increase" ? "上げる操作を送信"
    : adjustment === "decrease" ? "下げる操作を送信" : "操作待ち";
  const currentValue = current ? truncateFeedback(current, 12) : "未取得";
  return `${health} · 現在値 ${currentValue} · ${operation}`;
}

export function localizedDialFeedbackStatus(status: MicroPlusFeedbackStatus): string {
  switch (status) {
    case "ready": return "準備完了";
    case "pressed": return "押下中";
    case "pending": return "確認中";
    case "recording": return "録音中";
    case "confirmed": return "確認済み";
    case "error": return "失敗";
    case "stale": return "期限切れ";
    case "offline": return "未接続";
    case "connecting": return "接続中";
    case "unknown": return "不明";
    case "unavailable": return "利用不可";
  }
}

export function healthToContextDisplayState(health: HostHealth["state"]): DisplayLifecycleState {
  switch (health) {
    case "ready": return "ready";
    case "connecting": return "connecting";
    case "offline": return "offline";
    case "degraded": return "unavailable";
  }
}
