import type { NativeUiRoute, NativeUiSurface } from "./command-result-observer.js";
export type { NativeUiRoute, NativeUiSurface } from "./command-result-observer.js";

import { MODEL_PICKER_FAILURE_CODES, DRAFT_TRANSFER_FAILURE_CODES, type ModelPickerFailureCode } from "./failure-codes.js";
export { MODEL_PICKER_FAILURE_CODES, DRAFT_TRANSFER_FAILURE_CODES, type ModelPickerFailureCode } from "./failure-codes.js";

export type ActiveComposerState = { root: Element | null; activeThreadKey?: string };

/**
 * Focus the sole live native editor owned by an already-selected composer.
 * The caller must revalidate its thread/composer identity after focus because
 * native focus handlers may synchronously change the active task.
 */
export function focusSelectedComposerForPtt(doc: Document, root: Element | null): void {
  if (!root || root.closest('[hidden], [aria-hidden="true"], [inert]')) {
    throw new Error("E_PTT_COMPOSER_INPUT_UNAVAILABLE");
  }
  const inputs = [...root.querySelectorAll('[data-codex-composer]')].filter((candidate) => {
    if (candidate.closest('[data-codex-composer-root]') !== root) return false;
    if (candidate.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    return typeof candidate.getClientRects !== "function" || candidate.getClientRects().length > 0;
  });
  if (inputs.length !== 1) throw new Error(
    inputs.length === 0 ? "E_PTT_COMPOSER_INPUT_UNAVAILABLE" : "E_PTT_COMPOSER_INPUT_AMBIGUOUS",
  );
  const input = inputs[0] as HTMLElement;
  if (typeof input.focus !== "function") throw new Error("E_PTT_COMPOSER_INPUT_UNAVAILABLE");
  if (!input.contains(doc.activeElement)) input.focus();
  if (!input.contains(doc.activeElement)) throw new Error("E_PTT_COMPOSER_FOCUS_FAILED");
}

export type NativeCurrentModel = {
  modelId: string;
  modelLabel: string;
  selectionMode: "default" | "model";
};

/** Resolve the unique pinned native PIr owner for the exact bound trigger. */
export function selectNativeModelPickerOwner(
  composerRoot: Element | null,
  trigger: Element | null,
  appPrimaryVerified: boolean,
): any | null {
  if (!appPrimaryVerified || !composerRoot || !trigger || !composerRoot.contains(trigger)) return null;
  const fiberKeys = Object.getOwnPropertyNames(trigger).filter((key) => key.startsWith("__reactFiber$"));
  if (fiberKeys.length !== 1) return null;
  let fiber: any = (trigger as any)[fiberKeys[0]!];
  if (!fiber) return null;
  let attachedRoot = fiber;
  while (attachedRoot.return) attachedRoot = attachedRoot.return;
  const committedRoot = attachedRoot.stateNode?.current;
  if (!committedRoot || attachedRoot.tag !== 3 || committedRoot.tag !== 3
    || committedRoot.stateNode !== attachedRoot.stateNode) return null;

  // React's current-fiber slow path permits an unchanged bailout subtree to be
  // shared by both roots even though its return pointer still ends at the old
  // root and it has no alternate. Walk only the committed root's child graph
  // and retain that graph's logical ancestry rather than trusting return links.
  const logicalParent = new Map<any, any>();
  logicalParent.set(committedRoot, null);
  const queue = [committedRoot];
  let currentFiber: any = null;
  for (let index = 0; index < queue.length && index < 30000; index += 1) {
    const current = queue[index];
    if (current === fiber || current === fiber.alternate) {
      currentFiber = current;
      break;
    }
    for (let child = current.child; child; child = child.sibling) {
      if (logicalParent.has(child)) return null;
      logicalParent.set(child, current);
      queue.push(child);
    }
  }
  if (!currentFiber || currentFiber.stateNode !== trigger) return null;
  const matches: any[] = [];
  let reachedComposerRoot = false;
  for (let current = currentFiber; current; current = logicalParent.get(current) ?? null) {
    const type = current.type;
    const props = current.memoizedProps;
    if (typeof type === "function" && props && typeof props === "object") {
      let source = "";
      try { source = Function.prototype.toString.call(type); } catch {}
      if (source.includes("modelPickerTriggerConfig")
        && source.includes("onBeforeSelectModel")
        && source.includes("onSelectModel")
        && source.includes("triggerButton")
        && typeof props.model === "string"
        && (props.models == null || Array.isArray(props.models))
        && (props.selectionMode === "default" || props.selectionMode === "model")
        && typeof props.onSelectModel === "function"
        && typeof props.onOpenChange === "function") matches.push(props);
    }
    if (current.stateNode === composerRoot) {
      reachedComposerRoot = true;
      break;
    }
  }
  return reachedComposerRoot && matches.length === 1 ? matches[0] : null;
}

/** Read canonical current-model values from native PIr props already rendered. */
export function readNativeCurrentModel(
  composerRoot: Element | null,
  trigger: Element | null,
  appPrimaryVerified: boolean,
  ownerSelector: typeof selectNativeModelPickerOwner = selectNativeModelPickerOwner,
): NativeCurrentModel | null {
  const props = ownerSelector(composerRoot, trigger, appPrimaryVerified);
  if (!props) return null;
  const modelId = props.model;
  if (modelId.length < 1 || modelId.length > 512) return null;
  const metadata = Array.isArray(props.models)
    ? props.models.find((candidate: any) => candidate?.model === modelId)
    : null;
  const displayName = typeof metadata?.displayName === "string"
    ? metadata.displayName.replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  return {
    modelId,
    modelLabel: displayName || modelId,
    selectionMode: props.selectionMode,
  };
}


/**
 * Mirrors the native current-composer preference as far as its passive DOM
 * contract allows: focused composer, active sidebar task, current composer
 * input, then an unambiguous sole composer. Conversation ids are scoped to the
 * selected root; a sidebar key remains canonical (`local:`/`remote:` included).
 */
export function selectActiveComposerState(doc: Document): ActiveComposerState {
  const roots: Element[] = [];
  for (const candidate of doc.querySelectorAll('[data-codex-composer-root]')) {
    // Native dictation replaces the normal footer controls with a voice footer,
    // temporarily removing every navigation target while leaving the exact
    // composer input mounted inside the same root. Either live anchor proves a
    // composer root; hidden transition copies remain ineligible.
    const navigation = candidate.querySelector('[data-composer-navigation-target]');
    const composerInput = candidate.querySelector('[data-codex-composer]');
    if ((!navigation && !composerInput) || candidate.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
    const hasVisibleAnchor = [navigation, composerInput].some((anchor) => anchor
      && (typeof anchor.getClientRects !== 'function' || anchor.getClientRects().length > 0));
    if (!hasVisibleAnchor) continue;
    roots.push(candidate);
  }
  const sidebar = doc.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active="true"]')
    ?? doc.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]');
  const sidebarKey = sidebar?.getAttribute('data-app-action-sidebar-thread-id') ?? null;
  const sidebarMatches: Element[] = [];
  if (sidebarKey) for (const candidate of roots) {
    const raw = candidate.querySelector('[data-above-composer-conversation-id]')
      ?.getAttribute('data-above-composer-conversation-id') ?? null;
    if (raw && (sidebarKey === raw || sidebarKey.endsWith(':' + raw))) sidebarMatches.push(candidate);
  }
  const focused = doc.activeElement?.closest('[data-codex-composer-root]') ?? null;
  let root = focused && roots.includes(focused) ? focused : null;
  if (!root) {
    const openPickerRoots: Element[] = [];
    for (const candidate of roots) {
      const trigger = candidate.querySelector(
        '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
      );
      if (trigger && (trigger.getAttribute('aria-expanded') === 'true'
        || trigger.getAttribute('data-state') === 'open'
        || trigger.hasAttribute('data-composer-navigation-open'))) openPickerRoots.push(candidate);
    }
    if (openPickerRoots.length === 1) root = openPickerRoots[0] ?? null;
  }
  if (!root && sidebarKey) {
    root = sidebarMatches.length === 1 ? sidebarMatches[0] ?? null : null;
  }
  if (!root) {
    const uniqueInputRoots = new Set<Element>();
    for (const input of doc.querySelectorAll('[data-codex-composer]')) {
      const candidate = input.closest('[data-codex-composer-root]');
      if (candidate && roots.includes(candidate)) uniqueInputRoots.add(candidate);
    }
    root = uniqueInputRoots.size === 1 ? [...uniqueInputRoots][0] ?? null : null;
  }
  if (!root && roots.length === 1) root = roots[0] ?? null;
  if (!root) return { root: null };
  const raw = root.querySelector('[data-above-composer-conversation-id]')
    ?.getAttribute('data-above-composer-conversation-id') ?? null;
  let sameRawRootCount = 0;
  if (raw) for (const candidate of roots) {
    const candidateRaw = candidate.querySelector('[data-above-composer-conversation-id]')
      ?.getAttribute('data-above-composer-conversation-id') ?? null;
    if (candidateRaw === raw) sameRawRootCount += 1;
  }
  const activeThreadKey = sidebarKey && sidebarMatches.length === 1 && sidebarMatches[0] === root
    ? sidebarKey
    : sameRawRootCount === 1 ? raw : null;
  return { root, ...(activeThreadKey ? { activeThreadKey } : {}) };
}

/**
 * Read only renderer-visible structure for native UI commands. The function
 * is closure-free because the bridge injects its source into a CDP expression.
 * It deliberately excludes URL suffixes/query values, tab ids, file paths,
 * titles, prompts, and message content.
 */
export function readNativeUiSurface(doc: Document): NativeUiSurface {
  const pathname = typeof doc.defaultView?.location?.pathname === "string"
    ? doc.defaultView.location.pathname
    : "";
  let route: NativeUiRoute = pathname ? "other" : null;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    route = pathname === "/settings/codex-micro" || pathname.startsWith("/settings/codex-micro/")
      ? "codex-micro-settings"
      : "settings";
  } else if (pathname === "/skills" || pathname.startsWith("/skills/")
    || pathname === "/plugins" || pathname.startsWith("/plugins/")) {
    route = "skills";
  }

  let terminalVisible = false;
  for (const element of doc.querySelectorAll("[data-codex-terminal], [data-codex-xterm]")) {
    if (element.getAttribute("aria-hidden") !== "true") {
      terminalVisible = true;
      break;
    }
  }
  let reviewVisible = false;
  for (const element of doc.querySelectorAll("[data-diffs-header], [data-file-tree-id], [data-review-path]")) {
    if (element.getAttribute("aria-hidden") !== "true") {
      reviewVisible = true;
      break;
    }
  }
  let browserTabCount = 0;
  for (const element of doc.querySelectorAll("[data-browser-sidebar-browser-tab-id]")) {
    if (element.getAttribute("aria-hidden") !== "true") browserTabCount += 1;
  }

  return {
    route,
    terminalVisible,
    reviewVisible,
    browserTabCount,
  };
}

/**
 * Matches a native scoped task key against the currently bound composer.
 * Only the resolver's canonical identity is sufficient: a raw conversation id
 * cannot prove which local host owns the selected task.
 */
export function matchesActiveThreadSelection(
  doc: Document,
  requestedThreadKey: string,
  resolveActiveComposer: (document: Document) => ActiveComposerState = selectActiveComposerState,
): boolean {
  if (!requestedThreadKey.includes(":") || requestedThreadKey.length > 512) return false;
  const active = resolveActiveComposer(doc);
  if (!active.root || !active.activeThreadKey?.includes(":")) return false;
  return active.activeThreadKey === requestedThreadKey;
}

export function selectNativeCommandRunner(
  namespace: Record<string, unknown>,
  observedBridgeSha256: string,
  observedAppInitialSha256: string,
  expectedBridgeSha256: string,
  expectedAppInitialSha256: string
): ((command: string, source: string) => unknown) | undefined {
  if (observedBridgeSha256 !== expectedBridgeSha256 || observedAppInitialSha256 !== expectedAppInitialSha256) return undefined;
  // Codex 26.908 exports the same two-argument native command runner as Wat.
  // The surrounding asset hashes are part of the contract, so an identically
  // named export from any other build is still rejected above.
  const candidate = namespace.Wat;
  return typeof candidate === "function"
    ? candidate as (command: string, source: string) => unknown
    : undefined;
}

type NativeCommandScope = {
  get(atom: unknown, parameter?: unknown): unknown;
  value?: { kind?: unknown; placement?: unknown };
};

type NativeComposerController = {
  view: {
    isDestroyed?: boolean;
    dom: Element;
    state?: { doc?: { descendants?: (visit: (node: any) => void) => void } };
  };
  getPersistedText(): string;
  setText(text: string): void;
  focus(): void;
};

/**
 * Resolve the renderer scope that owns the active composer. Native Micro gets
 * this scope from React context; selecting the first store in the whole tree
 * can instead pick a hidden composer or another route's nested scope.
 *
 * This function is intentionally closure-free because its source is injected
 * into the renderer expression with `toString()`.
 */
export function selectNativeCommandScope(
  doc: Document,
  composerRoot: Element | null,
  appScopeToken: unknown,
  accessAtom: unknown,
  capabilityAtom: unknown,
  requireCapabilities = false,
  allowReadOnlyFallback = false
): NativeCommandScope | undefined {
  let fiber: any = null;
  if (composerRoot) {
    const keys = Object.getOwnPropertyNames(composerRoot);
    for (const key of keys) {
      if (key.startsWith('__reactFiber$')) {
        fiber = (composerRoot as any)[key];
        break;
      }
    }
  }

  // Native Db(AppScope) keeps the usable scope wrapper in a hook ref. Context
  // dependencies contain only the provider chain and cannot execute atoms.
  for (let current = fiber; current; current = current.return) {
    const matches: any[] = [];
    for (let hook = current.memoizedState; hook; hook = hook.next) {
      const state = hook.memoizedState;
      const candidates = [state?.current, state];
      for (const candidate of candidates) {
        if (!candidate || candidate.scope !== appScopeToken || !candidate.node || !candidate.chain) continue;
        if (typeof candidate.get !== 'function' || typeof candidate.set !== 'function'
          || typeof candidate.watch !== 'function' || typeof candidate.when !== 'function') continue;
        try {
          if (typeof candidate.get(accessAtom) !== 'boolean') continue;
          if (requireCapabilities) {
            const local = candidate.get(capabilityAtom, { name: 'automations.local' });
            const cloud = candidate.get(capabilityAtom, { name: 'automations.cloud' });
            if (typeof local?.isCapable !== 'boolean' || typeof cloud?.isCapable !== 'boolean') continue;
          }
          let duplicate = false;
          for (const prior of matches) {
            if (prior.node === candidate.node && prior.chain === candidate.chain) duplicate = true;
          }
          if (!duplicate) matches.push(candidate);
        } catch {}
      }
    }
    if (matches.length > 1) return undefined;
    if (matches.length === 1) return matches[0];
  }

  // Commands that are not composer-scoped can run on routes without a
  // composer. Retain that support only when the renderer exposes one unique
  // scope with the exact native access/capability shape.
  if (composerRoot && !allowReadOnlyFallback) return undefined;
  const container = doc.getElementById('root');
  let containerFiber: any = null;
  if (container) {
    const keys = Object.getOwnPropertyNames(container);
    for (const key of keys) {
      if (key.startsWith('__reactContainer$')) {
        containerFiber = (container as any)[key];
        break;
      }
    }
  }
  const queue: any[] = containerFiber ? [containerFiber] : [];
  const seen = new Set<any>();
  const matches: any[] = [];
  while (queue.length && seen.size < 30000) {
    const current = queue.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (let hook = current.memoizedState; hook; hook = hook.next) {
      const state = hook.memoizedState;
      const candidates = [state?.current, state];
      for (const candidate of candidates) {
        if (!candidate || candidate.scope !== appScopeToken || !candidate.node || !candidate.chain) continue;
        if (typeof candidate.get !== 'function' || typeof candidate.set !== 'function'
          || typeof candidate.watch !== 'function' || typeof candidate.when !== 'function') continue;
        try {
          if (typeof candidate.get(accessAtom) !== 'boolean') continue;
          if (requireCapabilities) {
            const local = candidate.get(capabilityAtom, { name: 'automations.local' });
            const cloud = candidate.get(capabilityAtom, { name: 'automations.cloud' });
            if (typeof local?.isCapable !== 'boolean' || typeof cloud?.isCapable !== 'boolean') continue;
          }
          let duplicate = false;
          for (const prior of matches) {
            if (prior.node === candidate.node && prior.chain === candidate.chain) duplicate = true;
          }
          if (!duplicate) matches.push(candidate);
        } catch {}
      }
    }
    queue.push(current.child, current.sibling);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Verify the native side-chat result without treating an arbitrary task switch
 * as success. In the current Codex build the selected AppScope wrappers expose
 * `scope.value` as null, so identity comes from the composer surfaces: the
 * original composer remains mounted, exactly one additional scoped composer
 * exists, and that new surface becomes active.
 *
 * This function is closure-free because its source is injected into the
 * renderer expression with `toString()`.
 */
export function selectVerifiedOpenedSideChat(
  doc: Document,
  originalMainRoot: Element | null,
  selectScope: typeof selectNativeCommandScope,
  appScopeToken: unknown,
  accessAtom: unknown,
  capabilityAtom: unknown,
  resolveActiveComposer: (document: Document) => ActiveComposerState = selectActiveComposerState,
  originalComposerRoots?: readonly Element[],
): ActiveComposerState | null {
  if (!originalMainRoot || originalMainRoot.isConnected !== true) return null;
  const roots = [...doc.querySelectorAll('[data-codex-composer-root]')]
    .filter((root) => root.isConnected === true);
  if (!roots.includes(originalMainRoot)) return null;
  const active = resolveActiveComposer(doc);
  if (originalComposerRoots) {
    if (!originalComposerRoots.includes(originalMainRoot)) return null;
    const addedRoots = roots.filter((root) => !originalComposerRoots.includes(root));
    if (addedRoots.length === 0) {
      // Codex may keep an existing side composer mounted and only activate it
      // on the next openSideChat command. Accept that reuse only for the exact
      // two-root layout and only when both roots retain the reviewed AppScope.
      if (originalComposerRoots.length !== 2 || roots.length !== 2
        || !active.root || active.root === originalMainRoot
        || !originalComposerRoots.includes(active.root)) return null;
      if (!selectScope(doc, originalMainRoot, appScopeToken, accessAtom, capabilityAtom, false)
        || !selectScope(doc, active.root, appScopeToken, accessAtom, capabilityAtom, false)) return null;
      return active;
    }
    if (addedRoots.length !== 1) return null;
    const openedRoot = addedRoots[0]!;
    if (active.root && active.root !== originalMainRoot && active.root !== openedRoot) return null;
    if (!selectScope(doc, originalMainRoot, appScopeToken, accessAtom, capabilityAtom, false)
      || !selectScope(doc, openedRoot, appScopeToken, accessAtom, capabilityAtom, false)) return null;
    return { root: openedRoot, ...(active.root === openedRoot && active.activeThreadKey
      ? { activeThreadKey: active.activeThreadKey }
      : {}) };
  } else {
    if (!active.root || active.root === originalMainRoot || !roots.includes(active.root) || !active.activeThreadKey) return null;
    if (roots.length !== 2) return null;
    if (roots.some((root) => !selectScope(doc, root, appScopeToken, accessAtom, capabilityAtom, false))) return null;
  }
  return active;
}

/**
 * Move the plain-text draft from the visible side composer to the visible main
 * composer. This is closure-free so its exact source can run in the pinned
 * renderer and in the synthetic contract tests.
 */
export function moveSideDraftToMainInDocument(
  doc: Document,
  selectScope: typeof selectNativeCommandScope,
  appScopeToken: unknown,
  accessAtom: unknown,
  capabilityAtom: unknown,
): "moved" {
  const roots = [...doc.querySelectorAll('[data-codex-composer-root]')];
  const surfaces: Array<{
    root: Element;
    scope: NativeCommandScope;
    controller: NativeComposerController;
    committedSideIdentity: boolean;
    committedMainIdentity: boolean;
  }> = [];

  for (const root of roots) {
    if (root.isConnected !== true) continue;
    const scope = selectScope(doc, root, appScopeToken, accessAtom, capabilityAtom, false);
    if (!scope) continue;
    const placement = scope.value?.placement;
    // Current AppScope.value is an empty object, not legacy placement metadata.
    // Only explicit legacy identity fields can exclude a composer here.
    if ((scope.value?.kind != null || placement != null)
      && (scope.value?.kind !== 'local' || (placement !== 'side' && placement !== 'main'))) continue;

    const fiberKeys = Object.getOwnPropertyNames(root).filter((key) => key.startsWith('__reactFiber$'));
    if (fiberKeys.length !== 1) throw new Error('E_DRAFT_TRANSFER_COMPOSER_AMBIGUOUS');
    const attachedFiber: any = (root as any)[fiberKeys[0]!];
    let attachedRoot = attachedFiber;
    while (attachedRoot?.return) attachedRoot = attachedRoot.return;
    const committedRoot = attachedRoot?.stateNode?.current;
    if (!committedRoot || attachedRoot?.tag !== 3 || committedRoot.tag !== 3
      || committedRoot.stateNode !== attachedRoot.stateNode) {
      throw new Error('E_DRAFT_TRANSFER_COMPOSER_AMBIGUOUS');
    }
    const hostQueue: any[] = [committedRoot];
    const hostSeen = new Set<any>();
    const logicalParent = new Map<any, any>([[committedRoot, null]]);
    let hostFiber: any = null;
    while (hostQueue.length && hostSeen.size < 30000) {
      const fiber = hostQueue.pop();
      if (!fiber || hostSeen.has(fiber)) continue;
      hostSeen.add(fiber);
      if (fiber.stateNode === root) {
        if (hostFiber) throw new Error('E_DRAFT_TRANSFER_COMPOSER_AMBIGUOUS');
        hostFiber = fiber;
      }
      for (let child = fiber.child; child; child = child.sibling) {
        if (logicalParent.has(child)) throw new Error('E_DRAFT_TRANSFER_COMPOSER_AMBIGUOUS');
        logicalParent.set(child, fiber);
        hostQueue.push(child);
      }
    }
    if (!hostFiber) throw new Error('E_DRAFT_TRANSFER_COMPOSER_AMBIGUOUS');
    let hasSideChatState = false;
    let hasSideChatTab = false;
    let hasThreadSurfacePlacement = false;
    for (let fiber: any = hostFiber; fiber; fiber = logicalParent.get(fiber)) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(props, 'showSideChatEmptyState')) hasSideChatState = true;
      if (Object.prototype.hasOwnProperty.call(props, 'SideChatTab')) hasSideChatTab = true;
      if (props.surfacePlacement?.kind === 'thread') hasThreadSurfacePlacement = true;
    }
    const committedSideIdentity = hasSideChatState && hasSideChatTab;
    const committedMainIdentity = root.getAttribute('data-composer-placement') === 'thread'
      && hasThreadSurfacePlacement;
    const queue: any[] = [];
    for (let child = hostFiber.child; child; child = child.sibling) queue.push(child);
    const seen = new Set<any>();
    const candidates: NativeComposerController[] = [];
    while (queue.length && seen.size < 5000) {
      const fiber = queue.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const candidate = fiber.memoizedProps?.composerController;
      if (candidate && !candidates.includes(candidate)
        && typeof candidate.getPersistedText === 'function' && typeof candidate.setText === 'function'
        && typeof candidate.focus === 'function' && candidate.view?.dom
        && !candidate.view.isDestroyed && root.contains(candidate.view.dom)) candidates.push(candidate);
      for (let child = fiber.child; child; child = child.sibling) queue.push(child);
    }
    if (candidates.length !== 1) throw new Error('E_DRAFT_TRANSFER_CONTROLLER_AMBIGUOUS');
    surfaces.push({ root, scope, controller: candidates[0]!, committedSideIdentity, committedMainIdentity });
  }

  const side: typeof surfaces = [];
  const main: typeof surfaces = [];
  for (const surface of surfaces) {
    const placement = surface.scope.value?.placement;
    if (placement === 'side' || (placement == null && surface.committedSideIdentity)) side.push(surface);
    if (placement === 'main'
      || (placement == null && surface.committedMainIdentity && !surface.committedSideIdentity)) main.push(surface);
  }
  if (side.length !== 1 || main.length !== 1) throw new Error('E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS');
  if (side[0]!.scope === main[0]!.scope || side[0]!.controller === main[0]!.controller) {
    throw new Error('E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS');
  }

  const source = side[0]!;
  const destination = main[0]!;
  const attachmentSelector = '[data-composer-attachments][data-visible-attachments]';
  if (source.root.querySelector(attachmentSelector) != null || destination.root.querySelector(attachmentSelector) != null) {
    throw new Error('E_DRAFT_TRANSFER_ATTACHMENTS_UNSUPPORTED');
  }

  let hasRichContent = false;
  for (const controller of [source.controller, destination.controller]) {
    const descendants = controller.view.state?.doc?.descendants;
    if (typeof descendants !== 'function') {
      hasRichContent = true;
      continue;
    }
    descendants.call(controller.view.state!.doc, function (node: any) {
      const name = node?.type?.name;
      if (!['doc', 'paragraph', 'text', 'hard_break'].includes(name)) hasRichContent = true;
      if (node?.marks?.length) hasRichContent = true;
    });
  }
  if (hasRichContent) {
    throw new Error('E_DRAFT_TRANSFER_RICH_CONTENT_UNSUPPORTED');
  }

  const sourceText = source.controller.getPersistedText();
  if (typeof sourceText !== 'string' || sourceText.length === 0) throw new Error('E_DRAFT_TRANSFER_SOURCE_EMPTY');
  const destinationText = destination.controller.getPersistedText();
  if (typeof destinationText !== 'string' || destinationText.length !== 0) {
    throw new Error('E_DRAFT_TRANSFER_DESTINATION_NOT_EMPTY');
  }

  try {
    destination.controller.setText(sourceText);
  } catch {
    throw new Error('E_DRAFT_TRANSFER_DESTINATION_WRITE');
  }
  if (destination.controller.getPersistedText() !== sourceText) {
    try { destination.controller.setText(''); } catch {}
    throw new Error('E_DRAFT_TRANSFER_DESTINATION_READBACK');
  }

  let sourceClearThrew = false;
  try { source.controller.setText(''); } catch { sourceClearThrew = true; }
  let sourceAfter: string;
  try { sourceAfter = source.controller.getPersistedText(); }
  catch {
    // The source may already be empty. Keep the verified destination copy so
    // an ambiguous readback cannot lose the only remaining draft.
    throw new Error('E_DRAFT_TRANSFER_SOURCE_READBACK');
  }
  if (sourceAfter !== '') {
    if (sourceAfter === sourceText) {
      try { destination.controller.setText(''); } catch {}
      if (destination.controller.getPersistedText() !== '') {
        throw new Error('E_DRAFT_TRANSFER_ROLLBACK_FAILED');
      }
      throw new Error(sourceClearThrew ? 'E_DRAFT_TRANSFER_SOURCE_CLEAR' : 'E_DRAFT_TRANSFER_SOURCE_READBACK');
    }
    // A partial or transformed clear is ambiguous. Retain the verified main
    // copy so every original byte still exists on at least one surface.
    throw new Error('E_DRAFT_TRANSFER_SOURCE_PARTIAL_CLEAR');
  }
  destination.controller.focus();
  return 'moved';
}

export type AgentSlotMetadata = {
  metadataAvailability: "available" | "unavailable";
  goalStatus?: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
  pendingQuestion?: boolean;
  /** Native local-thread approval chip state, when its passive selector is present. */
  approvalPending?: boolean;
  /** Native sidebar pin state, when its passive selector is present. */
  threadPinned?: boolean;
};

/** Read only content-free goal/question state for a local slot conversation. */
export function agentSlotMetadataNamespace(namespace: Record<string, unknown>, current: boolean): Record<string, unknown> {
  if (current) {
    return {
      I4: namespace.B3, jCt: namespace.nEt, gCt: namespace.BTt,
      uCt: namespace.PTt, vCt: namespace.HTt, LCt: namespace.cEt,
      v3: namespace.S6,
      // The 26.903 pin selector was not reviewed; omit it explicitly.
    };
  }
  // Reviewed against Codex 26.908.40834. Keep the stable semantic names used
  // by readAgentSlotMetadata on our side of the version boundary.
  return {
    I4: namespace.ktt,
    jCt: namespace.NOt,
    gCt: namespace.hOt,
    uCt: namespace.uOt,
    vCt: namespace._Ot,
    LCt: namespace.HOt,
    v3: namespace.pnt,
    F2: namespace.Oet,
  };
}

export function readAgentSlotMetadata(
  slot: { threadKey?: string | null },
  store: NativeCommandScope,
  appInitial: Record<string, unknown>
): AgentSlotMetadata {
  if (!slot.threadKey) return { metadataAvailability: "unavailable" };
  try {
    // The thread lookup is the identity contract. Other selectors are detail
    // sources and are version/feature dependent, so one missing export must not
    // hide an otherwise resolvable local slot.
    if (appInitial.I4 == null) return { metadataAvailability: 'unavailable' };
    // I4 is the same thread-key lookup atom used by native Micro's slot signal.
    const task = store.get(appInitial.I4, slot.threadKey) as {
      kind?: unknown;
      conversation?: { id?: unknown } | null;
    } | null;
    const conversationId = task?.kind === 'local' && typeof task.conversation?.id === 'string'
      ? task.conversation.id
      : null;
    if (!conversationId) return { metadataAvailability: 'unavailable' };

    let detailSourceRead = false;
    const readDetail = {
      get(name: string): { ok: boolean; value?: unknown } {
        const selector = appInitial[name];
        if (selector == null) return { ok: false };
        try {
          const value = store.get(selector, conversationId);
          // A mounted selector returning undefined cannot establish an empty
          // state. Preserve that distinction so callers do not display a false
          // negative while the native store is between snapshots.
          if (value === undefined) return { ok: false };
          detailSourceRead = true;
          return { ok: true, value };
        } catch {
          return { ok: false };
        }
      },
    }.get;

    // These pinned app-initial exports are passive selectors over conversation
    // metadata: threadGoal, requests, runtime status, pending type, resume state.
    const goalRead = readDetail('jCt');
    const goal = goalRead.ok ? goalRead.value as { status?: unknown } | null : null;
    const allowedGoalStatuses = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'];
    const goalStatus = typeof goal?.status === 'string' && allowedGoalStatuses.includes(goal.status)
      ? goal.status as AgentSlotMetadata['goalStatus']
      : undefined;
    const requestsRead = readDetail('gCt');
    let pendingQuestion = false;
    let questionSourcesReady = requestsRead.ok && Array.isArray(requestsRead.value);
    if (Array.isArray(requestsRead.value)) {
      for (const request of requestsRead.value) {
        if (request?.method === 'item/tool/requestUserInput') {
          pendingQuestion = true;
          break;
        }
      }
    }
    const pendingRead = readDetail('uCt');
    if (!pendingRead.ok) questionSourcesReady = false;
    if (!pendingQuestion && pendingRead.ok) {
      const pending = pendingRead.value as { type?: unknown } | null;
      if (pending?.type === 'userInput') pendingQuestion = true;
    }
    const resumeRead = readDetail('vCt');
    const runtimeRead = readDetail('LCt');
    if (!resumeRead.ok || !runtimeRead.ok) questionSourcesReady = false;
    if (!pendingQuestion && resumeRead.ok && runtimeRead.ok) {
      const resumeState = resumeRead.value;
      const runtime = runtimeRead.value as { type?: unknown; activeFlags?: unknown } | null;
      if (
        resumeState === 'needs_resume' && runtime?.type === 'active' &&
        Array.isArray(runtime.activeFlags) && runtime.activeFlags.includes('waitingOnUserInput')
      ) pendingQuestion = true;
    }
    // The current native Micro slot resolver derives this exact state from the
    // local-status `pendingChip` selector (`v3`) and the sidebar's parameterized
    // pin selector (`F2`). Keep each field optional: older or non-local scopes
    // must remain explicitly unavailable instead of inferring state from a
    // generic visual status.
    const pendingChipSelector = appInitial.v3;
    let pendingChip: unknown;
    if (pendingChipSelector != null) {
      try {
        pendingChip = store.get(pendingChipSelector, conversationId);
        if (pendingChip !== undefined) detailSourceRead = true;
      } catch {}
    }
    const approvalPending = pendingChip === undefined
      ? undefined
      : pendingChip === 'approval';
    const pinSelector = appInitial.F2;
    let pinValue: unknown;
    if (pinSelector != null) {
      try {
        pinValue = store.get(pinSelector, slot.threadKey);
        if (pinValue !== undefined) detailSourceRead = true;
      } catch {}
    }
    const threadPinned = typeof pinValue === 'boolean' ? pinValue : undefined;
    if (!detailSourceRead) return { metadataAvailability: 'unavailable' };
    return {
      metadataAvailability: 'available',
      ...(goalStatus ? { goalStatus } : {}),
      ...(pendingQuestion || questionSourcesReady ? { pendingQuestion } : {}),
      ...(approvalPending === undefined ? {} : { approvalPending }),
      ...(threadPinned === undefined ? {} : { threadPinned }),
    };
  } catch {
    return { metadataAvailability: 'unavailable' };
  }
}

/** Return the one open model picker owned by the bound active composer. */
export function selectBoundModelPicker(
  doc: Document,
  composerRoot: Element | null,
  onUnavailable?: (code: ModelPickerFailureCode) => void,
): Element | null {
  if (!composerRoot) {
    onUnavailable?.("E_MODEL_PICKER_NO_COMPOSER");
    return null;
  }
  const trigger = composerRoot.querySelector('[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]');
  if (!trigger) {
    onUnavailable?.("E_MODEL_PICKER_NO_TRIGGER");
    return null;
  }
  const triggerOpen = trigger.getAttribute('aria-expanded') === 'true'
    || trigger.getAttribute('data-state') === 'open'
    || trigger.hasAttribute('data-composer-navigation-open');
  if (!triggerOpen) {
    onUnavailable?.("E_MODEL_PICKER_TRIGGER_CLOSED");
    return null;
  }
  const openTriggers: Element[] = [];
  for (const candidate of doc.querySelectorAll(
    '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
  )) {
    if (candidate.getAttribute('aria-expanded') === 'true'
      || candidate.getAttribute('data-state') === 'open'
      || candidate.hasAttribute('data-composer-navigation-open')) openTriggers.push(candidate);
  }
  if (openTriggers.length !== 1) {
    onUnavailable?.("E_MODEL_PICKER_OPEN_TRIGGER_COUNT");
    return null;
  }
  if (openTriggers[0] !== trigger) {
    onUnavailable?.("E_MODEL_PICKER_OPEN_TRIGGER_OWNER");
    return null;
  }
  const contentId = trigger.getAttribute('aria-controls');
  if (!contentId) {
    onUnavailable?.("E_MODEL_PICKER_NO_ARIA_CONTROLS");
    return null;
  }
  const candidate = doc.getElementById(contentId);
  if (!candidate) {
    onUnavailable?.("E_MODEL_PICKER_CONTENT_MISSING");
    return null;
  }
  if (!candidate.matches('[role="menu"][data-state="open"]')) {
    onUnavailable?.("E_MODEL_PICKER_CONTENT_NOT_OPEN_MENU");
    return null;
  }
  return candidate;
}

/** Reads only the focused model row of the already-bound picker. */
export function readFocusedModelCandidate(picker: Element | null, active: Element | null): string | null {
  const view = picker?.querySelector('[data-model-picker-view="advanced"]');
  let candidate: Element | null = null;
  if (view && active && view.contains(active)
    && active.matches('[role="menuitemradio"]:not([data-disabled])')) {
    candidate = active;
  } else if (picker && active && typeof active.closest === 'function') {
    const marker = picker.querySelector('[data-model-picker-model-row]');
    const submenuTrigger = marker?.closest('[role="menuitem"]');
    const submenuId = submenuTrigger?.getAttribute('aria-controls');
    const submenu = active.closest('[role="menu"]');
    if (submenuId && submenu?.getAttribute('id') === submenuId
      && submenu.matches('[role="menu"][data-state="open"]')
      && active.matches('[role="menuitem"]:not([data-disabled])')) candidate = active;
  }
  if (!candidate) return null;
  const label = (candidate.getAttribute('aria-label') || candidate.textContent || '').replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, 120) : null;
}
