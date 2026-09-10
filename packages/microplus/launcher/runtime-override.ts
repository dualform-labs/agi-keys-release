import { reviewedRuntimePrelude } from "./reviewed-runtime.js";
import { CdpClient } from "./cdp-client.js";
import { basename } from "node:path";
import { validateLoopbackWebSocketUrl } from "../src/renderer-security.js";
import {
  enumerateCodexMainTargets,
  FOREGROUND_RENDERER_PROBE_EXPRESSION,
  resolveForegroundCodexTarget,
  selectCodexMainTarget,
  type DebugTarget,
  type RendererFocusState,
} from "../src/codex-debug-discovery.js";

const MICRO_GATE = "3207467860";
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("E_CDP_PROBE_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildRuntimeOverrideExpression(gateName = MICRO_GATE): string {
  if (!/^\d+$/.test(gateName)) throw new Error("The feature gate must contain digits only.");

  return `(async () => {
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
    ${reviewedRuntimePrelude()}
    const gateName = ${JSON.stringify(gateName)};
    const statsig = globalThis.__STATSIG__;
    if (!statsig) return { ready: false, reason: 'statsig-unavailable' };

    const clients = [...new Set([statsig.firstInstance, ...Object.values(statsig.instances ?? {})].filter(Boolean))];
    if (clients.length === 0) return { ready: false, reason: 'statsig-client-unavailable' };

    for (const client of clients) {
      if (client.overrideAdapter?.__codexDeckGate !== gateName) {
        const original = client.overrideAdapter ?? {};
        client.overrideAdapter = new Proxy(original, {
          get(target, property) {
            if (property === '__codexDeckGate') return gateName;
            if (property === 'getGateOverride') {
              return (gate, user, options) => {
                if (gate?.name === gateName) return { ...gate, value: true };
                const fallback = Reflect.get(target, property, target);
                return typeof fallback === 'function' ? fallback.call(target, gate, user, options) : gate;
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
      client._memoCache = {};
    }

    const detected = null;
    const detectionMethod = 'native-device-event';
    for (const client of clients) client.$emt?.({ name: 'values_updated' });
    const likelyModules = [initialUrl];
    let nativeEventBus = false;
    let deviceHandlers = 0;
    let deviceEventDispatched = false;
    const eventDeadline = Date.now() + 5000;
    while (Date.now() < eventDeadline && !deviceEventDispatched) {
      for (const url of likelyModules) {
        try {
          const bus = reviewedBus;
          if (!bus) continue;
          nativeEventBus = true;
          deviceHandlers = bus.handlers instanceof Map
            ? (bus.handlers.get('codex-micro-device-state-changed')?.size ?? 0)
            : 1;
          if (deviceHandlers === 0) continue;
          if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
          const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
          dispatch.call(bus, ${JSON.stringify({
            type: "codex-micro-device-state-changed",
            state: { status: "connected", error: null, controlPlaneStatus: "unavailable", battery: null }
          })});
          deviceEventDispatched = true;
          break;
        } catch { /* Ignore unrelated already-loaded renderer chunks. */ }
      }
      if (!deviceEventDispatched) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const enabled = clients.map((client) => Boolean(client.checkGate?.(gateName)));
    return {
      ready: enabled.every(Boolean) && (detected === true || deviceEventDispatched),
      enabled,
      detected,
      detectionMethod,
      nativeEventBus,
      deviceHandlers,
      deviceEventDispatched,
      clients: clients.length
    };
  })()`;
}

export function buildRuntimeVerificationExpression(): string {
  return `(async () => {
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
    ${reviewedRuntimePrelude()}
    const likelyModules = [initialUrl];
    const bus = reviewedBus;
    const hidHandlers = bus?.handlers instanceof Map ? (bus.handlers.get('codex-micro-hid-event')?.size ?? 0) : 0;
    const joystickHandlers = bus?.handlers instanceof Map ? (bus.handlers.get('codex-micro-joystick-event')?.size ?? 0) : 0;
    const settingsLink = Boolean(document.querySelector('[href*="/settings/codex-micro"]'));
    const statsig = globalThis.__STATSIG__;
    const clients = [...new Set([statsig?.firstInstance, ...Object.values(statsig?.instances ?? {})].filter(Boolean))];
    const menuEnabled = settingsLink || (clients.length > 0 && clients.every((client) => Boolean(client.checkGate?.(${JSON.stringify(MICRO_GATE)}))));
    return {
      ready: menuEnabled && Boolean(bus) && hidHandlers > 0 && joystickHandlers > 0,
      menuEnabled,
      nativeEventBus: Boolean(bus),
      hidHandlers,
      joystickHandlers,
      modulesInspected: likelyModules.length
    };
  })()`;
}

export function selectRuntimeTarget(targets: DebugTarget[]): DebugTarget | undefined {
  return selectCodexMainTarget(targets);
}

function isFocusedVisibleRenderer(value: unknown): value is RendererFocusState {
  const state = value as Partial<RendererFocusState> | null;
  return state?.hasFocus === true && state.visibilityState === "visible";
}

async function probeTarget(target: DebugTarget, port: number): Promise<RendererFocusState | undefined> {
  if (!target.webSocketDebuggerUrl) return undefined;
  const client = new CdpClient(validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl, port));
  try {
    await withTimeout(client.connect(), 1500);
    const value = await withTimeout(client.evaluate(FOREGROUND_RENDERER_PROBE_EXPRESSION), 1500);
    return isFocusedVisibleRenderer(value) ? value : undefined;
  } finally {
    client.close();
  }
}

export function runtimeTargetSetSignature(targets: DebugTarget[]): string {
  return enumerateCodexMainTargets(targets)
    .map((target) => target.id ?? target.webSocketDebuggerUrl ?? "")
    .sort()
    .join("\u0000");
}

export async function fetchRuntimeTargetSetSignature(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) throw new Error("E_FOREGROUND_TARGET_UNAVAILABLE");
  return runtimeTargetSetSignature(await response.json() as DebugTarget[]);
}

async function findTarget(port: number, timeout = 20_000, expectedTargetId?: string): Promise<DebugTarget> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        const targets = await response.json() as DebugTarget[];
        const target = await resolveForegroundCodexTarget(targets, (candidate) => probeTarget(candidate, port));
        if (target) {
          const identity = target.id ?? target.webSocketDebuggerUrl;
          if (expectedTargetId && identity !== expectedTargetId) throw new Error("E_FOREGROUND_TARGET_CHANGED");
          return target;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "E_FOREGROUND_TARGET_CHANGED") throw error;
      /* Codex is still starting. */
    }
    await delay(250);
  }
  throw new Error("E_FOREGROUND_TARGET_UNAVAILABLE");
}

export type RuntimeOverrideResult = Record<string, unknown> & { targetId: string };

export async function applyRuntimeOverride(port: number, timeout = 20_000): Promise<RuntimeOverrideResult> {
  const target = await findTarget(port, timeout);
  const client = new CdpClient(validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl!, port));
  try {
    await client.connect();
    const deadline = Date.now() + timeout;
    let result: unknown;
    while (Date.now() < deadline) {
      result = await client.evaluate(buildRuntimeOverrideExpression());
      if ((result as { ready?: boolean } | null)?.ready) {
        return { ...(result as Record<string, unknown>), targetId: target.id ?? target.webSocketDebuggerUrl! };
      }
      await delay(100);
    }
    throw new Error(`Timed out enabling the Codex Micro runtime: ${JSON.stringify(result)}`);
  } finally {
    client.close();
  }
}

export async function verifyMicroRuntime(port: number, timeout = 20_000, expectedTargetId?: string): Promise<unknown> {
  const target = await findTarget(port, timeout, expectedTargetId);
  const client = new CdpClient(validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl!, port));
  try {
    await client.connect();
    const deadline = Date.now() + timeout;
    let result: unknown;
    while (Date.now() < deadline) {
      result = await client.evaluate(buildRuntimeVerificationExpression());
      if ((result as { ready?: boolean } | null)?.ready) return result;
      await delay(250);
    }
    throw new Error(`Timed out verifying the Codex Micro runtime: ${JSON.stringify(result)}`);
  } finally {
    client.close();
  }
}

if (process.argv[1] && ["runtime-override.mjs", "runtime-override.ts"].includes(basename(process.argv[1]))) {
  const port = Number.parseInt(process.argv[2] ?? "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Usage: node runtime-override.mjs <port>");
  const result = await applyRuntimeOverride(port);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
