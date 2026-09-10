import { selectActiveComposerState, type ActiveComposerState } from "./renderer-runtime.js";

export type AgentWindowProbe = {
  activeThreadKey: string | null;
  activeComposerKey: string | null;
  composerPresent: boolean;
  focusedVisible: boolean;
  identityAvailable: boolean;
};

/**
 * Read the committed MemoryRouter location and selected composer without
 * importing renderer assets, reading Micro settings, or dispatching events.
 * This function is closure-free so its source can be evaluated in a renderer.
 */
export function readAgentWindowProbe(
  doc: Document,
  resolveActiveComposer: (document: Document) => ActiveComposerState,
  resolvedComposer?: ActiveComposerState,
): AgentWindowProbe {
  const activeComposer = resolvedComposer ?? resolveActiveComposer(doc);
  const composerRoot = activeComposer.root;
  const routeKeys = new Set<string>();
  const locationFibers: any[] = [];
  // DOM-attached fibers may still return through the previous tree after a
  // React bailout. Find the node in the committed child graph and retain its
  // logical parents; following return/alternate alone is not sufficient.
  const attachedKeys = composerRoot
    ? Object.getOwnPropertyNames(composerRoot).filter((key) => key.startsWith("__reactFiber$"))
    : [];
  const attachedFiber = composerRoot && attachedKeys.length === 1
    ? (composerRoot as any)[attachedKeys[0]!]
    : null;
  const container = doc.getElementById("root");
  const containerKeys = container
    ? Object.getOwnPropertyNames(container).filter((key) => key.startsWith("__reactContainer$"))
    : [];
  let attachedRoot = attachedFiber ?? (container && containerKeys.length === 1
    ? (container as any)[containerKeys[0]!]
    : null);
  const returnSeen = new Set<any>();
  while (attachedRoot?.return && returnSeen.size < 30000 && !returnSeen.has(attachedRoot)) {
    returnSeen.add(attachedRoot);
    attachedRoot = attachedRoot.return;
  }
  const committedRoot = attachedRoot?.tag === 3 ? attachedRoot.stateNode?.current : null;
  const validRoot = committedRoot?.tag === 3
    && committedRoot.stateNode === attachedRoot.stateNode;
  const parents = new Map<any, any>();
  const queue: any[] = validRoot ? [committedRoot] : [];
  if (validRoot) parents.set(committedRoot, null);
  let composerFiber: any = null;
  let graphInvalid = !validRoot;
  for (let index = 0; index < queue.length; index += 1) {
    if (index >= 30000) { graphInvalid = true; break; }
    const fiber = queue[index];
    if (composerRoot && (fiber === attachedFiber || fiber === attachedFiber?.alternate)
      && fiber.stateNode === composerRoot) {
      composerFiber = fiber;
      break;
    }
    if (!composerRoot) locationFibers.push(fiber);
    for (let child = fiber.child; child; child = child.sibling) {
      if (parents.has(child) || parents.size >= 30000) { graphInvalid = true; break; }
      parents.set(child, fiber);
      queue.push(child);
    }
    if (graphInvalid) break;
  }
  if (composerFiber && !graphInvalid) {
    for (let current = composerFiber; current; current = parents.get(current)) {
      locationFibers.push(current);
    }
  }

  for (const fiber of locationFibers) {
    const context = fiber?.type?._context ?? fiber?.type;
    if (fiber?.tag !== 10 || context?.displayName !== "Location") continue;
    const value = fiber.memoizedProps?.value;
    const location = value?.location;
    if (
      (value?.navigationType === "POP" || value?.navigationType === "PUSH" || value?.navigationType === "REPLACE")
      && typeof location?.pathname === "string"
      && location.pathname.startsWith("/")
      && typeof location?.search === "string"
      && typeof location?.hash === "string"
      && typeof location?.key === "string"
    ) routeKeys.add(`${location.pathname}\u0000${location.search}`);
    if (composerRoot) break;
  }

  let activeComposerKey: string | null = null;
  if (composerRoot) {
    const globalState = globalThis as typeof globalThis & {
      __codexDeckComposerIds?: { ids: WeakMap<object, string>; next: number };
    };
    const composerIds = globalState.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
    if (!composerIds.ids.has(composerRoot)) composerIds.ids.set(composerRoot, `composer-${++composerIds.next}`);
    activeComposerKey = composerIds.ids.get(composerRoot) ?? null;
  }

  const base = {
    activeComposerKey,
    composerPresent: composerRoot != null,
    focusedVisible: doc.hasFocus() && doc.visibilityState === "visible",
  };
  if (graphInvalid || (composerRoot && !composerFiber) || routeKeys.size !== 1) {
    return { ...base, activeThreadKey: null, identityAvailable: false };
  }
  const [routeKey] = routeKeys;
  const separator = routeKey!.indexOf("\u0000");
  const pathname = routeKey!.slice(0, separator);
  const localMatch = /^\/local\/([^/?#]+)$/u.exec(pathname);
  if (localMatch) {
    let conversationId: string;
    try { conversationId = decodeURIComponent(localMatch[1]!); }
    catch { return { ...base, activeThreadKey: null, identityAvailable: false }; }
    if (!/^[A-Za-z0-9_-]+$/u.test(conversationId)) {
      return { ...base, activeThreadKey: null, identityAvailable: false };
    }
    const canonical = `local:${conversationId}`;
    if (!composerRoot || (activeComposer.activeThreadKey !== conversationId
      && activeComposer.activeThreadKey !== canonical)) {
      return { ...base, activeThreadKey: null, identityAvailable: false };
    }
    return { ...base, activeThreadKey: canonical, identityAvailable: true };
  }

  // A mounted composer with no thread id on the new-task route is a proven
  // empty source. Other task kinds remain unavailable rather than guessing a
  // local identity from an unscoped conversation id.
  if ((pathname === "/" || pathname === "/new") && composerRoot && !activeComposer.activeThreadKey) {
    return { ...base, activeThreadKey: null, identityAvailable: true };
  }
  if (!composerRoot && pathname === "/") {
    return { ...base, activeThreadKey: null, identityAvailable: true };
  }
  return { ...base, activeThreadKey: null, identityAvailable: false };
}

function canonicalizeActiveComposerState(
  active: ActiveComposerState,
  probe: AgentWindowProbe,
): ActiveComposerState {
  if (!probe.identityAvailable) return active;
  if (probe.activeThreadKey == null) {
    const cleared = { ...active };
    delete cleared.activeThreadKey;
    return cleared;
  }
  return { ...active, activeThreadKey: probe.activeThreadKey };
}

/** Resolve the same scoped active-thread identity used by SNAPSHOT. */
export function selectCanonicalActiveComposerState(doc: Document): ActiveComposerState {
  const resolveBase = selectActiveComposerState;
  const active = resolveBase(doc);
  const probe = typeof doc.getElementById === "function"
    ? readAgentWindowProbe(doc, resolveBase, active)
    : { identityAvailable: false } as AgentWindowProbe;
  return canonicalizeActiveComposerState(active, probe);
}

/**
 * Closure-free resolver source for bridge expressions. Unknown routes retain
 * the base resolver's value; only a committed local route is canonicalized.
 */
export const CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION = `((document) => {
  const resolveBase = (${selectActiveComposerState.toString()});
  const readProbe = (${readAgentWindowProbe.toString()});
  const canonicalize = (${canonicalizeActiveComposerState.toString()});
  const active = resolveBase(document);
  const probe = typeof document.getElementById === 'function'
    ? readProbe(document, resolveBase, active)
    : { identityAvailable: false };
  return canonicalize(active, probe);
})`;

export const AGENT_WINDOW_PROBE_EXPRESSION = `(() => {
  const resolveActiveComposer = (${selectActiveComposerState.toString()});
  const readProbe = (${readAgentWindowProbe.toString()});
  return readProbe(document, resolveActiveComposer);
})()`;
