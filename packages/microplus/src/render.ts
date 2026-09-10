import type { AgentVisualStatus, HostHealthState, ThemeMode, UsageWindow, UsageWindowKind } from "./types.js";
import type { DisplayAgentVisualStatus } from "./status.js";
import { clampPercent } from "./usage.js";
import { ADDITIONAL_KEYCAPS } from "./keycaps.js";
import { KEY_ICON_CATALOG } from "./key-icon-catalog.js";
import type { OfficialKeycapId } from "./keycaps.js";
import { copy } from "./render-copy.js";
import type { CopyKey, DisplayLanguage } from "./render-copy.js";
import { keyMotionKind, motionAccent } from "./render-motion.js";

export type { DisplayLanguage } from "./render-copy.js";

export type BuiltinIconName = "back" | "forward" | "sidebar" | "home" | "navigation" | "up" | "encoder" | "side-to-main";

/** A renderer state describes an observed lifecycle, never a command intent. */
export type DisplayLifecycleState =
  | "ready"
  | "pressed"
  | "holding"
  | "pending"
  | "recording"
  | "confirmed"
  | "error"
  | "stale"
  | "offline"
  | "connecting"
  | "unknown"
  | "unavailable";

export type AgentAttention = {
  metadataAvailability?: "available" | "unavailable";
  goalStatus?: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
  pendingQuestion?: boolean;
};

export type DisplayActionState = {
  state: DisplayLifecycleState;
  /** A short observed result or error code. It is never placed in `value`. */
  detail?: string;
  /** Stable target identity or physical target label. */
  target?: string;
  /** Progress for a real hold/pending operation only, in the range 0..1. */
  progress?: number;
};

/**
 * Action-scoped feedback supplied by repair_input. These phases deliberately
 * stop at `sent-unverified`: a dispatch acknowledgement is not a native
 * result, so the renderer must not claim success or recording without an
 * observer-backed snapshot.
 */
export type OperationFeedbackPhase = "pending" | "held" | "sent-unverified" | "error";

export type OperationFeedback = {
  phase: OperationFeedbackPhase;
  detail?: string;
  operationId?: string;
  target?: string;
  progress?: number;
};

export type ActionKeyRenderInput = {
  identity: string;
  current?: string | null;
  target?: string | null;
  state?: DisplayLifecycleState;
  detail?: string;
  selected?: boolean;
  theme?: ThemeMode;
  language?: DisplayLanguage;
  /** Controller-owned animation frame for held/pending feedback. */
  animationFrame?: number;
};

export type PhysicalActionRenderInput = {
  slot: string;
  /** Read-back keycap label. Omit when the native layout is not available. */
  observedLabel?: string | null;
  current?: string | null;
  target?: string | null;
  state?: DisplayLifecycleState;
  detail?: string;
  theme?: ThemeMode;
  language?: DisplayLanguage;
  animationFrame?: number;
};

export type MicroPlusFeedbackStatus =
  | "ready"
  | "pressed"
  | "pending"
  | "recording"
  | "confirmed"
  | "error"
  | "stale"
  | "offline"
  | "connecting"
  | "unknown"
  | "unavailable";

/**
 * The fields mirror the native `$A1` feedback contract. `value` is always an
 * observed value; a command being sent belongs in `detail` while `status` is
 * pending. `icon` is optional for SDK layouts that expose it.
 */
export type MicroPlusFeedback = {
  title: string;
  value: string;
  detail: string;
  status: MicroPlusFeedbackStatus;
  progress?: number;
  icon?: string;
};

export type PlusDialFeedbackInput = {
  kind: "agents" | "reasoning" | "navigation" | "commands" | "usage" | "model";
  theme?: ThemeMode;
  health?: HostHealthState;
  state?: MicroPlusFeedbackStatus;
  slot?: number;
  slotCount?: number;
  // Controller snapshots may carry an explicit undefined while the slot is
  // absent. Keep that distinct from the observed null value without making
  // the caller manufacture a placeholder title.
  taskTitle?: string | null | undefined;
  activeThreadTitle?: string | null | undefined;
  agentStatus?: DisplayAgentVisualStatus;
  selected?: boolean;
  contextUsedPercent?: number;
  /** Native read-back value. A missing value remains an em dash. */
  observedValue?: string | number | null;
  target?: string | null;
  /** Last command/observer detail; never treated as the current value. */
  operation?: string | null;
  detail?: string | null;
  language?: DisplayLanguage;
  /** Controller-owned frame used only for pending/held visual motion. */
  animationFrame?: number;
  /** Short visual acknowledgement of actual rotation, never a success state. */
  interactionAgeMs?: number;
  interactionDirection?: number;
};

export type UsageFreshness = {
  observedAt?: number;
  now?: number;
  maxAgeMs?: number;
};

export type RateLimitResetDisplayOptions = {
  state?: DisplayLifecycleState;
  detail?: string;
};

export type ContextCompactionRenderInput = {
  /** Current active-task context utilization from the session ownership index. */
  contextUsedPercent?: number;
  /** Content-free revision of the token-count observation, when available. */
  contextRevision?: number;
  health?: HostHealthState;
  state?: DisplayLifecycleState;
  detail?: string;
  theme?: ThemeMode;
  language?: DisplayLanguage;
  /** Controller-owned frame used for the fast pending arc. */
  animationFrame?: number;
};

export const SIGNAL_COLORS: Record<ThemeMode, Record<DisplayAgentVisualStatus, string>> = {
  light: {
    empty: "#52616C",
    // Dark enough for a light key; the previous white idle marker was low contrast.
    idle: "#3E4B56",
    thinking: "#005FC7",
    complete: "#087A3C",
    input: "#A84A00",
    error: "#B8122C",
    unknown: "#5C6872"
  },
  dark: {
    empty: "#A5B0B9",
    idle: "#F2F2EE",
    thinking: "#62A9FF",
    complete: "#55E28B",
    input: "#FFB45E",
    error: "#FF7184",
    unknown: "#BAC4CB"
  }
};

type SurfacePalette = {
  outer: string;
  keyTop: string;
  keyMiddle: string;
  keyBottom: string;
  border: string;
  innerBorder: string;
  title: string;
  muted: string;
  selected: string;
};

const SURFACES: Record<ThemeMode, SurfacePalette> = {
  light: {
    outer: "#CBD2D7", keyTop: "#F7F9FA", keyMiddle: "#EEF2F4", keyBottom: "#DDE3E6",
    border: "#FFFFFF", innerBorder: "#B9C2C8", title: "#172027", muted: "#53616B", selected: "#087A67"
  },
  dark: {
    outer: "#0E1318", keyTop: "#1B232B", keyMiddle: "#171E25", keyBottom: "#141A20",
    border: "#39444D", innerBorder: "#303A44", title: "#F1F5F7", muted: "#AEBBC4", selected: "#57D6A0"
  }
};

const DISPLAY_FONT = "Hiragino Sans, Yu Gothic, Noto Sans CJK JP, Bahnschrift, Segoe UI, Arial, sans-serif";
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function renderAgentKey(
  slot: number,
  title: string,
  status: DisplayAgentVisualStatus,
  selected = false,
  phase = 0,
  theme: ThemeMode = "light",
  hostBadge?: string,
  hostHealth: HostHealthState = "ready",
  contextUsedPercent?: number,
  showContextRing = true,
  language?: DisplayLanguage,
  attention?: AgentAttention
): string {
  return toDataUrl(renderAgentSvg(slot, title, status, selected, phase, theme, hostBadge, hostHealth, contextUsedPercent, showContextRing, language, attention));
}

/** Render one 144px agent key with an explicit, non-duplicated state footer. */
export function renderAgentSvg(
  slot: number,
  title: string,
  status: DisplayAgentVisualStatus,
  selected = false,
  phase = 0,
  theme: ThemeMode = "light",
  hostBadge?: string,
  hostHealth: HostHealthState = "ready",
  contextUsedPercent?: number,
  showContextRing = true,
  language?: DisplayLanguage,
  attention?: AgentAttention
): string {
  const surface = SURFACES[theme];
  const color = signalForStatus(status, theme);
  const localizedTitle = hostHealth === "connecting"
    ? copy(language, "connecting", "接続中")
    : localizeAgentTitle(title, language);
  const titleLines = splitDisplayLines(localizedTitle, 13, 2, language);
  const pulse = 0.75 + 0.25 * ((Math.sin((phase / 12) * Math.PI * 2) + 1) / 2);
  const statusLabel = agentStatusLabel(status, hostHealth, language);
  const stateColor = hostHealth === "ready" ? color : stateSignal(hostHealth, theme);
  const slotLabel = `A${String(slot + 1).padStart(2, "0")}`;
  const titleMarkup = titleLines.length > 1
    ? `<text x="16" y="53" font-size="${fitTitleFont(titleLines[0] ?? "", 16.5)}" font-weight="650" fill="${surface.title}">${escapeXml(titleLines[0] ?? "")}</text><text x="16" y="72" font-size="${fitTitleFont(titleLines[1] ?? "", 16.5)}" font-weight="650" fill="${surface.title}">${escapeXml(titleLines[1] ?? "")}</text>`
    : `<text x="16" y="62" font-size="${fitTitleFont(titleLines[0] ?? "", 18)}" font-weight="650" fill="${surface.title}">${escapeXml(titleLines[0] ?? "")}</text>`;
  const attentionMarkup = renderAgentAttention(attention, language, surface, theme, hostHealth === "ready" ? phase : 0);
  const showStatusFooter = !attentionMarkup || hostHealth !== "ready" || status === "thinking";
  const runningWithAttention = !!attentionMarkup && hostHealth === "ready" && status === "thinking";
  // Attention rows are the high-priority state surface. The decorative status
  // glyph yields its space while a goal/question badge is present; the
  // observed status text footer remains visible at the bottom of the key.
  const statusMark = attentionMarkup ? "" : renderAgentStatusMark(status, stateColor, phase, pulse);
  const selectedMarkup = `${selected ? `<rect data-agent-selection-glow="true" x="7" y="7" width="130" height="130" rx="16" fill="none" stroke="${surface.selected}" stroke-width="8" stroke-opacity=".24"/>` : ""}<rect data-agent-selected="${selected}" data-agent-status-frame="${status}" x="7" y="7" width="130" height="130" rx="16" fill="none" stroke="${selected ? surface.selected : stateColor}" stroke-width="${selected ? "3" : "2"}" stroke-opacity="${hostHealth === "ready" ? ".94" : ".72"}"/>`;
  const hostBadgeMarkup = hostBadge
    ? `<text data-agent-host="${escapeXml(hostBadge)}" x="82" y="27" text-anchor="end" font-family="${MONO_FONT}" font-size="8" font-weight="700" fill="${surface.muted}">${escapeXml(hostBadge)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="Codex agent ${escapeXml(slotLabel)} ${escapeXml(statusLabel)}">
    <defs><linearGradient id="agent-glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${surface.keyTop}"/><stop offset=".48" stop-color="${surface.keyMiddle}"/><stop offset="1" stop-color="${surface.keyBottom}"/></linearGradient></defs>
    <rect data-theme="${theme}" x="4" y="4" width="136" height="136" rx="18" fill="${surface.outer}"/>
    <rect x="9" y="9" width="126" height="126" rx="13" fill="url(#agent-glass)" stroke="${surface.border}" stroke-width="1"/>
    ${selectedMarkup}
    <line x1="16" y1="34" x2="128" y2="34" stroke="${surface.innerBorder}" stroke-width="1"/>
    ${hostHealth === "ready" && status !== "empty" && showContextRing ? renderContextRing(contextUsedPercent, theme, surface) : ""}
    ${renderHostHealthMark(hostHealth, theme)}
    <g data-agent-slot="${slot + 1}" font-family="${DISPLAY_FONT}">
      <text data-agent-slot-label="${slot + 1}" x="126" y="24" text-anchor="end" font-family="${MONO_FONT}" font-size="10" font-weight="750" fill="${surface.muted}">${slotLabel}</text>
      ${hostBadgeMarkup}
      <g data-agent-title="${escapeXml(localizedTitle)}">${titleMarkup}</g>
      ${attentionMarkup}
    </g>
    ${statusMark}
    ${showStatusFooter ? `<text data-agent-status-label="${status}" data-host-health="${hostHealth}" x="${runningWithAttention ? 26 : 16}" y="${runningWithAttention ? 134 : 128}" font-family="${MONO_FONT}" font-size="${runningWithAttention ? 10.5 : 10}" font-weight="750" letter-spacing=".25" fill="${stateColor}">${escapeXml(runningWithAttention ? (language === "en" ? "RUNNING" : "実行中") : statusLabel)}</text>${runningWithAttention ? `<circle data-agent-running="true" cx="18" cy="131" r="2" fill="${stateColor}" opacity="${pulse.toFixed(2)}"/>` : ""}` : ""}
  </svg>`;
}

/** A flat action/value/target/state key for physical or fixed actions. */
export function renderActionKey(input: ActionKeyRenderInput): string {
  const theme = input.theme ?? "dark";
  const language = input.language;
  const surface = SURFACES[theme];
  const state = input.state ?? "unknown";
  const color = stateColor(state, theme);
  const identity = truncateDisplayText(input.identity || copy(language, "unassigned", "未割当"), 16, 12);
  const current = input.current == null || !String(input.current).trim() ? "—" : truncateDisplayText(String(input.current), 14, 13);
  const target = input.target == null || !String(input.target).trim() ? copy(language, "notAcquired", "未取得") : truncateDisplayText(String(input.target), 16, 14);
  const detail = input.detail == null ? "" : truncateDisplayText(input.detail, 16, 14);
  const targetLines = splitDisplayLines(target, 14, 1);
  const detailMarkup = detail ? `<text data-action-detail="${escapeXml(detail)}" x="16" y="112" font-family="${DISPLAY_FONT}" font-size="9" font-weight="600" fill="${surface.muted}">${escapeXml(detail)}</text>` : "";
  const currentLabel = copy(language, "current", "現在");
  const targetLabel = copy(language, "target", "対象");
  const stateLabel = displayStateLabel(state, language);
  const motion = renderActionStateMotion(state, color, theme, input.animationFrame ?? 0);
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(identity)} ${escapeXml(stateLabel)}">
    ${renderFlatKeyBase(surface, theme, color, input.selected)}
    <text data-action-identity="${escapeXml(identity)}" x="16" y="27" font-family="${DISPLAY_FONT}" font-size="${fitTitleFont(identity, 15)}" font-weight="700" fill="${surface.title}">${escapeXml(identity)}</text>
    <line x1="16" y1="35" x2="128" y2="35" stroke="${surface.innerBorder}" stroke-width="1"/>
    <text x="16" y="53" font-family="${DISPLAY_FONT}" font-size="9" font-weight="700" fill="${surface.muted}">${escapeXml(currentLabel)}</text>
    <text data-action-current="${escapeXml(current)}" x="16" y="86" font-family="${DISPLAY_FONT}" font-size="29" font-weight="750" fill="${surface.title}">${escapeXml(current)}</text>
    <text x="16" y="101" font-family="${DISPLAY_FONT}" font-size="9" font-weight="700" fill="${surface.muted}">${escapeXml(targetLabel)}</text>
    <text data-action-target="${escapeXml(targetLines[0] ?? target)}" x="128" y="101" text-anchor="end" font-family="${DISPLAY_FONT}" font-size="10" font-weight="600" fill="${surface.muted}">${escapeXml(targetLines[0] ?? target)}</text>
    ${detailMarkup}
    ${motion}
    <text data-action-state="${state}" x="16" y="130" font-family="${MONO_FONT}" font-size="10" font-weight="750" fill="${color}">${escapeXml(stateLabel)}</text>
  </svg>`);
}

/** Physical slot identity remains primary while a native keycap is observed. */
export function renderPhysicalActionKey(input: PhysicalActionRenderInput): string {
  const observed = input.observedLabel == null || !input.observedLabel.trim() ? null : input.observedLabel;
  const state = input.state ?? (observed ? "ready" : "unavailable");
  const language = input.language;
  return renderActionKey({
    identity: input.slot,
    current: input.current ?? observed,
    target: input.target ?? (observed ? copy(language, "assignmentConfirmed", "割当確認済み") : copy(language, "assignmentUnavailable", "割当未取得")),
    state,
    ...(input.detail == null ? {} : { detail: input.detail }),
    ...(input.theme == null ? {} : { theme: input.theme }),
    ...(input.language == null ? {} : { language: input.language }),
    ...(input.animationFrame == null ? {} : { animationFrame: input.animationFrame })
  });
}

/**
 * Add action feedback to an existing key image without changing its primary
 * identity. The helper accepts either an encoded SVG data URL returned by a
 * renderer in this module or a raw SVG string, and always returns a data URL.
 * A prior renderer state footer is removed before the single operation state
 * is painted, so a held/pending/error state cannot be shown twice.
 */
export const KEY_CONTACT_DURATION_MS = 320;

/** Brief input acknowledgement; it never changes the operation or its label. */
export function renderKeyContact(image: string, phase: "press" | "release", ageMs: number, theme: ThemeMode): string {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= KEY_CONTACT_DURATION_MS) return image;
  const t = ageMs / KEY_CONTACT_DURATION_MS;
  const ease = 1 - (1 - t) ** 3;
  const scale = phase === "press" ? .92 + .08 * ease
    : 1 - .06 * (1 - t) ** 2 + .035 * Math.sin(Math.PI * t);
  let source = decodeSvgImage(image).replace(/(<g\b[^>]*data-icon-source="[^"]*"[^>]*transform=")([^"]*)(")/g,
    (_match, before: string, transform: string, after: string) => `${before}translate(${(72 * (1 - scale)).toFixed(3)} ${(61 * (1 - scale)).toFixed(3)}) scale(${scale.toFixed(4)}) ${transform}${after}`);
  const inset = phase === "press" ? 16 - 9 * ease : 9 + 3 * ease;
  const opacity = ageMs <= 90 ? 1 : (KEY_CONTACT_DURATION_MS - ageMs) / (KEY_CONTACT_DURATION_MS - 90);
  const keyId = /data-keycap-id="([^"]+)"/.exec(source)?.[1] ?? '';
  const kind = keyMotionKind(keyId, source);
  const color = motionAccent(kind, theme);
  // A planar tint and narrow moving reflection keep the feedback material-like;
  // no circular bloom is used on the compact key surface.
  const sweepX = -26 + 190 * ease;
  const wash = `<defs><linearGradient id="contact-glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}" stop-opacity=".48"/><stop offset=".55" stop-color="${color}" stop-opacity=".17"/><stop offset="1" stop-color="${color}" stop-opacity=".05"/></linearGradient><clipPath id="key-contact-clip"><rect x="8" y="8" width="128" height="128" rx="14"/></clipPath></defs><g data-contact-layer="true" clip-path="url(#key-contact-clip)"><rect data-contact-wash="true" x="11" y="11" width="122" height="100" rx="17" fill="url(#contact-glass)" opacity="${opacity.toFixed(3)}"/><path data-contact-sweep="true" d="M${sweepX.toFixed(2)} 5l48 112" stroke="${theme === 'dark' ? '#FFFFFF' : color}" stroke-width="18" stroke-linecap="round" opacity="${(.10 * opacity).toFixed(3)}"/><path d="M${(sweepX + 9).toFixed(2)} 5l48 112" stroke="${theme === 'dark' ? '#FFFFFF' : color}" stroke-width="2" stroke-linecap="round" opacity="${(.72 * opacity).toFixed(3)}"/></g>`;
  source = source.replace('<!--key-content-->', wash);
  source = source.replace(/<g\b[^>]*data-icon-source="[^"]*"[^>]*>/, (glyph) => {
    const illuminated = glyph.replace(/\b(stroke|color)="#[0-9a-fA-F]+"/g,
      (_attribute, name: string) => `${name}="${theme === 'dark' ? '#FFFFFF' : color}"`);
    return illuminated;
  });
  const size = 144 - inset * 2;
  const trace = `<g data-key-contact="${phase}" data-contact-age="${ageMs.toFixed(1)}" fill="none" stroke-opacity="${opacity.toFixed(3)}"><rect x="${inset.toFixed(2)}" y="${inset.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${(22 - 5 * ease).toFixed(2)}" stroke="${color}" stroke-width="14" opacity=".24"/><rect x="${inset.toFixed(2)}" y="${inset.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${(22 - 5 * ease).toFixed(2)}" stroke="${color}" stroke-width="4.2" opacity=".88"/><path data-contact-specular="true" d="M${(inset + 20).toFixed(2)} ${inset.toFixed(2)}H${(144 - inset - 20).toFixed(2)}" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/></g>`;
  return toDataUrl(source.replace(/<\/svg>\s*$/i, `${trace}</svg>`));
}

export function renderActionFeedback(baseImage: string, feedback: OperationFeedback, theme: ThemeMode = "dark", language?: DisplayLanguage, animationFrame = 0): string {
  const source = decodeSvgImage(baseImage);
  const withoutState = source
    .replace(/<text\b[^>]*data-action-state="[^"]*"[^>]*>[\s\S]*?<\/text>/g, "")
    .replace(/<text\b[^>]*data-agent-status-label="[^"]*"[^>]*>[\s\S]*?<\/text>/g, "")
    .replace(/<text\b[^>]*data-reset-state-label="[^"]*"[^>]*>[\s\S]*?<\/text>/g, "");
  const surface = SURFACES[theme];
  const color = operationFeedbackColor(feedback.phase, theme);
  const label = operationFeedbackLabel(feedback.phase, language);
  const detail = operationFeedbackDetail(feedback, language);
  const progress = typeof feedback.progress === "number" && Number.isFinite(feedback.progress) ? Math.max(0, Math.min(1, feedback.progress)) : undefined;
  const progressMarkup = progress == null ? "" : `<rect data-operation-progress="${progress.toFixed(3)}" x="16" y="115" width="112" height="3" rx="1.5" fill="${surface.innerBorder}"/><rect x="16" y="115" width="${(112 * progress).toFixed(2)}" height="3" rx="1.5" fill="${color}"/>`;
  const operationMotion = renderOperationMotion(feedback.phase, color, animationFrame);
  const motion = source.includes('data-key-label="true"')
    ? operationMotion.replace('M58 108h28', 'M58 94h28')
    : operationMotion;
  const heldGlyph = feedback.phase === "held"
    ? withoutState.replace(/(<g\b[^>]*data-icon-source="[^"]*"[^>]*transform=")([^"]*)(")/g,
      '$1translate(7.2 7.2) scale(.90) $2$3')
    : withoutState;
  const interactiveGlyph = animateCatalogGlyph(heldGlyph, feedback.phase, animationFrame);
  const feedbackMarkup = `<g data-operation-phase="${feedback.phase}"${feedback.operationId ? ` data-operation-id="${escapeXml(feedback.operationId)}"` : ""}${feedback.target ? ` data-operation-target="${escapeXml(feedback.target)}"` : ""}${detail ? ` data-operation-detail="${escapeXml(detail)}"` : ""}>
    <rect x="12" y="118" width="120" height="18" rx="5" fill="${surface.keyMiddle}" stroke="${color}" stroke-width="1.5"/>
    ${progressMarkup}
    ${motion}
    <text x="18" y="131" font-family="${MONO_FONT}" font-size="9" font-weight="750" fill="${color}">${escapeXml(label)}</text>
    ${detail ? `<text data-operation-detail-text="true" x="126" y="131" text-anchor="end" font-family="${DISPLAY_FONT}" font-size="7" font-weight="650" fill="${surface.muted}">${escapeXml(detail)}</text>` : ""}
  </g>`;
  return toDataUrl(interactiveGlyph.replace(/<\/svg>\s*$/i, `${feedbackMarkup}</svg>`));
}

function animateCatalogGlyph(svg: string, phase: OperationFeedbackPhase, animationFrame: number): string {
  if (phase !== "held" && phase !== "pending") return svg;
  const id = /data-keycap-id="([^"]+)"/.exec(svg)?.[1];
  if (!id) return svg;
  const wave = Math.sin(normalizedAnimationFrame(animationFrame) * Math.PI / 6);
  let transform: string;
  if (["CODEX", "UPL", "YEET"].includes(id)) {
    transform = `translate(0 ${(-8 * wave).toFixed(2)})`;
  } else if (["FAST", "NAV", "SPLIT", "PARTY"].includes(id)) {
    transform = `translate(${(6 * wave).toFixed(2)} 0)`;
  } else if (["SETUP", "LAB"].includes(id)) {
    transform = `rotate(${(9 * wave).toFixed(2)} 72 61)`;
  } else {
    // A small optical response, not a fabricated meter or completion signal.
    const scale = 1 - .04 * (1 - Math.cos(normalizedAnimationFrame(animationFrame) * Math.PI / 6));
    transform = `translate(${(72 * (1 - scale)).toFixed(3)} ${(61 * (1 - scale)).toFixed(3)}) scale(${scale.toFixed(4)})`;
  }
  const moved = svg.replace(/(<g\b[^>]*data-icon-source="microplus-original-catalog"[^>]*transform=")([^"]*)(")/,
    (_match, before: string, current: string, after: string) => `${before}${transform} ${current}${after}`);
  const t = normalizedAnimationFrame(animationFrame) / 12;
  let detail: string;
  if (id === "MIC" || id === "MIC1") {
    // Stylized recording activity, deliberately not an audio amplitude meter.
    const bars = [0, 1, 2, 3, 4, 5, 6].map((n) => {
      const envelope = 1 - Math.abs(n - 3) / 5;
      const height = 2 + envelope * (4 + 9 * (1 + Math.sin(t * Math.PI * 2 - n * .85)) / 2);
      return `<path d="M${3 + n * 3} ${(12 - height / 2).toFixed(2)}v${height.toFixed(2)}" opacity="${(.55 + envelope * .45).toFixed(2)}"/>`;
    }).join("");
    detail = `<g data-motion-kind="voice-wave" stroke-width="1.8" stroke-linecap="round">${bars}</g>`;
    return moved.replace(/(<g\b[^>]*data-icon-source="microplus-original-catalog"[^>]*>)([\s\S]*?)(<\/g>)/,
      (_match, opening: string, _body: string, closing: string) => `${opening}${detail}${closing}`);
  } else if (id === "DWN") {
    detail = `<rect data-motion-kind="copy-sheet" x="${(3 + 4 * t).toFixed(2)}" y="${(3 + 4 * t).toFixed(2)}" width="13" height="15" rx="2" opacity="${(.7 * (1 - t)).toFixed(2)}" stroke-width="1"/>`;
  } else if (["CODEX", "UPL", "YEET", "FAST"].includes(id)) {
    detail = `<path data-motion-kind="travel-trail" d="M8 22h8M10 25h4" opacity="${(.25 + .6 * Math.abs(wave)).toFixed(2)}" stroke-width="1"/>`;
  } else if (id === "TERM") {
    detail = `<path data-motion-kind="terminal-cursor" d="M12 15h5" stroke-width="2.5" opacity="${(.15 + .85 * Math.abs(wave)).toFixed(2)}"/>`;
  } else if (["GIT", "BRCH", "BRANCH", "MRG", "PR", "SPLIT"].includes(id)) {
    detail = `<circle data-motion-kind="branch-flow" cx="${(6 + 12 * t).toFixed(2)}" cy="${(18 - 12 * t).toFixed(2)}" r="1.3" fill="currentColor" stroke-width=".8"/>`;
  } else {
    detail = `<g data-motion-kind="activity-dots">${[0, 1, 2].map((n) => `<circle cx="${9 + n * 3}" cy="24" r=".65" opacity="${(.2 + .8 * (1 + Math.sin(t * Math.PI * 2 - n * 1.4)) / 2).toFixed(2)}"/>`).join("")}</g>`;
  }
  return moved.replace(/(<g\b[^>]*data-icon-source="microplus-original-catalog"[^>]*>)([\s\S]*?)(<\/g>)/,
    (_match, opening: string, body: string, closing: string) => `${opening}${body}${detail}${closing}`);
}

export function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

export type CustomizeKeyImageOptions = {
  /** Explicit primary label; empty labels leave the source title untouched. */
  label?: string;
  /** Numeric font size or the Property Inspector presets. */
  textSize?: number | "normal" | "large";
  /** Hide renderer-owned detail nodes while keeping the observed state. */
  showDetails?: boolean;
  language?: DisplayLanguage;
};

/**
 * Apply per-instance readability settings to a rendered key image.
 *
 * Only nodes emitted with a renderer-owned data attribute are replaced. An
 * imported SVG with no such node receives a clearly marked overlay instead of
 * having arbitrary text guessed or rewritten. Font size is applied to the
 * primary label node only; state, target, and observed value remain intact.
 */
export function customizeKeyImage(image: string, options: CustomizeKeyImageOptions = {}): string {
  const source = decodeSvgImage(image);
  if (!/<svg\b/i.test(source)) return image;

  let customized = source.replace(/<g\b[^>]*data-custom-label-layer="true"[^>]*>[\s\S]*?<\/g>/gi, "");
  if (options.showDetails === false) customized = removeDisplayDetails(customized);

  const requestedSize = customizeTextSize(options.textSize);
  if (requestedSize != null) customized = resizeRendererPrimaryLabels(customized, requestedSize);

  const rawLabel = options.label == null ? "" : sanitizeDisplayText(options.label);
  // A custom label is literal user copy. Language selection belongs to the
  // renderer's known labels and must not rewrite free-form text such as MIC.
  const label = rawLabel ? truncateDisplayText(rawLabel, 18, 12) : "";
  if (label) {
    let replacedPrimary = false;
    const keyLabel = /<text\b([^>]*\bdata-key-label="true"[^>]*)>[\s\S]*?<\/text>/i.exec(customized);
    if (keyLabel?.[0] && keyLabel[1] != null) {
      let attributes = setSvgAttribute(keyLabel[1], "data-custom-label", "true");
      attributes = setSvgAttribute(attributes, "font-size", fitCustomLabelFont(label, requestedSize ?? 12));
      customized = customized.replace(keyLabel[0], `<text${attributes}>${escapeXml(label)}</text>`);
      replacedPrimary = true;
    }

    const actionIdentity = /<text\b([^>]*\bdata-action-identity="[^"]*"[^>]*)>[\s\S]*?<\/text>/i.exec(customized);
    if (actionIdentity?.[0] && actionIdentity[1] != null) {
      let attributes = setSvgAttribute(actionIdentity[1], "data-action-identity", label);
      attributes = setSvgAttribute(attributes, "data-custom-label", "true");
      if (requestedSize != null) attributes = setSvgAttribute(attributes, "font-size", fitCustomLabelFont(label, requestedSize));
      const replacement = `<text${attributes}>${escapeXml(label)}</text>`;
      customized = customized.replace(actionIdentity[0], replacement);
      replacedPrimary = true;
    }

    if (!replacedPrimary) {
      const agentTitle = /<g\b([^>]*\bdata-agent-title="[^"]*"[^>]*)>[\s\S]*?<\/g>/i.exec(customized);
      if (agentTitle?.[0] && agentTitle[1] != null) {
        const fill = extractSvgAttribute(agentTitle[0], "fill") ?? SURFACES.dark.title;
        const fontSize = fitCustomLabelFont(label, requestedSize ?? 16);
        let attributes = setSvgAttribute(agentTitle[1], "data-agent-title", label);
        customized = customized.replace(agentTitle[0], `<g${attributes}><text data-custom-label="true" x="16" y="62" font-family="${DISPLAY_FONT}" font-size="${fontSize}" font-weight="650" fill="${escapeXml(fill)}">${escapeXml(label)}</text></g>`);
        replacedPrimary = true;
      }
    }

    if (!replacedPrimary) {
      const dialTitle = /<text\b([^>]*\bdata-dial-title="[^"]*"[^>]*)>[\s\S]*?<\/text>/i.exec(customized);
      if (dialTitle?.[0] && dialTitle[1] != null) {
        let attributes = setSvgAttribute(dialTitle[1], "data-dial-title", label);
        attributes = setSvgAttribute(attributes, "data-custom-label", "true");
        if (requestedSize != null) attributes = setSvgAttribute(attributes, "font-size", fitCustomLabelFont(label, requestedSize));
        customized = customized.replace(dialTitle[0], `<text${attributes}>${escapeXml(label)}</text>`);
        replacedPrimary = true;
      }
    }

    if (!replacedPrimary) {
      const fallbackGroup = /<g\b([^>]*\bdata-icon-source="fallback-label"[^>]*)>([\s\S]*?)<\/g>/i.exec(customized);
      if (fallbackGroup?.[0] && fallbackGroup[1] != null && fallbackGroup[2] != null) {
        let replacedFallback = false;
        const fallbackBody = fallbackGroup[2].replace(/<text\b([^>]*\bdata-icon-source="fallback-label"[^>]*)>[\s\S]*?<\/text>/gi, (_match: string, attributes: string) => {
          if (replacedFallback) return "";
          let updated = setSvgAttribute(attributes, "data-custom-label", "true");
          updated = setSvgAttribute(updated, "font-size", fitCustomLabelFont(label, requestedSize ?? 16));
          replacedFallback = true;
          return `<text${updated}>${escapeXml(label)}</text>`;
        });
        if (replacedFallback) {
          customized = customized.replace(fallbackGroup[0], `<g${fallbackGroup[1]}>${fallbackBody}</g>`);
          replacedPrimary = true;
        }
      }
    }

    if (!replacedPrimary) {
      const theme = /data-theme="(light|dark)"/i.exec(customized)?.[1] === "light" ? "light" : "dark";
      const fill = SURFACES[theme].title;
      const fontSize = fitCustomLabelFont(label, requestedSize ?? 16);
      const overlay = `<g data-custom-label-layer="true"><text data-custom-label="true" x="72" y="76" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="${fontSize}" font-weight="700" fill="${fill}">${escapeXml(label)}</text></g>`;
      customized = customized.replace(/<\/svg>\s*$/i, `${overlay}</svg>`);
    }
  }

  // Preserve a caller's raw SVG form only when it was not a data URL; the
  // Stream Deck SDK accepts the encoded form for both input variants.
  return toDataUrl(customized);
}

function removeDisplayDetails(svg: string): string {
  return svg
    .replace(/\sdata-operation-detail="[^"]*"/gi, "")
    .replace(/<text\b(?=[^>]*(?:data-action-detail|data-reset-detail|data-dial-detail|data-operation-detail-text|data-context-compaction-detail|data-custom-detail)(?:\s|=|>))[^>]*>[\s\S]*?<\/text>/gi, "");
}

function customizeTextSize(size: CustomizeKeyImageOptions["textSize"]): number | undefined {
  if (typeof size === "number" && Number.isFinite(size)) return Math.max(8, Math.min(32, size));
  if (size === "large") return 19;
  if (size === "normal") return 15;
  return undefined;
}

function fitCustomLabelFont(label: string, requested: number): string {
  const width = Math.max(displayWidth(label), 1);
  return Math.max(8, Math.min(requested, 112 / width)).toFixed(2);
}

function resizeRendererPrimaryLabels(svg: string, requested: number): string {
  const resizeText = (full: string, attributes: string, body: string): string => {
    const visible = decodeSvgText(body.replace(/<[^>]+>/g, ""));
    if (!visible) return full;
    const updated = setSvgAttribute(attributes, "font-size", fitCustomLabelFont(visible, requested));
    return `<text${updated}>${body}</text>`;
  };
  let result = svg.replace(/<text\b([^>]*\bdata-action-identity="[^"]*"[^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
  result = result.replace(/<text\b([^>]*\bdata-key-label="true"[^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
  result = result.replace(/(<g\b[^>]*\bdata-agent-title="[^"]*"[^>]*>)([\s\S]*?)(<\/g>)/gi, (_full: string, opening: string, body: string, closing: string) => {
    const resized = body.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
    return `${opening}${resized}${closing}`;
  });
  result = result.replace(/<text\b([^>]*\bdata-dial-title="[^"]*"[^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
  result = result.replace(/<text\b([^>]*\bdata-custom-label="true"[^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
  result = result.replace(/<text\b([^>]*\bdata-icon-source="fallback-label"[^>]*)>([\s\S]*?)<\/text>/gi, resizeText);
  return result;
}

function decodeSvgText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function setSvgAttribute(attributes: string, name: string, value: string): string {
  const escaped = escapeXml(value);
  const expression = new RegExp(`\\b${name}="[^"]*"`, "i");
  return expression.test(attributes)
    ? attributes.replace(expression, `${name}="${escaped}"`)
    : `${attributes} ${name}="${escaped}"`;
}

function extractSvgAttribute(markup: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`, "i").exec(markup)?.[1];
}

export function renderImportedKeycap(svg: string, theme: ThemeMode = "light"): string {
  const viewBox = svg.match(/viewBox=["']([^"']+)["']/i)?.[1];
  const rootAttributes = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1];
  if (!viewBox || !body || !/^[\d.\s-]+$/.test(viewBox)) throw new Error("The imported SVG has no usable viewBox.");
  const values = viewBox.trim().split(/\s+/).map(Number);
  if (values.length !== 4) throw new Error("The imported SVG viewBox is invalid.");
  const [minX = 0, minY = 0, width = 0, height = 0] = values;
  if (![minX, minY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("The imported SVG dimensions are invalid.");

  const surface = SURFACES[theme];
  const glyphColor = theme === "dark" ? "#F2F5F7" : "#172027";
  const size = 88;
  const scale = Math.min(size / width, size / height);
  const x = 28 + (size - width * scale) / 2 - minX * scale;
  const y = 28 + (size - height * scale) / 2 - minY * scale;
  const glyph = body
    .replaceAll("currentColor", glyphColor)
    .replace(/#(?:000000|000|ffffff|fff)\b/gi, glyphColor)
    .replace(/\b(?:black|white)\b/gi, glyphColor);
  const inheritedFill = rootAttributes.match(/\bfill=["'](?:currentColor|#000(?:000)?|#fff(?:fff)?|black|white)["']/i) ? glyphColor : "none";

  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${renderFlatKeyBase(surface, theme)}
    <g data-icon-source="local-user-file" transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})" fill="${inheritedFill}" color="${glyphColor}">${glyph}</g>
  </svg>`);
}

export function renderCatalogKeycap(id: string, theme: ThemeMode = "dark", language: DisplayLanguage = "ja"): string | undefined {
  if (!Object.hasOwn(KEY_ICON_CATALOG, id)) return undefined;
  const icon = KEY_ICON_CATALOG[id as OfficialKeycapId];
  const surface = SURFACES[theme];
  const label = language === "ja" ? icon.ja : icon.en;
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(label)}">
    ${renderFlatKeyBase(surface, theme)}
    <g data-icon-source="microplus-original-catalog" data-keycap-id="${escapeXml(id)}" transform="translate(38 27) scale(2.8333)" color="${surface.title}" fill="none" stroke="${surface.title}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icon.glyph}</g>
    <text data-key-label="true" x="72" y="111" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="12" font-weight="600" fill="${surface.muted}">${escapeXml(label)}</text>
  </svg>`);
}

export function renderBuiltinKeycap(name: BuiltinIconName, theme: ThemeMode = "light", language?: DisplayLanguage): string {
  const surface = SURFACES[theme];
  const glyphColor = theme === "dark" ? "#F2F5F7" : "#172027";
  const labels: Record<BuiltinIconName, [string, string]> = {
    up: ["上へ", "UP"], encoder: ["押下", "CLICK"], back: ["左へ", "LEFT"], forward: ["右へ", "RIGHT"],
    sidebar: ["下へ", "DOWN"], home: ["新規", "NEW CHAT"], navigation: ["移動", "NAVIGATE"],
    "side-to-main": ["メインへ移す", "MOVE TO MAIN"],
  };
  const glyphs: Record<BuiltinIconName, string> = {
    up: `<path d="M46 60l26-26 26 26M72 35v62"/>`,
    encoder: `<circle cx="72" cy="65" r="27"/><path d="M72 23v23m-8-8 8 8 8-8"/><circle cx="72" cy="67" r="3"/>`,
    back: `<path d="M88 36L58 62l30 26M59 62h41"/>`,
    forward: `<path d="M56 36l30 26-30 26M44 62h41"/>`,
    sidebar: `<path d="M46 66l26 26 26-26M72 30v61"/>`,
    home: `<path d="M40 60l32-27 32 27M50 56v35h44V56M65 91V70h14v21"/>`,
    navigation: `<circle cx="58" cy="48" r="6"/><circle cx="86" cy="48" r="6"/><circle cx="58" cy="76" r="6"/><circle cx="86" cy="76" r="6"/>`,
    "side-to-main": `<rect x="29" y="29" width="51" height="62" rx="8"/><path d="M91 36h16v50H91M108 61H51m12-12L51 61l12 12"/>`
  };
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${renderFlatKeyBase(surface, theme)}
    <g data-icon-source="codex-deck-original" fill="none" stroke="${glyphColor}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 0)">${glyphs[name]}</g>
    <text data-key-label="true" x="72" y="111" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="12" font-weight="600" fill="${surface.muted}">${escapeXml(labels[name][language === "en" ? 1 : 0])}</text>
  </svg>`);
}

export function renderFallbackKeycap(keycapId: string, theme: ThemeMode = "light", language?: DisplayLanguage): string {
  const surface = SURFACES[theme];
  const display = localizeFallbackKeycap(keycapId, language);
  const lines = /^ACT11\s+無効$/u.test(display)
    ? ["ACT11", "無効"]
    : /^ACT11\s+OFF$/u.test(display)
      ? ["ACT11", "OFF"]
      : splitDisplayLines(display, 9, 2, language);
  const widest = Math.max(...lines.map(displayWidth), 1);
  const fontSize = Math.max(15, Math.min(23, 112 / widest));
  const firstY = lines.length === 1 ? 78 : 66;
  // Keep each physical line as its own text node. macOS sips can mis-rasterize
  // centered multi-line tspans as one very wide glyph run, which clips ACT11
  // at the native 144px LCD edge even though the SVG advance is bounded.
  const label = lines.map((line, index) => `<text data-icon-source="fallback-label" data-keycap-id="${escapeXml(keycapId)}" x="72" y="${firstY + index * 24}" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="${fontSize.toFixed(2)}" font-weight="700" fill="${surface.title}">${escapeXml(line)}</text>`).join("");
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(display)}">
    ${renderFlatKeyBase(surface, theme)}
    <g data-icon-source="fallback-label" data-keycap-id="${escapeXml(keycapId)}" transform="translate(0 0)" color="${surface.title}">${label}</g>
  </svg>`);
}

export function renderHostTargetKey(label: "WIN" | "MAC", health: HostHealthState, theme: ThemeMode = "dark", language?: DisplayLanguage): string {
  const surface = SURFACES[theme];
  const signal = health === "ready" ? SIGNAL_COLORS[theme].complete : stateSignal(health, theme);
  const status = localizedHostHealthLabel(health, language);
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${label} ${status}">
    ${renderFlatKeyBase(surface, theme, signal)}
    <text x="72" y="72" text-anchor="middle" font-family="${MONO_FONT}" font-size="27" font-weight="750" fill="${surface.title}">${label}</text>
    <text data-host-health-label="${health}" x="72" y="111" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="11" font-weight="700" fill="${signal}">${status}</text>
  </svg>`);
}

export function renderUsageLimitKey(
  window: UsageWindow | undefined,
  requestedKind: UsageWindowKind,
  theme: ThemeMode = "dark",
  health: HostHealthState = "ready",
  freshness?: UsageFreshness,
  language?: DisplayLanguage
): string {
  const surface = SURFACES[theme];
  const remaining = window && Number.isFinite(window.remainingPercent) ? Math.round(clampPercent(window.remainingPercent)) : null;
  const state = usageDisplayState(remaining, health, freshness);
  // A timestamp-free snapshot can still expose a value, but degraded/offline
  // or explicitly stale data must never look current on the key.
  const visibleRemaining = state === "ready" || state === "unknown" ? remaining : null;
  const signal = usageSignal(remaining, health, theme, state);
  const track = theme === "dark" ? "#34404A" : "#AAB7BE";
  const circumference = 2 * Math.PI * 40;
  const dash = remaining == null ? 0 : circumference * remaining / 100;
  const label = localizedUsageLabel(window?.kind ?? requestedKind, language);
  const digits = visibleRemaining == null ? 0 : String(visibleRemaining).length;
  const numberX = digits >= 3 ? 61 : digits === 2 ? 65 : 69;
  const fontSize = digits >= 3 ? 27 : 30;
  const missingLabel = copy(language, "notAcquired", "未取得");
  const missing = visibleRemaining == null ? `<text data-usage-message="${escapeXml(missingLabel)}" x="72" y="96" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="10" font-weight="700" fill="${surface.muted}">${escapeXml(missingLabel)}</text>` : "";
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(label)} ${escapeXml(displayStateLabel(state, language))}">
    ${renderFlatKeyBase(surface, theme, signal)}
    <text data-usage-state="${state}" x="120" y="25" text-anchor="end" font-family="${MONO_FONT}" font-size="8" font-weight="750" fill="${signal}">${escapeXml(displayStateLabel(state, language))}</text>
    <circle cx="72" cy="70" r="40" fill="none" stroke="${track}" stroke-width="7"/>
    ${visibleRemaining == null ? "" : `<circle data-usage-remaining="${visibleRemaining}" cx="72" cy="70" r="40" fill="none" stroke="${signal}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(circumference * visibleRemaining / 100).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 72 70)"/>`}
    ${visibleRemaining == null
      ? `<text x="72" y="80" text-anchor="middle" font-family="${MONO_FONT}" font-size="31" font-weight="700" fill="${signal}">—</text>`
      : `<text data-usage-value="${visibleRemaining}" x="${numberX}" y="80" text-anchor="middle" fill="${surface.title}" font-family="${MONO_FONT}" font-size="${fontSize}" font-weight="750">${visibleRemaining}</text><text x="92" y="80" fill="${signal}" font-family="${MONO_FONT}" font-size="12" font-weight="750">%</text>`}
    ${missing}
    <text data-key-label="true" x="16" y="25" text-anchor="start" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="700">${escapeXml(label)}</text>
  </svg>`);
}

export function renderUsageOverviewKey(
  usageWindows: UsageWindow[],
  theme: ThemeMode = "dark",
  health: HostHealthState = "ready",
  freshness?: UsageFreshness,
  language?: DisplayLanguage
): string {
  const surface = SURFACES[theme];
  const fiveHour = usageWindows.find((window) => window.kind === "five-hour");
  const weekly = usageWindows.find((window) => window.kind === "weekly");
  const state = usageDisplayState(fiveHour?.remainingPercent ?? weekly?.remainingPercent ?? null, health, freshness);
  const usageLabel = copy(language, "usage", "使用量");
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(usageLabel)} ${escapeXml(displayStateLabel(state, language))}">
    ${renderFlatKeyBase(surface, theme, usageSignal(null, health, theme, state))}
    <text data-key-label="true" x="16" y="25" text-anchor="start" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="700">${escapeXml(usageLabel)}</text>
    <text data-usage-health="${health}" data-usage-state="${state}" x="120" y="25" text-anchor="end" font-family="${MONO_FONT}" font-size="8" font-weight="750" fill="${usageSignal(null, health, theme, state)}">${escapeXml(displayStateLabel(state, language))}</text>
    ${renderUsageBar("5H", fiveHour, 48, surface, theme, health, state, language)}
    ${renderUsageBar("WK", weekly, 91, surface, theme, health, state, language)}
  </svg>`);
}

/**
 * Render the active task's context usage and compaction control.
 *
 * The percentage is an observed session-ownership value. Missing or invalid
 * values stay visibly unknown; they are never coerced to zero. Compaction is
 * a separate lifecycle state so the pending animation cannot be mistaken for
 * a changed context reading.
 */
export function renderContextCompactionKey(input: ContextCompactionRenderInput = {}): string {
  const theme = input.theme ?? "dark";
  const language = input.language;
  const health = input.health ?? "ready";
  const observed = finiteContextPercent(input.contextUsedPercent);
  const state = input.state ?? (health !== "ready" ? healthToDisplayState(health) : observed == null ? "unknown" : "ready");
  const surface = SURFACES[theme];
  const color = stateColor(state, theme);
  const track = theme === "dark" ? "#34404A" : "#AAB7BE";
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const visibleValue = observed == null ? null : observed;
  const dash = visibleValue == null ? 0 : circumference * visibleValue / 100;
  const frame = normalizedAnimationFrame(input.animationFrame ?? 0);
  const stateLabel = displayStateLabel(state, language);
  const title = language === "en" ? "CONTEXT" : "コンテキスト";
  const usageLabel = language === "en" ? "USED" : "使用量";
  const value = visibleValue == null ? "—" : `${visibleValue}%`;
  const detail = contextCompactionDetail(input.detail, language, state);
  const motion = renderContextCompactionMotion(state, color, theme, frame);
  const revisionMarkup = input.contextRevision == null || !Number.isFinite(input.contextRevision)
    ? ""
    : ` data-context-revision="${Math.max(0, Math.floor(input.contextRevision))}"`;
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(`${title} ${stateLabel}`)}">
    ${renderFlatKeyBase(surface, theme, color)}
    <text data-key-label="true" x="16" y="25" text-anchor="start" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="700">${escapeXml(title)}</text>
    <g data-context-compaction-gauge="true" data-context-compaction-state="${state}"${revisionMarkup}>
      <circle cx="72" cy="70" r="${radius}" fill="none" stroke="${track}" stroke-width="9"/>
      ${visibleValue == null ? "" : `<circle data-context-used="${visibleValue}" cx="72" cy="70" r="${radius}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 72 70)"/>`}
      <circle cx="72" cy="70" r="31" fill="${surface.keyMiddle}" fill-opacity=".92" stroke="${surface.innerBorder}" stroke-width="1"/>
      <text data-context-compaction-value="${escapeXml(value)}" x="72" y="76" text-anchor="middle" fill="${visibleValue == null ? color : surface.title}" font-family="${MONO_FONT}" font-size="${visibleValue == null ? 31 : 27}" font-weight="800">${escapeXml(value)}</text>
      <text x="72" y="94" text-anchor="middle" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9" font-weight="700">${escapeXml(usageLabel)}</text>
      ${motion}
    </g>
    ${detail ? `<text data-context-compaction-detail="${escapeXml(detail)}" x="72" y="117" text-anchor="middle" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="650">${escapeXml(detail)}</text>` : ""}
    <text data-context-compaction-state-label="${state}" x="16" y="130" fill="${color}" font-family="${MONO_FONT}" font-size="10" font-weight="750">${escapeXml(stateLabel)}</text>
  </svg>`);
}

export function renderRateLimitResetKey(
  available: number | null,
  holdProgress = 0,
  theme: ThemeMode = "dark",
  health: HostHealthState = "ready",
  options?: RateLimitResetDisplayOptions,
  language?: DisplayLanguage,
  animationFrame = 0
): string {
  const surface = SURFACES[theme];
  const count = available == null ? null : Math.max(0, Math.floor(available));
  const progress = clampPercent(holdProgress * 100);
  const state = options?.state ?? (progress > 0 ? "holding" : health === "ready" ? "ready" : healthToDisplayState(health));
  const visibleCount = health === "ready" && (state === "ready" || state === "holding") ? count : null;
  const signal = stateColor(state, theme);
  const glyph = visibleCount != null && visibleCount > 0 ? surface.title : surface.muted;
  const detail = options?.detail ? truncateDisplayText(options.detail, 16, 14) : visibleCount == null ? copy(language, "notAcquired", "未取得") : copy(language, "resetCredits", "利用可能回数");
  const progressDash = 2 * Math.PI * 51 * progress / 100;
  const resetLabel = language == null ? "レート制限" : language === "ja" ? "レート制限" : "RATE LIMIT";
  const motion = renderActionStateMotion(state, signal, theme, animationFrame);
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(resetLabel)} ${escapeXml(displayStateLabel(state, language))}">
    ${renderFlatKeyBase(surface, theme, signal)}
    <text data-key-label="true" x="16" y="25" text-anchor="start" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="700">${escapeXml(resetLabel)}</text>
    <text data-reset-state="${state}" x="120" y="25" text-anchor="end" font-family="${MONO_FONT}" font-size="8" font-weight="750" fill="${signal}">${escapeXml(displayStateLabel(state, language))}</text>
    <g transform="translate(34 30) scale(3.15)" fill="none" stroke="${glyph}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>
    </g>
    <text data-reset-credits="${visibleCount ?? "unknown"}" x="72" y="79" text-anchor="middle" fill="${surface.title}" font-family="${MONO_FONT}" font-size="23" font-weight="750">${visibleCount == null ? "—" : visibleCount > 99 ? "99+" : visibleCount}</text>
    <text data-reset-detail="${escapeXml(detail)}" x="72" y="104" text-anchor="middle" fill="${surface.muted}" font-family="${DISPLAY_FONT}" font-size="9.5" font-weight="650">${escapeXml(detail)}</text>
    ${progress > 0 ? `<circle data-reset-hold="${progress.toFixed(0)}" cx="72" cy="69" r="51" fill="none" stroke="${SIGNAL_COLORS[theme].thinking}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${progressDash.toFixed(2)} ${(2 * Math.PI * 51).toFixed(2)}" transform="rotate(-90 72 69)"/>` : ""}
    ${motion}
    <text data-reset-state-label="${state}" x="16" y="130" font-family="${MONO_FONT}" font-size="10" font-weight="750" fill="${signal}">${escapeXml(displayStateLabel(state, language))}</text>
  </svg>`);
}

/** Build the typed Plus LCD payload used by controller/repair_input. */
export function renderPlusDialFeedback(input: PlusDialFeedbackInput): MicroPlusFeedback {
  const health = input.health ?? "ready";
  const theme = input.theme ?? "dark";
  const inferredState = input.state ?? inferDialState(input, health);
  const count = Math.max(1, input.slotCount ?? 6);
  let title: string;
  let value: string;
  let detail: string;
  let progress: number | undefined;
  if (input.kind === "agents") {
    const slot = Math.max(0, input.slot ?? 0);
    title = `${copy(input.language, "task", "タスク")} ${String(slot + 1).padStart(2, "0")}/${String(count).padStart(2, "0")}`;
    value = semanticValueAllowed(health, inferredState) ? truncateDisplayText(input.taskTitle ?? copy(input.language, "titleUnavailable", "タイトル未取得"), 18, 18) : "—";
    detail = input.detail?.trim() || (input.agentStatus ? agentStatusLabel(input.agentStatus, "ready", input.language) : copy(input.language, "targetUnavailable", "対象未取得"));
    progress = finitePercent(input.contextUsedPercent);
  } else if (input.kind === "reasoning") {
    title = input.language === "en" ? "REASONING" : "思考レベル";
    value = !semanticValueAllowed(health, inferredState) || input.observedValue == null
      ? "—"
      : truncateDisplayText(String(input.observedValue), 12, 12);
    detail = input.operation?.trim()
      ? `${input.language === "en" ? "ACTION" : "操作"}: ${localizeOperation(input.operation, input.language)}`
      : input.detail?.trim() || (input.language === "en" ? "Turn to adjust" : "回転で調整");
  } else if (input.kind === "commands") {
    title = copy(input.language, "commandSelection", "操作選択");
    value = semanticValueAllowed(health, inferredState) && input.observedValue != null
      ? truncateDisplayText(String(input.observedValue), 12, 12)
      : "—";
    detail = input.detail?.trim() || (input.observedValue == null
      ? copy(input.language, "valueUnavailable", "値未取得")
      : copy(input.language, "currentValue", "現在値"));
  } else if (input.kind === "usage") {
    title = copy(input.language, "usage", "使用量");
    // A cached reading remains useful while its freshness is shown separately.
    value = health === "ready" && !["offline", "unavailable", "unknown", "error", "connecting"].includes(inferredState) && input.observedValue != null
      ? truncateDisplayText(String(input.observedValue), 12, 12)
      : "—";
    detail = input.detail?.trim() || (input.observedValue == null
      ? copy(input.language, "valueUnavailable", "値未取得")
      : copy(input.language, "currentValue", "現在値"));
  } else if (input.kind === "model") {
    title = copy(input.language, "model", "モデル");
    value = (health === "ready" && !["offline", "stale", "unavailable"].includes(inferredState)) && input.observedValue != null
      ? truncateDisplayText(String(input.observedValue), 12, 12)
      : "—";
    detail = input.detail?.trim() || (input.language === "en" ? "Turn to change model" : "回転ですぐ変更");
  } else {
    title = input.language === "en" ? "NAVIGATION" : "左右操作";
    value = semanticValueAllowed(health, inferredState) ? truncateDisplayText(input.activeThreadTitle ?? copy(input.language, "titleUnavailable", "タイトル未取得"), 18, 18) : "—";
    detail = input.detail?.trim() || (input.target?.trim() ? truncateDisplayText(input.target, 18, 15) : copy(input.language, "settingDependent", "設定依存"));
  }
  const icon = input.kind === "agents"
    ? renderAgentDialIcon(input.agentStatus ?? "unknown", theme, input.animationFrame ?? 0, input.slot, input.language)
    : renderDialControlIcon(input.kind, inferredState, theme, input.animationFrame ?? 0, input.interactionAgeMs, input.interactionDirection);
  const feedback: MicroPlusFeedback = {
    title,
    value,
    detail,
    status: inferredState,
    ...(progress == null ? {} : { progress }),
    icon
  };
  return feedback;
}

/** Native dial-sized glyph: text remains in the LCD text fields. */
function renderDialControlIcon(kind: PlusDialFeedbackInput["kind"], state: MicroPlusFeedbackStatus, theme: ThemeMode, frame: number, age?: number, direction = 1): string {
  const color = stateColor(state, theme);
  const ink = SURFACES[theme].title;
  const paths: Record<string, string> = {
    model: '<path d="m32 13 17 10-17 10-17-10Z M15 32l17 10 17-10 M15 41l17 10 17-10"/>',
    reasoning: '<path d="M27 17c-11-5-18 9-11 16-7 9 2 20 11 15V17Zm10 0c11-5 18 9 11 16 7 9-2 20-11 15V17ZM18 26l9 4m-9 10 9-3m19-11-9 4m9 10-9-3"/>',
    commands: '<rect x="15" y="15" width="13" height="13" rx="3"/><rect x="36" y="15" width="13" height="13" rx="3"/><rect x="15" y="36" width="13" height="13" rx="3"/><path d="M36 42h13m-6-6v13"/>',
    usage: '<path d="M17 46a21 21 0 1 1 30 0 M32 32l11-13"/><circle cx="32" cy="32" r="3"/>',
    navigation: '<path d="m24 20-12 12 12 12m16-24 12 12-12 12M29 32h6"/>',
  };
  const active = state === "pending" || state === "pressed";
  const step = normalizedAnimationFrame(frame);
  const wave = Math.sin(step * Math.PI / 6);
  const reaction = age != null && Number.isFinite(age) && age >= 0 && age < DIAL_INTERACTION_DURATION_MS
    && !["error", "offline", "stale", "unavailable", "connecting"].includes(state);
  const reactionT = reaction ? age / DIAL_INTERACTION_DURATION_MS : 1;
  const settle = reaction ? (1 - reactionT) ** 2 : 0;
  const sign = direction < 0 ? -1 : 1;
  const springTravel = reaction
    ? sign * (11 * (1 - reactionT) ** 3 - 2.4 * Math.sin(reactionT * Math.PI) * (1 - reactionT))
    : 0;
  const springScale = reaction ? 1 - .15 * Math.max(0, 1 - reactionT * 5) + .035 * Math.sin(reactionT * Math.PI * 2) * (1 - reactionT) : 1;
  // Optical movement belongs to the control itself, not a generic spinner.
  const response = reaction ? `translate(${springTravel.toFixed(2)} 0) translate(32 32) scale(${springScale.toFixed(3)}) translate(-32 -32)`
    : !active ? "" : kind === "model" ? `translate(0 ${(wave * 1.5).toFixed(2)})`
    : kind === "navigation" ? `translate(${(wave * 2).toFixed(2)} 0)`
    : kind === "usage" ? `rotate(${(wave * 5).toFixed(2)} 32 32)`
    : `translate(32 32) scale(${(1 + wave * .025).toFixed(3)}) translate(-32 -32)`;
  const accent = reaction ? `<g data-dial-direction="${sign}" opacity="${dialInteractionStrength(age).toFixed(3)}"><g data-dial-trails="true" stroke="${motionAccent(kind, theme)}" stroke-linecap="round"><path d="M${sign > 0 ? 8 : 56} 22h${sign * 8}" stroke-width="2.4" opacity=".24"/><path d="M${sign > 0 ? 5 : 59} 30h${sign * 11}" stroke-width="3" opacity=".38"/><path d="M${sign > 0 ? 8 : 56} 38h${sign * 8}" stroke-width="2.4" opacity=".24"/></g><path d="${sign > 0 ? 'm27 49 6 6-6 6' : 'm37 49-6 6 6 6'}" fill="none" stroke="${motionAccent(kind, theme)}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".20"/><path d="${sign > 0 ? 'm27 49 6 6-6 6' : 'm37 49-6 6 6 6'}" fill="none" stroke="${theme === 'dark' ? '#FFFFFF' : motionAccent(kind, theme)}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></g>`
    : active ? `<path data-dial-motion="${step}" d="M23 57h18" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="${(.55 + .3 * (wave + 1) / 2).toFixed(2)}"/>` : "";
  const highlightX = 25 + 13 * (1 - settle) * sign;
  const glass = reaction ? `<defs><linearGradient id="dial-glass" x1="0" y1="0" x2="0.72" y2="1"><stop stop-color="${motionAccent(kind, theme)}" stop-opacity=".58"/><stop offset=".52" stop-color="${motionAccent(kind, theme)}" stop-opacity=".22"/><stop offset="1" stop-color="${motionAccent(kind, theme)}" stop-opacity=".08"/></linearGradient></defs><g data-dial-glass="true" opacity="${dialInteractionStrength(age).toFixed(3)}"><rect x="3.5" y="3.5" width="57" height="57" rx="18" fill="${motionAccent(kind, theme)}" opacity=".12"/><rect x="5" y="5" width="54" height="54" rx="16" fill="url(#dial-glass)" stroke="${motionAccent(kind, theme)}" stroke-opacity=".72" stroke-width="1.35"/><rect x="6.5" y="6.5" width="51" height="51" rx="14.5" fill="none" stroke="${theme === 'dark' ? '#FFFFFF' : motionAccent(kind, theme)}" stroke-opacity=".24" stroke-width=".8"/><path data-dial-specular="true" d="M${highlightX.toFixed(2)} 6h16" stroke="${motionAccent(kind, theme)}" stroke-width="6" stroke-linecap="round" opacity=".22"/><path d="M${highlightX.toFixed(2)} 6h16" stroke="${theme === 'dark' ? '#FFFFFF' : motionAccent(kind, theme)}" stroke-width="2.8" stroke-linecap="round"/></g>` : "";
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${glass}<g data-dial-glyph="${kind}" fill="none" stroke="${reaction ? motionAccent(kind, theme) : ink}" stroke-width="${reaction ? '2.7' : '2.25'}" stroke-linecap="round" stroke-linejoin="round" transform="translate(32 32) scale(${state === "pressed" ? '.84' : '1'}) translate(-32 -32)"><g transform="${response}">${paths[kind] ?? paths.navigation}</g></g>${accent}${["error", "offline", "stale", "unavailable"].includes(state) ? `<circle cx="54" cy="10" r="3" fill="${color}"/>` : ""}</svg>`);
}

/** Explicit reset color is required: SDK text overrides persist across frames. */
export const DIAL_INTERACTION_DURATION_MS = 360;

export function dialInteractionStrength(age?: number): number {
  if (age == null || !Number.isFinite(age) || age < 0 || age >= DIAL_INTERACTION_DURATION_MS) return 0;
  return age <= 70 ? 1 : (DIAL_INTERACTION_DURATION_MS - age) / (DIAL_INTERACTION_DURATION_MS - 70);
}

export function dialInteractionValueColor(theme: ThemeMode, age?: number): string {
  const rest = theme === "dark" ? [241, 245, 247] : [23, 32, 39];
  const accent = theme === "dark" ? [217, 242, 255] : [0, 102, 181];
  const t = dialInteractionStrength(age);
  return "#" + rest.map((channel, i) => Math.round(channel + (accent[i]! - channel) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Native 200×6 gap: input acknowledgement is neutral; pending is indeterminate. */
export function renderDialInteractionRibbon(state: MicroPlusFeedbackStatus, theme: ThemeMode, frame: number, interactionAgeMs?: number): string {
  const background = theme === "dark" ? "#141A20" : "#EEF2F4";
  const step = normalizedAnimationFrame(frame);
  const healthy = !["error", "offline", "stale", "unavailable", "connecting"].includes(state);
  const age = interactionAgeMs != null && Number.isFinite(interactionAgeMs) && interactionAgeMs >= 0 ? interactionAgeMs : DIAL_INTERACTION_DURATION_MS;
  let mark = "";
  if (healthy && age < DIAL_INTERACTION_DURATION_MS) {
    const t = age / DIAL_INTERACTION_DURATION_MS;
    const width = 72 + 104 * (1 - (1 - t) ** 3);
    mark = `<g data-dial-input="true" opacity="${dialInteractionStrength(age).toFixed(3)}"><rect x="${(94 - width / 2).toFixed(2)}" y="0" width="${(width + 12).toFixed(2)}" height="6" rx="3" fill="${dialInteractionValueColor(theme, age)}" opacity=".46"/><rect x="${(98 - width / 2).toFixed(2)}" y="1" width="${(width + 4).toFixed(2)}" height="4" rx="2" fill="${dialInteractionValueColor(theme, age)}" opacity=".44"/><rect x="${(100 - width / 2).toFixed(2)}" y="1.5" width="${width.toFixed(2)}" height="3" rx="1.5" fill="${theme === 'dark' ? '#FFFFFF' : '#0066B5'}"/></g>`;
  } else if (state === "pending" || state === "pressed") {
    const x = 20 + 130 * (1 - Math.cos(step * Math.PI / 6)) / 2;
    mark = `<rect data-dial-wait="${step}" x="${x.toFixed(2)}" y="2" width="30" height="2" rx="1" fill="${stateColor(state, theme)}" opacity=".7"/>`;
  }
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="6" viewBox="0 0 200 6"><rect width="200" height="6" fill="${background}"/>${mark}</svg>`);
}

/** Full 200x100 glass surface behind the native LCD fields. One image replaces
 * the former fixed background fragments, so the whole display can acknowledge
 * a physical turn without adding more render calls or moving its text. */
export function renderDialSurface(
  kind: PlusDialFeedbackInput["kind"],
  state: MicroPlusFeedbackStatus,
  theme: ThemeMode,
  interactionAgeMs?: number,
  direction = 1,
): string {
  const dark = theme === "dark";
  const accent = motionAccent(kind, theme);
  const rawAge = interactionAgeMs != null && Number.isFinite(interactionAgeMs) && interactionAgeMs >= 0
    ? interactionAgeMs : DIAL_INTERACTION_DURATION_MS;
  // The 64px glyph remains at the 33ms cadence. Quantizing only the much
  // larger surface makes its data URL repeat between keyframes, allowing the
  // controller's feedback delta to skip redundant host rasterization.
  const age = Math.min(DIAL_INTERACTION_DURATION_MS, Math.floor(rawAge / 60) * 60);
  const healthy = !["error", "offline", "stale", "unavailable", "connecting"].includes(state);
  const strength = healthy ? dialInteractionStrength(age) : 0;
  const sweepProgress = Math.min(1, age / DIAL_INTERACTION_DURATION_MS);
  const sign = direction < 0 ? -1 : 1;
  const sweepX = sign > 0 ? -48 + 296 * sweepProgress : 248 - 296 * sweepProgress;
  const baseTop = dark ? "#171E26" : "#F7F9FB";
  const baseBottom = dark ? "#080B0F" : "#E7ECF1";
  const edge = dark ? "#FFFFFF" : "#FFFFFF";
  const active = strength > 0;
  const activeMarkup = !active ? "" : `<g data-dial-surface-motion="${sign}" clip-path="url(#dial-surface-clip)" opacity="${strength.toFixed(3)}">
      <path d="M${(sweepX - sign * 58).toFixed(2)} -12L${(sweepX + sign * 8).toFixed(2)} 112" stroke="${accent}" stroke-width="54" opacity=".18"/>
      <path d="M${(sweepX - sign * 34).toFixed(2)} -8L${(sweepX + sign * 25).toFixed(2)} 108" stroke="${edge}" stroke-width="20" opacity=".10"/>
      <path d="M${(sweepX - sign * 20).toFixed(2)} -8L${(sweepX + sign * 39).toFixed(2)} 108" stroke="${edge}" stroke-width="2.2" opacity=".76"/>
      <rect x="3" y="3" width="194" height="94" rx="16" fill="none" stroke="${accent}" stroke-width="1.6" opacity=".82"/>
    </g>`;
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
    <defs>
      <linearGradient id="surface-base" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${baseTop}"/><stop offset="1" stop-color="${baseBottom}"/></linearGradient>
      <linearGradient id="surface-rest" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}" stop-opacity="${dark ? '.17' : '.12'}"/><stop offset=".46" stop-color="${accent}" stop-opacity=".05"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient>
      <clipPath id="dial-surface-clip"><rect width="200" height="100" rx="18"/></clipPath>
    </defs>
    <rect width="200" height="100" rx="18" fill="url(#surface-base)"/>
    <rect width="200" height="100" rx="18" fill="url(#surface-rest)"/>
    <path d="M18 1h164" stroke="${edge}" stroke-width="1.2" stroke-linecap="round" opacity="${dark ? '.30' : '.72'}"/>
    <rect x="1" y="1" width="198" height="98" rx="17" fill="none" stroke="${dark ? '#FFFFFF' : '#7B8794'}" stroke-width=".8" opacity="${dark ? '.16' : '.22'}"/>
    ${activeMarkup}
  </svg>`);
}

/**
 * Render the same typed payload as a native-size 200x100 LCD fixture. The
 * controller sends `renderPlusDialFeedback` to the SDK; this companion keeps
 * the source-rendered contract inspectable and rasterizable without inventing
 * a second set of values for design review.
 */
export function renderPlusDialSvg(input: PlusDialFeedbackInput): string {
  const feedback = renderPlusDialFeedback(input);
  const theme = input.theme ?? "dark";
  const surface = SURFACES[theme];
  const color = stateColor(feedback.status, theme);
  const progress = typeof feedback.progress === "number" && Number.isFinite(feedback.progress) ? Math.max(0, Math.min(1, feedback.progress)) : undefined;
  // A dial has one compact value line. Bound by display width before choosing
  // the LCD font size so long CJK task names cannot overflow the 200px frame.
  const dialValue = truncateDisplayText(feedback.value, 10, 9);
  const progressMarkup = progress == null ? "" : `<rect data-dial-progress="${progress.toFixed(3)}" x="14" y="88" width="172" height="4" rx="2" fill="${surface.innerBorder}"/><rect x="14" y="88" width="${(172 * progress).toFixed(2)}" height="4" rx="2" fill="${color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" role="img" aria-label="${escapeXml(`${feedback.title} ${displayStateLabel(feedback.status, input.language)}`)}">
    <defs><linearGradient id="dial-surface" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${surface.keyTop}"/><stop offset="1" stop-color="${surface.keyBottom}"/></linearGradient></defs>
    <rect data-theme="${theme}" x="1" y="1" width="198" height="98" rx="12" fill="${surface.outer}"/>
    <rect x="5" y="5" width="190" height="90" rx="9" fill="url(#dial-surface)" stroke="${surface.border}" stroke-width="1.5"/>
    <text data-dial-title="${escapeXml(feedback.title)}" x="14" y="22" font-family="${DISPLAY_FONT}" font-size="11" font-weight="700" fill="${surface.muted}">${escapeXml(feedback.title)}</text>
    <text data-dial-value="${escapeXml(dialValue)}" x="100" y="59" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="20" font-weight="750" fill="${surface.title}">${escapeXml(dialValue)}</text>
    <text data-dial-detail="${escapeXml(feedback.detail)}" x="14" y="79" font-family="${DISPLAY_FONT}" font-size="10" font-weight="650" fill="${surface.muted}">${escapeXml(feedback.detail)}</text>
    <circle data-dial-status="${feedback.status}" cx="145" cy="17" r="4" fill="${color}"/>
    <text data-dial-status-label="${feedback.status}" x="190" y="22" text-anchor="end" font-family="${MONO_FONT}" font-size="8" font-weight="750" fill="${color}">${escapeXml(displayStateLabel(feedback.status, input.language))}</text>
    ${progressMarkup}
  </svg>`;
}

/** Alias with a builder-like name for adapters that prefer explicit intent. */
export const buildMicroPlusFeedback = renderPlusDialFeedback;

function renderUsageBar(
  label: string,
  window: UsageWindow | undefined,
  y: number,
  surface: SurfacePalette,
  theme: ThemeMode,
  health: HostHealthState,
  overviewState: DisplayLifecycleState,
  language?: DisplayLanguage
): string {
  const remaining = window && Number.isFinite(window.remainingPercent) ? Math.round(clampPercent(window.remainingPercent)) : null;
  const state = remaining == null ? "unknown" : overviewState;
  const visibleRemaining = state === "ready" || state === "unknown" ? remaining : null;
  const signal = usageSignal(remaining, health, theme, state);
  const track = theme === "dark" ? "#34404A" : "#AAB7BE";
  const width = remaining == null ? 0 : 96 * remaining / 100;
  const displayLabel = label === "5H" ? copy(language, "usageFiveHour", "5時間") : label === "WK" ? copy(language, "usageWeekly", "週間") : label;
  return `<g data-usage-window="${label}" data-usage-window-state="${state}">
    <text x="24" y="${y}" fill="${surface.title}" fill-opacity=".86" font-family="${DISPLAY_FONT}" font-size="11" font-weight="700">${displayLabel}</text>
    <text data-usage-message="${visibleRemaining == null ? copy(language, "notAcquired", "未取得") : ""}" x="120" y="${y}" text-anchor="end" fill="${visibleRemaining == null ? signal : surface.title}" font-family="${MONO_FONT}" font-size="13" font-weight="750">${visibleRemaining == null ? "—" : `${visibleRemaining}%`}</text>
    <rect x="24" y="${y + 10}" width="96" height="10" rx="5" fill="${track}"/>
    ${visibleRemaining == null ? "" : `<rect data-usage-remaining="${visibleRemaining}" x="24" y="${y + 10}" width="${(96 * visibleRemaining / 100).toFixed(2)}" height="10" rx="5" fill="${signal}"/>`}
  </g>`;
}

function renderFlatKeyBase(surface: SurfacePalette, theme: ThemeMode, accent?: string, selected = false): string {
  const color = accent ?? surface.innerBorder;
  const selectionGlow = selected
    ? `<rect data-selected-glow="true" x="7" y="7" width="130" height="130" rx="16" fill="none" stroke="${surface.selected}" stroke-width="8" stroke-opacity=".24"/>`
    : "";
  return `<defs><linearGradient id="keycap" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${surface.keyTop}"/><stop offset=".52" stop-color="${surface.keyMiddle}"/><stop offset="1" stop-color="${surface.keyBottom}"/></linearGradient></defs>
    <rect data-theme="${theme}" x="4" y="4" width="136" height="136" rx="18" fill="${surface.outer}"/>
    <rect x="9" y="9" width="126" height="126" rx="13" fill="url(#keycap)" stroke="${surface.border}" stroke-width="1"/>
    ${selectionGlow}
    <rect data-accent="${escapeXml(color)}" data-selected="${selected}" x="7" y="7" width="130" height="130" rx="16" fill="none" stroke="${selected ? surface.selected : color}" stroke-width="${selected ? "3" : "2"}" stroke-opacity=".94"/><!--key-content-->`;
}

/**
 * Render a frame-dependent operation cue. Stream Deck rasterizes each image
 * once, so this intentionally uses concrete geometry rather than SVG SMIL
 * animation. The controller advances animationFrame and sends a new image.
 */
function renderActionStateMotion(
  state: DisplayLifecycleState,
  color: string,
  theme: ThemeMode,
  animationFrame: number
): string {
  const frame = normalizedAnimationFrame(animationFrame);
  if (state === "pending") {
    const offset = (frame * 4) % 24;
    return "<rect data-action-motion=\"pending\" data-motion-frame=\"" + frame + "\" x=\"13\" y=\"116.5\" width=\"118\" height=\"17\" rx=\"4.5\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"1.8\" stroke-dasharray=\"8 5\" stroke-dashoffset=\"-" + offset + "\" stroke-opacity=\".92\"/>";
  }
  if (state === "pressed" || state === "holding") {
    const pulse = .62 + .3 * ((Math.sin((frame / 12) * Math.PI * 2) + 1) / 2);
    const beaconX = 22 + ((frame * 9) % 100);
    return "<rect data-action-motion=\"held\" data-motion-frame=\"" + frame + "\" x=\"13\" y=\"116.5\" width=\"118\" height=\"17\" rx=\"4.5\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"" + (1.5 + pulse).toFixed(2) + "\" stroke-opacity=\"" + pulse.toFixed(3) + "\"/><circle data-action-motion-beacon=\"held\" cx=\"" + beaconX + "\" cy=\"125\" r=\"" + (1.8 + pulse * 1.4).toFixed(2) + "\" fill=\"" + color + "\" fill-opacity=\"" + pulse.toFixed(3) + "\"/>";
  }
  // Keep the palette context in the helper signature without inferring a
  // lifecycle state from theme. The state supplied by the observer wins.
  void theme;
  return "";
}

function renderContextCompactionMotion(
  state: DisplayLifecycleState,
  color: string,
  theme: ThemeMode,
  frame: number
): string {
  if (state === "pending") {
    const angle = frame * 30 - 90;
    const dotX = 72 + Math.cos(angle * Math.PI / 180) * 45;
    const dotY = 70 + Math.sin(angle * Math.PI / 180) * 45;
    const pulse = .72 + .28 * ((Math.sin(frame * Math.PI / 6) + 1) / 2);
    return `<g data-context-compaction-motion="pending" data-motion-frame="${frame}">
      <circle cx="72" cy="70" r="45" fill="none" stroke="${color}" stroke-width="15" stroke-opacity=".24" stroke-linecap="round" stroke-dasharray="82 201" stroke-dashoffset="${(-frame * 18).toFixed(2)}" transform="rotate(-90 72 70)"/>
      <circle cx="72" cy="70" r="45" fill="none" stroke="${theme === "dark" ? "#FFFFFF" : color}" stroke-width="2.6" stroke-opacity="${pulse.toFixed(3)}" stroke-linecap="round" stroke-dasharray="82 201" stroke-dashoffset="${(-frame * 18).toFixed(2)}" transform="rotate(-90 72 70)"/>
      <circle data-context-compaction-beacon="true" cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="${(3.4 + pulse * 1.8).toFixed(2)}" fill="${theme === "dark" ? "#FFFFFF" : color}" fill-opacity="${pulse.toFixed(3)}"/>
    </g>`;
  }
  if (state === "confirmed") {
    return `<g data-context-compaction-motion="confirmed" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="72" cy="70" r="48" stroke-width="2.2"/><path d="M51 70l13 13 29-31"/></g>`;
  }
  if (state === "error") {
    return `<g data-context-compaction-motion="error" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"><circle cx="72" cy="70" r="48" stroke-width="2.2"/><path d="M56 54l32 32M88 54 56 86"/></g>`;
  }
  return "";
}

function renderOperationMotion(phase: OperationFeedbackPhase, color: string, animationFrame: number): string {
  const frame = normalizedAnimationFrame(animationFrame);
  // Raster frames, not SVG animation: the host receives an actual new image.
  // The perimeter leaves the identifying glyph and status copy stationary.
  const pulse = .85 + .075 * (1 + Math.cos(frame * Math.PI / 6));
  const active = phase === "pending" || phase === "held";
  const orbit = phase === "pending"
    ? ` stroke-dasharray="92 400" stroke-dashoffset="${(-frame * 41).toFixed(2)}"`
    : "";
  const opacity = phase === "held" ? pulse.toFixed(3) : ".95";
  const halo = active ? `<rect data-key-energy="true" x="10" y="10" width="124" height="124" rx="21" fill="none" stroke="${color}" stroke-width="14" stroke-opacity=".4"${orbit}/>` : "";
  const core = active ? `<rect data-key-light-core="true" x="10" y="10" width="124" height="124" rx="21" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-opacity="1"${orbit}/>` : "";
  const perimeter = `${halo}<rect data-key-interaction="${phase}" x="10" y="10" width="124" height="124" rx="21" fill="none" stroke="${color}" stroke-width="${active ? '5.5' : '1.5'}" stroke-opacity="${opacity}"${orbit}/>${core}`;
  if (!active) return perimeter;
  const hold = phase === "held"
    ? `<path d="M58 108h28" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="${opacity}"/>`
    : "";
  return `<g data-operation-motion="${phase}" data-motion-frame="${frame}">${perimeter}${hold}</g>`;
}

function normalizedAnimationFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return ((frame % 12) + 12) % 12;
}

function usageDisplayState(remaining: number | null, health: HostHealthState, freshness?: UsageFreshness): DisplayLifecycleState {
  if (health !== "ready") return healthToDisplayState(health);
  if (remaining == null || !Number.isFinite(remaining)) return "unknown";
  if (freshness?.observedAt == null) return "unknown";
  const now = freshness.now ?? Date.now();
  const maxAge = freshness.maxAgeMs ?? 5 * 60 * 1000;
  return now - freshness.observedAt > maxAge ? "stale" : "ready";
}

function usageSignal(remaining: number | null, health: HostHealthState, theme: ThemeMode, state?: DisplayLifecycleState): string {
  if (state === "offline") return SIGNAL_COLORS[theme].error;
  if (state === "connecting" || state === "stale" || health === "degraded" || health === "connecting") return SIGNAL_COLORS[theme].input;
  if (remaining == null || state === "unknown") return SIGNAL_COLORS[theme].unknown;
  return remaining <= 20 ? SIGNAL_COLORS[theme].error : SIGNAL_COLORS[theme].complete;
}

function finiteContextPercent(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

function contextCompactionDetail(
  value: string | undefined,
  language: DisplayLanguage | undefined,
  state: DisplayLifecycleState
): string {
  const raw = value?.trim();
  if (raw) {
    if (raw === "E_CONTEXT_COMPACTION_UNAVAILABLE") return language === "en" ? "UNAVAILABLE" : "利用不可";
    if (raw === "E_CONTEXT_COMPACTION_BUSY") return language === "en" ? "RESPONSE ACTIVE" : "応答中";
    if (raw === "E_CONTEXT_COMPACTION_DRAFT_NOT_EMPTY") return language === "en" ? "DRAFT NOT EMPTY" : "下書きあり";
    if (raw === "E_CONTEXT_COMPACTION_SCOPE_UNAVAILABLE" || raw === "E_CONTEXT_COMPACTION_MANAGER_UNAVAILABLE") {
      return language === "en" ? "NOT SUPPORTED" : "現在非対応";
    }
    if (raw === "E_CONTEXT_NOT_ELIGIBLE") return language === "en" ? "NOT ELIGIBLE" : "実行条件未成立";
    if (raw === "E_RESULT_UNVERIFIED") return copy(language, "resultUnverified", "結果未確認");
    return truncateDisplayText(raw, 16, 14);
  }
  if (state === "pending") return language === "en" ? "COMPACTING" : "圧縮中";
  if (state === "confirmed") return language === "en" ? "COMPACTED" : "圧縮済み";
  if (state === "error") return copy(language, "failure", "失敗");
  if (state === "unknown") return copy(language, "notAcquired", "未取得");
  return "";
}

function localizeAgentTitle(value: string, language?: DisplayLanguage): string {
  const clean = sanitizeDisplayText(value);
  if (!clean) return copy(language, "titleUnavailable", "タイトル未取得");
  if (language === "en") {
    const labels: Record<string, string> = {
      "Not assigned": "UNASSIGNED",
      "Signals unavailable": "SIGNALS UNAVAILABLE",
      "New chat": "TITLE UNAVAILABLE",
      UNASSIGNED: "UNASSIGNED",
      "NO ACTIVE CHAT": "TITLE UNAVAILABLE"
    };
    return labels[clean] ?? clean;
  }
  const labels: Record<string, string> = {
    "Not assigned": "未割当",
    "Signals unavailable": "信号なし",
    "New chat": "タイトル未取得",
    UNASSIGNED: "未割当",
    "NO ACTIVE CHAT": "会話なし"
  };
  return labels[clean] ?? clean;
}

function agentStatusLabel(status: DisplayAgentVisualStatus, hostHealth: HostHealthState, language?: DisplayLanguage): string {
  if (hostHealth === "connecting") return copy(language, "connecting", "CONNECTING");
  if (hostHealth === "offline") return copy(language, "offline", "OFFLINE");
  if (hostHealth === "degraded") return copy(language, "stale", "STALE");
  switch (status) {
    case "empty": return copy(language, "empty", "EMPTY");
    case "idle": return copy(language, "ready", "READY");
    case "thinking": return copy(language, "thinking", "THINKING");
    case "complete": return copy(language, "done", "DONE");
    case "input": return copy(language, "input", "INPUT");
    case "error": return copy(language, "error", "ERROR");
    case "unknown": return copy(language, "unknown", "UNKNOWN");
  }
}

function localizedHostHealthLabel(health: HostHealthState, language?: DisplayLanguage): string {
  switch (health) {
    case "ready": return copy(language, "ready", "READY");
    case "connecting": return copy(language, "connecting", "CONNECTING");
    case "degraded": return copy(language, "stale", "STALE");
    case "offline": return copy(language, "offline", "OFFLINE");
  }
}

function localizedUsageLabel(kind: UsageWindowKind, language?: DisplayLanguage): string {
  if (kind === "five-hour") return copy(language, "usageFiveHour", "5時間");
  if (kind === "weekly") return copy(language, "usageWeekly", "週間");
  return copy(language, "usageLimit", "制限");
}

function localizeFallbackKeycap(value: string, language?: DisplayLanguage): string {
  if (language === "en") {
    const rawId = value.replace(/^keycap[-_.]?/i, "").trim().toLowerCase();
    const raw = rawId.replace(/[-_.]+/g, " ");
    const labels: Record<string, string> = {
      fast: "FAST", appr: "APPROVE", approve: "APPROVE", rej: "REJECT", reject: "REJECT", split: "SPLIT CHAT",
      mic: "PUSH TO TALK", mic1: "PUSH TO TALK", "mic single": "PUSH TO TALK", codex: "SEND", bug: "FEEDBACK", oai: "OPENAI DOCS", "openai docs": "OPENAI DOCS",
      term: "TERMINAL", terminal: "TERMINAL", dwn: "COPY MARKDOWN", download: "COPY MARKDOWN", del: "ARCHIVE CHAT", archive: "ARCHIVE CHAT",
      nav: "BROWSER TAB", browser: "BROWSER TAB", magic: "PIN CHAT", pin: "PIN CHAT", diff: "REVIEW", play: "RUN ACTION",
      git: "COMMIT / PUSH", "git commit": "COMMIT / PUSH", brch: "DRAFT PR", branch: "CREATE BRANCH", "create branch": "CREATE BRANCH",
      mrg: "MERGE PR", merge: "MERGE PR", pr: "CREATE PR", "pull request": "CREATE PR", paint: "ADD PHOTOS", "add photos": "ADD PHOTOS",
      lab: "MICRO SETTINGS", party: "SIDE CHAT", "side chat": "SIDE CHAT", time: "TASKS", tasks: "TASKS", setup: "SETTINGS", settings: "SETTINGS",
      fold: "OPEN FOLDER", "open folder": "OPEN FOLDER", upl: "ADD FILES", "add files": "ADD FILES", apps: "PLUGINS", skills: "PLUGINS",
      yolo: "TYPE :YOLO:", yeet: "TYPE :YEET:", "mind+": "REASONING +", "mind-": "REASONING -", "new task": "NEW CHAT", new: "NEW CHAT", "reasoning up": "REASONING +", "reasoning down": "REASONING -",
      "empty 1": "SHORTCUT 1", "empty 2": "SHORTCUT 2", "empty 3": "SHORTCUT 3", "empty 4": "SHORTCUT 4", "empty 5": "SHORTCUT 5",
      empt1: "SHORTCUT 1", empt2: "SHORTCUT 2", empt3: "SHORTCUT 3", empt4: "SHORTCUT 4", empt5: "SHORTCUT 5",
      "not connected": "OFFLINE", unassigned: "UNASSIGNED", "act11 inactive": "ACT11 OFF"
    };
    if (labels[rawId]) return labels[rawId];
    if (labels[raw]) return labels[raw];
    if (value === "ACT11 無効") return "ACT11 OFF";
    if (value === "未接続") return "OFFLINE";
    if (value === "未割当") return "UNASSIGNED";
    if (value === "思考") return "REASONING";
    if (value === "左右") return "NAVIGATION";
    if (value === "使用量") return "USAGE";
    if (value === "モデル") return "MODEL";
  }
  const keycap = ADDITIONAL_KEYCAPS.find((entry) => entry.id === value);
  if (keycap) return keycap.name;
  const normalized = value.replace(/^keycap[-_.]?/i, "").replace(/[-_.]+/g, " ").trim().toLowerCase();
  const labels: Record<string, string> = {
    mind: "思考",
    chat: "会話",
    fast: "高速",
    approve: "承認",
    decline: "拒否",
    reject: "拒否",
    send: "送信",
    dictation: "マイク",
    mic: "マイク",
    "mic single": "マイク",
    "new task": "新規タスク",
    "reasoning up": "思考↑",
    "reasoning down": "思考↓",
    terminal: "ターミナル",
    browser: "ブラウザ",
    settings: "設定",
    skills: "スキル"
  };
  return labels[normalized] ?? value;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", "\"": "&quot;"
  })[character] ?? character);
}

/** Approximate terminal display width; CJK/full-width code points occupy two cells. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const character of Array.from(value)) {
    const code = character.codePointAt(0) ?? 0;
    if (/\p{Mark}/u.test(character) || code === 0x200d || code === 0xfe0f) continue;
    if (/\s/u.test(character)) width += 0.45;
    else if (isWideCodePoint(code)) width += 2;
    else if (/[ilI1.,:;'|!`]/.test(character)) width += 0.45;
    else if (/[MW@%&]/.test(character)) width += 1.25;
    else width += 1;
  }
  return width;
}

/** Split by measured display width instead of JavaScript string length. */
export function splitDisplayLines(value: string, maxWidth = 13, maxLines = 2, language?: DisplayLanguage): string[] {
  const clean = sanitizeDisplayText(value);
  const unavailable = copy(language, "titleUnavailable", "タイトル未取得");
  if (!clean) return splitUnavailableTitle(unavailable, maxLines);
  if (clean === "タイトル未取得" && maxLines >= 2) return ["タイトル", "未取得"];
  if (clean === "名称未取得" && maxLines >= 2) return ["名称", "未取得"];
  if (clean === "TITLE UNAVAILABLE" && maxLines >= 2) return ["TITLE", "UNAVAILABLE"];
  const words = clean.includes(" ") ? clean.split(/\s+/u) : Array.from(clean);
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  const pushCurrent = (): void => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };
  for (const word of words) {
    const candidate = current ? (clean.includes(" ") ? `${current} ${word}` : `${current}${word}`) : word;
    if (displayWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (displayWidth(word) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const character of Array.from(word)) {
      const next = `${chunk}${character}`;
      if (chunk && displayWidth(next) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else chunk = next;
    }
    current = chunk;
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }
  pushCurrent();
  if (lines.length === 0) lines.push(unavailable);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1] ?? "";
    kept[maxLines - 1] = ellipsizeDisplay(last, maxWidth);
    truncated = true;
    return kept;
  }
  // If words overflowed after the final line, make the final line explicit.
  if (lines.length === maxLines && (truncated || clean.length > lines.join("").length)) {
    lines[maxLines - 1] = ellipsizeDisplay(lines[maxLines - 1] ?? "", maxWidth);
  }
  return lines;
}

function splitUnavailableTitle(value: string, maxLines: number): string[] {
  if (maxLines < 2) return [value];
  if (value === "タイトル未取得") return ["タイトル", "未取得"];
  if (value === "TITLE UNAVAILABLE") return ["TITLE", "UNAVAILABLE"];
  return [value];
}

export function truncateDisplayText(value: string, maxCharacters = 16, maxWidth = maxCharacters): string {
  const clean = sanitizeDisplayText(value);
  if (displayWidth(clean) <= maxWidth && Array.from(clean).length <= maxCharacters) return clean;
  return ellipsizeDisplay(clean, maxWidth, maxCharacters);
}

function ellipsizeDisplay(value: string, maxWidth: number, maxCharacters = 64): string {
  let output = "";
  for (const character of Array.from(value)) {
    const next = `${output}${character}…`;
    if (Array.from(next).length > maxCharacters || displayWidth(next) > maxWidth) break;
    output += character;
  }
  return `${output}…`;
}

function fitTitleFont(value: string, maximum: number): string {
  const widthUnits = Math.max(displayWidth(value), 1);
  // 112px is the actual title column after the stable 16px inset on a 144px key.
  return Math.max(11.5, Math.min(maximum, 112 / widthUnits)).toFixed(2);
}

function isWideCodePoint(code: number): boolean {
  return (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff01 && code <= 0xff60)
    || (code >= 0x1f000 && code <= 0x1ffff);
}

function sanitizeDisplayText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function renderAgentAttention(
  attention: AgentAttention | undefined,
  language: DisplayLanguage | undefined,
  surface: SurfacePalette,
  theme: ThemeMode,
  phase = 0
): string {
  const goalStatus = attention?.goalStatus;
  const question = attention?.pendingQuestion === true;
  const metadataUnavailable = attention?.metadataAvailability === "unavailable";
  if (!goalStatus && !question && !metadataUnavailable) return "";

  const labels: Record<NonNullable<AgentAttention["goalStatus"]>, [string, string]> = {
    active: ["目標進行", "GOAL RUN"],
    paused: ["一時停止", "PAUSED"],
    blocked: ["停滞中", "STALLED"],
    usageLimited: ["利用制限", "LIMIT"],
    budgetLimited: ["予算制限", "BUDGET"],
    complete: ["目標完了", "DONE"]
  };
  const questionLabel = language === "en" ? "QUESTION" : "質問待ち";
  const goalLabel = goalStatus == null ? "" : labels[goalStatus][language === "en" ? 1 : 0];
  const alertColor = SIGNAL_COLORS[theme].error;
  const goalColor = goalStatus === "blocked" || goalStatus === "usageLimited" || goalStatus === "budgetLimited"
    ? alertColor
    : goalStatus === "complete" ? SIGNAL_COLORS[theme].complete : surface.selected;
  const renderBadge = (kind: "pending-question" | "goal" | "metadata-unavailable", label: string, y: number, color: string): string => {
    const fontSize = fitAttentionFont(label, 14);
    const pulse = (0.55 + 0.45 * (1 + Math.cos(phase * Math.PI / 6)) / 2).toFixed(2);
    const indicator = kind === "pending-question" ? `<circle data-question-signal="true" cx="24" cy="${y + 10}" r="2" fill="${color}" opacity="${pulse}"/>` : "";
    return `<g data-agent-attention="${kind}"${kind === "goal" ? ` data-goal-status="${goalStatus}"` : ""}><rect x="16" y="${y}" width="112" height="20" rx="4" fill="${surface.keyMiddle}" stroke="${color}" stroke-opacity=".65" stroke-width="1"/>${indicator}<text x="72" y="${y + 14.5}" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="${fontSize}" font-weight="750" fill="${color}">${escapeXml(label)}</text></g>`;
  };
  const rows: string[] = [];
  if (question) rows.push(renderBadge("pending-question", questionLabel, goalLabel ? 79 : 87, alertColor));
  if (goalLabel) rows.push(renderBadge("goal", goalLabel, question ? 102 : 87, goalColor));
  if (metadataUnavailable && rows.length === 0) {
    rows.push(renderBadge("metadata-unavailable", language === "en" ? "SIGNALS UNKNOWN" : "状態不明", 87, SIGNAL_COLORS[theme].unknown));
  }
  return `<g data-agent-attention-priority="question-first">${rows.join("")}</g>`;
}

function fitAttentionFont(label: string, maximum: number): string {
  const width = Math.max(displayWidth(label), 1);
  // Keep critical attention copy large on the native key. Labels are short
  // enough to stay within the 112px safe column at this size.
  return Math.max(11.5, Math.min(maximum, 112 / width)).toFixed(2);
}

/**
 * Render the agent selector's compact status icon.
 *
 * This is intentionally a separate 144px image rather than a scaled agent
 * key. A dial has less room for a title, and a small ring/dot/question shape
 * keeps the observed slot state legible at a glance. The controller supplies
 * `animationFrame` and sends a fresh raster for working states; idle and
 * terminal states do not depend on that frame, so they remain stable.
 */
function renderAgentDialIcon(
  status: DisplayAgentVisualStatus,
  theme: ThemeMode,
  animationFrame: number,
  slot?: number,
  language?: DisplayLanguage
): string {
  const surface = SURFACES[theme];
  const color = signalForStatus(status, theme);
  const frame = normalizedAnimationFrame(animationFrame);
  const slotLabel = slot == null ? "AGENT" : `A${String(Math.max(0, slot) + 1).padStart(2, "0")}`;
  const normalizedStatus = status === "unknown" ? "unknown" : status;
  let mark: string;

  if (normalizedStatus === "thinking") {
    const angle = (frame / 12) * Math.PI * 2 - Math.PI / 2;
    const dotX = 72 + Math.cos(angle) * 25;
    const dotY = 77 + Math.sin(angle) * 25;
    const trailAngle = angle - Math.PI / 2;
    const trailX = 72 + Math.cos(trailAngle) * 25;
    const trailY = 77 + Math.sin(trailAngle) * 25;
    mark = `<g data-agent-dial-motion="thinking" data-motion-frame="${frame}">
      <circle cx="72" cy="77" r="24" fill="none" stroke="${surface.innerBorder}" stroke-width="4"/>
      <circle cx="72" cy="77" r="24" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="28 124" stroke-dashoffset="${(-frame * 13).toFixed(2)}"/>
      <circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="5.5" fill="${color}"/>
      <circle cx="${trailX.toFixed(2)}" cy="${trailY.toFixed(2)}" r="2.5" fill="${color}" fill-opacity=".42"/>
    </g>`;
  } else if (normalizedStatus === "input") {
    const pulse = .58 + .34 * ((Math.sin((frame / 12) * Math.PI * 2) + 1) / 2);
    const halo = (1.8 + pulse * 1.8).toFixed(2);
    mark = `<g data-agent-dial-motion="input" data-motion-frame="${frame}">
      <circle cx="72" cy="77" r="25" fill="none" stroke="${color}" stroke-width="${halo}" stroke-opacity="${pulse.toFixed(3)}"/>
      <path d="M72 51c-15 0-26 9-26 22 0 8 4 14 11 18l-2 10 10-7c2 .5 5 1 7 1 15 0 26-9 26-22S87 51 72 51Z" fill="${surface.keyMiddle}" stroke="${color}" stroke-width="3"/>
      <text x="72" y="85" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="25" font-weight="800" fill="${color}">?</text>
      <circle cx="72" cy="105" r="3" fill="${color}" fill-opacity="${pulse.toFixed(3)}"/>
    </g>`;
  } else if (normalizedStatus === "complete") {
    mark = `<g data-agent-dial-mark="complete" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="72" cy="77" r="25"/><path d="M58 77l9 9 19-21"/></g>`;
  } else if (normalizedStatus === "error" || normalizedStatus === "unknown") {
    mark = `<g data-agent-dial-mark="${normalizedStatus}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"><circle cx="72" cy="77" r="25"/><path d="M61 66l22 22M83 66 61 88"/></g>`;
  } else if (normalizedStatus === "empty") {
    mark = `<g data-agent-dial-mark="empty" fill="none" stroke="${color}" stroke-linecap="round"><circle cx="72" cy="77" r="25" stroke-width="3"/><path d="M60 77h24" stroke-width="5"/></g>`;
  } else {
    mark = `<g data-agent-dial-mark="idle"><circle cx="72" cy="77" r="25" fill="none" stroke="${color}" stroke-width="4"/><circle cx="72" cy="77" r="7" fill="${color}"/></g>`;
  }

  const statusLabel = agentDialStatusLabel(status, language);
  return toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" role="img" aria-label="${escapeXml(`${slotLabel} ${statusLabel}`)}">
    ${renderFlatKeyBase(surface, theme, color)}
    <text data-agent-dial-slot="${escapeXml(slotLabel)}" x="128" y="27" text-anchor="end" font-family="${MONO_FONT}" font-size="10" font-weight="750" fill="${surface.muted}">${escapeXml(slotLabel)}</text>
    ${mark}
    <text data-agent-dial-status="${escapeXml(status)}" x="72" y="119" text-anchor="middle" font-family="${MONO_FONT}" font-size="9" font-weight="750" fill="${color}">${escapeXml(statusLabel)}</text>
  </svg>`);
}

function agentDialStatusLabel(status: DisplayAgentVisualStatus, language?: DisplayLanguage): string {
  if (language === "en") {
    switch (status) {
      case "empty": return "EMPTY";
      case "idle": return "IDLE";
      case "thinking": return "THINKING";
      case "complete": return "DONE";
      case "input": return "INPUT";
      case "error": return "ERROR";
      case "unknown": return "UNKNOWN";
    }
  }
  if (language === "ja") {
    switch (status) {
      case "empty": return "空き";
      case "idle": return "待機";
      case "thinking": return "思考中";
      case "complete": return "完了";
      case "input": return "入力";
      case "error": return "エラー";
      case "unknown": return "不明";
    }
  }
  return status.toUpperCase();
}

function renderAgentStatusMark(status: DisplayAgentVisualStatus, color: string, phase: number, pulse: number): string {
  if (status === "thinking") {
    const x = 42 + (phase % 12) * 3;
    return `<g data-agent-motion="working"><rect x="42" y="101" width="60" height="6" rx="3" fill="#78858E" fill-opacity=".28"/><rect x="${x.toFixed(2)}" y="101" width="20" height="6" rx="3" fill="${color}" fill-opacity=".98"/></g>`;
  }
  if (status === "input") return `<g data-agent-motion="input" fill="${color}" fill-opacity="${(.78 + pulse * .18).toFixed(3)}"><rect x="63" y="98" width="6" height="18" rx="3"/><rect x="75" y="98" width="6" height="18" rx="3"/></g>`;
  if (status === "complete") return `<g data-agent-motion="complete" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="72" cy="106" r="14"/><path d="M64 106l5 5 11-12"/></g>`;
  if (status === "error" || status === "unknown") return `<g data-agent-motion="${status}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"><circle cx="72" cy="106" r="14"/><path d="M66 100l12 12M78 100l-12 12"/></g>`;
  if (status === "empty") return `<rect data-agent-motion="empty" x="60" y="104" width="24" height="4" rx="2" fill="${color}" fill-opacity=".5"/>`;
  return `<circle data-agent-motion="idle" cx="72" cy="106" r="5" fill="${color}" fill-opacity=".9"/>`;
}

function renderHostHealthMark(health: HostHealthState, theme: ThemeMode): string {
  if (health === "ready") return "";
  const color = stateSignal(health, theme);
  if (health === "degraded") return `<circle data-agent-host-health="degraded" cx="22" cy="22" r="5" fill="${color}"/>`;
  if (health === "offline") return `<circle data-agent-host-health="offline" cx="22" cy="22" r="5" fill="${color}"/><path d="M19 19l6 6m0-6-6 6" stroke="${SURFACES[theme].keyMiddle}" stroke-width="1.5" stroke-linecap="round"/>`;
  return `<g data-agent-host-health="connecting" fill="${color}"><circle cx="17" cy="22" r="2"/><circle cx="22" cy="22" r="2"/><circle cx="27" cy="22" r="2"/></g>`;
}

function renderContextRing(value: number | undefined, theme: ThemeMode, surface: SurfacePalette): string {
  if (value == null || !Number.isFinite(value)) return "";
  const percent = Math.max(0, Math.min(100, value));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * percent / 100;
  const color = percent >= 92 ? SIGNAL_COLORS[theme].error : percent >= 80 ? SIGNAL_COLORS[theme].input : surface.muted;
  return `<g data-context-used="${Math.round(percent)}" aria-label="Context usage ${Math.round(percent)} percent"><circle cx="22" cy="22" r="${radius}" fill="none" stroke="${surface.innerBorder}" stroke-width="3"/><circle cx="22" cy="22" r="${radius}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 22 22)"/></g>`;
}

function displayStateLabel(state: DisplayLifecycleState | MicroPlusFeedbackStatus, language?: DisplayLanguage): string {
  if (language == null) return state.toUpperCase();
  switch (state) {
    case "ready": return copy(language, "ready", "READY");
    case "pressed": return copy(language, "pressed", "PRESSED");
    case "holding": return copy(language, "holding", "HOLDING");
    case "pending": return copy(language, "pending", "PENDING");
    case "recording": return copy(language, "recording", "RECORDING");
    case "confirmed": return copy(language, "confirmed", "CONFIRMED");
    case "error": return copy(language, "error", "ERROR");
    case "stale": return copy(language, "stale", "STALE");
    case "offline": return copy(language, "offline", "OFFLINE");
    case "connecting": return copy(language, "connecting", "CONNECTING");
    case "unknown": return copy(language, "unknown", "UNKNOWN");
    case "unavailable": return copy(language, "unavailable", "UNAVAILABLE");
  }
}

function stateColor(state: DisplayLifecycleState | MicroPlusFeedbackStatus, theme: ThemeMode): string {
  switch (state) {
    case "ready": return SIGNAL_COLORS[theme].complete;
    case "pressed": return SIGNAL_COLORS[theme].thinking;
    case "holding":
    case "pending": return SIGNAL_COLORS[theme].input;
    case "recording": return theme === "dark" ? "#FF5E8A" : "#C52356";
    case "confirmed": return SIGNAL_COLORS[theme].complete;
    case "error": return SIGNAL_COLORS[theme].error;
    case "stale":
    case "unknown":
    case "unavailable": return SIGNAL_COLORS[theme].unknown;
    case "offline": return SIGNAL_COLORS[theme].error;
    case "connecting": return SIGNAL_COLORS[theme].input;
  }
}

function signalForStatus(status: DisplayAgentVisualStatus, theme: ThemeMode): string {
  return SIGNAL_COLORS[theme][status];
}

function stateSignal(health: HostHealthState, theme: ThemeMode): string {
  if (health === "offline") return SIGNAL_COLORS[theme].error;
  if (health === "degraded") return SIGNAL_COLORS[theme].input;
  if (health === "connecting") return SIGNAL_COLORS[theme].unknown;
  return SIGNAL_COLORS[theme].complete;
}

function healthToDisplayState(health: HostHealthState): DisplayLifecycleState {
  switch (health) {
    case "ready": return "ready";
    case "connecting": return "connecting";
    case "offline": return "offline";
    case "degraded": return "stale";
  }
}

function inferDialState(input: PlusDialFeedbackInput, health: HostHealthState): MicroPlusFeedbackStatus {
  if (health !== "ready") return healthToDisplayState(health) as MicroPlusFeedbackStatus;
  if (input.operation?.trim()) return "pending";
  if (input.kind === "agents" && !input.taskTitle?.trim()) return "unknown";
  if ((input.kind === "reasoning" || input.kind === "usage" || input.kind === "model") && input.observedValue == null) return "unknown";
  if (input.kind === "commands" && input.observedValue == null) return "unknown";
  if (input.agentStatus === "unknown") return "unknown";
  return "ready";
}

function semanticValueAllowed(health: HostHealthState, state: MicroPlusFeedbackStatus): boolean {
  return health === "ready" && !["offline", "stale", "unknown", "unavailable"].includes(state);
}

function finitePercent(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value)) / 100;
}

function decodeSvgImage(image: string): string {
  if (!image.startsWith("data:image/svg+xml")) return image;
  const comma = image.indexOf(",");
  if (comma < 0) return image;
  const payload = image.slice(comma + 1);
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

function operationFeedbackColor(phase: OperationFeedbackPhase, theme: ThemeMode): string {
  switch (phase) {
    case "pending": return SIGNAL_COLORS[theme].input;
    case "held": return theme === "dark" ? "#FF5E8A" : "#C52356";
    case "sent-unverified": return SIGNAL_COLORS[theme].unknown;
    case "error": return SIGNAL_COLORS[theme].error;
  }
}

function operationFeedbackLabel(phase: OperationFeedbackPhase, language?: DisplayLanguage): string {
  switch (phase) {
    case "pending": return copy(language, "pending", "処理中");
    case "held": return copy(language, "held", "押下中");
    case "sent-unverified": return copy(language, "unverified", "未確認");
    case "error": return copy(language, "failure", "失敗");
  }
}

export function operationFeedbackDetail(feedback: OperationFeedback, language?: DisplayLanguage): string {
  const raw = feedback.detail?.trim() ?? "";
  if (!raw) return "";
  if (raw === "E_DRAFT_TRANSFER_ATTACHMENTS_UNSUPPORTED") {
    return language === "en" ? "ATTACH UNSUP" : "添付は非対応";
  }
  const codeLabels: Record<string, [CopyKey, string]> = {
    E_DOWNSTREAM_TIMEOUT: ["resultUnverified", "結果未確認"],
    E_RESULT_UNVERIFIED: ["resultUnverified", "結果未確認"],
    E_RELEASE_UNVERIFIED: ["releaseUnverified", "解除未確認"],
    E_TARGET_UNAVAILABLE: ["targetUnavailable", "対象未取得"],
    E_NEW_TASK: ["createFailure", "作成失敗"],
    E_DIAL_ROTATE_UNVERIFIED: ["operationUnverified", "操作未確認"],
    E_DIAL_PRESS: ["pressUnverified", "押下未確認"],
    E_DIAL_RELEASE: ["releaseUnverified", "解除未確認"],
    E_FEEDBACK_RENDER: ["displayUnverified", "表示未確認"],
    E_INPUT_OWNED: ["inputOwned", "他キー操作中"],
    E_FOCUS_FAILED: ["focusFailed", "前面化失敗"],
    E_COMMAND_INACTIVE: ["commandInactive", "現在は使えません"]
  };
  const label = /^E_[A-Z0-9_]+$/u.test(raw)
    ? (codeLabels[raw] ? copy(language, codeLabels[raw][0], codeLabels[raw][1]) : copy(language, "cannotConfirm", "確認不可"))
    : raw;
  // The detail sits beside the state label on a 144px key. Keep it to one
  // measured line so translated errors cannot collide with the state marker.
  return truncateDisplayText(label, 12, 10);
}

function localizeOperation(operation: string, language?: DisplayLanguage): string {
  const clean = sanitizeDisplayText(operation);
  if (!clean || language == null) return clean;
  const normalized = clean.toLowerCase();
  if (language === "ja") {
    if (normalized === "increase") return "上げる";
    if (normalized === "decrease") return "下げる";
    return clean;
  }
  if (normalized === "increase" || clean === "上げる") return "INCREASE";
  if (normalized === "decrease" || clean === "下げる") return "DECREASE";
  return clean;
}
