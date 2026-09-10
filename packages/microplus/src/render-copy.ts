/** Per-key copy selection. Undefined preserves the established mixed copy. */
export type DisplayLanguage = "ja" | "en";

export type CopyKey =
  | "ready" | "pressed" | "holding" | "pending" | "recording" | "confirmed" | "error" | "stale" | "offline" | "connecting" | "unknown" | "unavailable" | "empty" | "thinking" | "done" | "input" | "sentUnverified"
  | "current" | "target" | "titleUnavailable" | "unassigned" | "signalsUnavailable" | "assignmentConfirmed" | "assignmentUnavailable" | "notAcquired" | "usageFiveHour" | "usageWeekly" | "usageLimit" | "usage" | "commandSelection" | "model" | "resetCredits" | "settingDependent" | "currentValue" | "valueUnavailable" | "task" | "processing" | "held" | "unverified" | "failure" | "resultUnverified" | "releaseUnverified" | "targetUnavailable" | "createFailure" | "operationUnverified" | "pressUnverified" | "displayUnverified" | "cannotConfirm" | "contextUsage" | "inputOwned" | "focusFailed" | "commandInactive";

const DISPLAY_COPY: Record<DisplayLanguage, Record<CopyKey, string>> = {
  ja: {
    ready: "準備完了", pressed: "押下", holding: "保持中", pending: "処理中", recording: "録音中", confirmed: "確認済み", error: "エラー", stale: "古い", offline: "オフライン", connecting: "接続中", unknown: "不明", unavailable: "利用不可", empty: "空き", thinking: "思考中", done: "完了", input: "入力", sentUnverified: "未確認",
    current: "現在", target: "対象", titleUnavailable: "タイトル未取得", unassigned: "未割当", signalsUnavailable: "信号なし", assignmentConfirmed: "割当確認済み", assignmentUnavailable: "割当未取得", notAcquired: "未取得", usageFiveHour: "5時間", usageWeekly: "週間", usageLimit: "制限", usage: "使用量", commandSelection: "操作選択", model: "モデル", resetCredits: "利用可能回数", settingDependent: "設定依存", currentValue: "現在値", valueUnavailable: "値未取得", task: "タスク", processing: "処理中", held: "押下中", unverified: "未確認", failure: "失敗", resultUnverified: "結果未確認", releaseUnverified: "解除未確認", targetUnavailable: "対象未取得", createFailure: "作成失敗", operationUnverified: "操作未確認", pressUnverified: "押下未確認", displayUnverified: "表示未確認", cannotConfirm: "確認不可", contextUsage: "コンテキスト使用量", inputOwned: "他キー操作中", focusFailed: "前面化失敗", commandInactive: "現在は使えません"
  },
  en: {
    ready: "READY", pressed: "PRESSED", holding: "HOLDING", pending: "PENDING", recording: "RECORDING", confirmed: "CONFIRMED", error: "ERROR", stale: "STALE", offline: "OFFLINE", connecting: "CONNECTING", unknown: "UNKNOWN", unavailable: "UNAVAILABLE", empty: "EMPTY", thinking: "THINKING", done: "DONE", input: "INPUT", sentUnverified: "SENT-UNVERIFIED",
    current: "CURRENT", target: "TARGET", titleUnavailable: "TITLE UNAVAILABLE", unassigned: "UNASSIGNED", signalsUnavailable: "SIGNALS UNAVAILABLE", assignmentConfirmed: "MAPPED", assignmentUnavailable: "UNMAPPED", notAcquired: "NOT AVAILABLE", usageFiveHour: "5H", usageWeekly: "WEEK", usageLimit: "LIMIT", usage: "USAGE", commandSelection: "COMMAND", model: "MODEL", resetCredits: "AVAILABLE RESETS", settingDependent: "SETTINGS DEPENDENT", currentValue: "CURRENT VALUE", valueUnavailable: "VALUE UNAVAILABLE", task: "TASK", processing: "PROCESSING", held: "HELD", unverified: "UNVERIFIED", failure: "FAILED", resultUnverified: "RESULT UNVERIFIED", releaseUnverified: "RELEASE UNVERIFIED", targetUnavailable: "TARGET UNAVAILABLE", createFailure: "CREATE FAILED", operationUnverified: "OPERATION UNVERIFIED", pressUnverified: "PRESS UNVERIFIED", displayUnverified: "DISPLAY UNVERIFIED", cannotConfirm: "CANNOT CONFIRM", contextUsage: "CONTEXT USAGE", inputOwned: "ANOTHER KEY BUSY", focusFailed: "FOCUS FAILED", commandInactive: "UNAVAILABLE"
  }
};

export function copy(language: DisplayLanguage | undefined, key: CopyKey, fallback: string): string {
  return language == null ? fallback : DISPLAY_COPY[language][key];
}
