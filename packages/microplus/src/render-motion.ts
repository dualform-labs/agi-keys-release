import type { ThemeMode } from "./types.js";

const MOTION_ACCENTS: Record<string, [string, string]> = {
  voice: ["#FFB8D5", "#B32967"], model: ["#CFC0FF", "#7040B8"],
  reasoning: ["#FFD79B", "#945C0A"], usage: ["#9FE8D1", "#087763"],
  commands: ["#CFC0FF", "#7040B8"], navigation: ["#D9F2FF", "#0066B5"],
  send: ["#B6ECD0", "#087763"],
  development: ["#9ED8FF", "#00639B"], danger: ["#FFB4B4", "#B4232E"],
  creative: ["#FFC2F0", "#A83283"]
};

export function motionAccent(kind: string, theme: ThemeMode): string {
  return (MOTION_ACCENTS[kind] ?? MOTION_ACCENTS.navigation!)[theme === "dark" ? 0 : 1];
}

export function keyMotionKind(keyId: string, source: string): string {
  if (/^MIC/.test(keyId)) return "voice";
  if (/^(MIND|FAST)/.test(keyId)) return "reasoning";
  if (/^(CODEX|PLAY|YEET|APPR|UPL)$/.test(keyId)) return "send";
  if (/^(REJ|DEL|YOLO)$/.test(keyId)) return "danger";
  if (/^(GIT|BRCH|BRANCH|MRG|PR|DIFF|BUG|TERM)$/.test(keyId)) return "development";
  if (/^PAINT$/.test(keyId)) return "creative";
  if (/^(MAGIC|LAB|APPS|SETUP|OAI)$/.test(keyId)) return "commands";
  if (/data-usage-/.test(source)) return "usage";
  return "navigation";
}
