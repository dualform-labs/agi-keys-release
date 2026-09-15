import {
  CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION,
  readAgentWindowProbe,
} from './agent-window-probe.js';
import {
  trustedRendererAssetUrls,
} from './renderer-security.js';
import {
  readAgentSlotMetadata,
  selectNativeCommandScope,
  agentSlotMetadataNamespace,
  selectNativeModelPickerOwner,
  readNativeCurrentModel,
  selectBoundModelPicker,
  readFocusedModelCandidate,
} from './renderer-runtime.js';
import {
  DIAL_RUNTIME_26903,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_MICRO_SLOT_SIGNALS_ASSET,
  CURRENT_MICRO_SLOT_SIGNALS_SHA256,
  CURRENT_APP_PRIMARY_SHA256,
} from './native-runtime-contract.js';

/** Accept only an observed native query update time; absence must stay unknown. */
export function verifiedUsageObservedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function createRendererObservationExpression(INPUT_ONLY_DEVICE_STATE: object): string {
  return `(async () => {
  const verifiedUsageObservedAt = (${verifiedUsageObservedAt.toString()});
  const discoveredUrls = [...new Set([
    ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
    ...performance.getEntriesByType('resource').map((entry) => entry.name)
  ])];
  const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
  const slotSignalsUrl = urls.find((url) => url.includes('/assets/codex-micro-slot-signals-'));
  if (!slotSignalsUrl) throw new Error('Codex Micro slot signals are not loaded.');

  const namespaces = [];
  for (const url of urls) {
    try { namespaces.push(await import(url)); } catch {}
  }
  const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
  const definitions = exportedValues.find((candidate) =>
    candidate && typeof candidate === 'object' &&
    candidate.layout?.key === 'codex-micro-layout' &&
    candidate.agentSource?.key === 'codex-micro-agent-source'
  );
  if (!definitions) throw new Error('Codex Micro settings definitions were not found.');

  const bus = exportedValues.find((candidate) => candidate && typeof candidate === 'object' && candidate.handlers instanceof Map && (typeof candidate.dispatchHostMessage === 'function' || typeof candidate.dispatchMessage === 'function'));
  if (!bus) throw new Error('Codex VS Code event bus was not found.');
  const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
  if ((bus.handlers.get('codex-micro-hid-event')?.size ?? 0) === 0) {
    dispatch.call(bus, ${JSON.stringify(INPUT_ONLY_DEVICE_STATE)});
  }
  const root = document.getElementById('root');
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith('__reactContainer$'));
  if (!root || !reactKey) throw new Error('Codex React root was not found.');

  const slotSignals = await import(slotSignalsUrl);
  const resolvers = Object.values(slotSignals).filter((candidate) =>
    candidate && typeof candidate === 'object' &&
    typeof candidate.resolve === 'function' &&
    typeof candidate.createSubscriberAtom === 'function'
  );
  if (resolvers.length === 0) throw new Error('Codex Micro slot resolver was not found.');

  let queue = [root[reactKey]];
  const seen = new Set();
  const queryClients = new Set();
  let found = null;
  while (queue.length && seen.size < 30000 && !found) {
    const fiber = queue.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const maps = [];
    const contextValues = [fiber.memoizedProps?.value];
    let dependency = fiber.dependencies?.firstContext;
    while (dependency) {
      contextValues.push(dependency.memoizedValue);
      dependency = dependency.next;
    }
    for (const value of contextValues) {
      if (value instanceof Map) maps.push(value);
      if (value && typeof value.getQueryCache === 'function' && typeof value.getQueryData === 'function') queryClients.add(value);
    }
    for (const chain of maps) {
      for (const node of chain.values()) {
        if (!node?.store || typeof node.store.get !== 'function') continue;
        for (const resolver of resolvers) {
          try {
            const atom = resolver.resolve(node, chain);
            const slots = node.store.get(atom);
            if (Array.isArray(slots) && slots.length === 6 && slots.every((slot, index) => slot?.id === index)) {
              found = { chain, node, slots };
              break;
            }
          } catch {}
        }
        if (found) break;
      }
      if (found) break;
    }
    queue.push(fiber.child, fiber.sibling);
  }
  if (!found) throw new Error('Codex Micro slot store was not found.');

  let layout = definitions.layout.default;
  let agentSource = definitions.agentSource.default;
  let lightingAutoOff = definitions.lightingAutoOff?.default ?? '3-minutes';

  let settingsResolved = false;
  const directSettingReader = exportedValues.find((candidate) => {
    if (typeof candidate !== 'function' || candidate.length !== 1) return false;
    const source = Function.prototype.toString.call(candidate);
    return source.includes('get-setting') && source.includes('.default');
  });
  if (directSettingReader) {
    try {
      const candidateLayout = await directSettingReader(definitions.layout);
      const candidateAgentSource = await directSettingReader(definitions.agentSource);
      const candidateLightingAutoOff = definitions.lightingAutoOff
        ? await directSettingReader(definitions.lightingAutoOff)
        : lightingAutoOff;
      if (
        candidateLayout?.version === 1 &&
        typeof candidateLayout.slots === 'object' &&
        ['pinned', 'recent', 'priority', 'custom'].includes(candidateAgentSource)
      ) {
        layout = candidateLayout;
        agentSource = candidateAgentSource;
        if (typeof candidateLightingAutoOff === 'string') lightingAutoOff = candidateLightingAutoOff;
        settingsResolved = true;
      }
    } catch {}
  }

  if (!settingsResolved) {
    const settingReaders = exportedValues.filter((candidate) => {
      if (typeof candidate !== 'function' || candidate.length !== 2) return false;
      const source = Function.prototype.toString.call(candidate);
      return source.includes('.key') && source.includes('.default');
    });
    const getStoreValue = found.node.store.get.bind(found.node.store);
    for (const readSetting of settingReaders) {
      try {
        const candidateLayout = await readSetting(getStoreValue, definitions.layout);
        const candidateAgentSource = await readSetting(getStoreValue, definitions.agentSource);
        const candidateLightingAutoOff = definitions.lightingAutoOff
          ? await readSetting(getStoreValue, definitions.lightingAutoOff)
          : lightingAutoOff;
        if (candidateLayout?.version !== 1 || typeof candidateLayout.slots !== 'object') continue;
        if (!['pinned', 'recent', 'priority', 'custom'].includes(candidateAgentSource)) continue;
        layout = candidateLayout;
        agentSource = candidateAgentSource;
        if (typeof candidateLightingAutoOff === 'string') lightingAutoOff = candidateLightingAutoOff;
        break;
      } catch {}
    }
  }
  const toEpoch = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 100000000000 ? value * 1000 : value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };
  const appInitialUrls = urls.filter((url) => new URL(url).pathname.slice('/assets/'.length).startsWith('app-initial-'));
  let appInitial = null;
  let metadataCurrentRuntime = false;
  let metadataSupportedRuntime = false;
  if (appInitialUrls.length === 1) {
    try {
      const appInitialUrl = appInitialUrls[0];
      const verificationCache = globalThis.__codexDeckVerifiedMetadataInitial26903 ??= new Map();
      let sha256 = verificationCache.get(appInitialUrl);
      if (sha256 == null) {
        const source = await fetch(appInitialUrl).then((response) => response.text());
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        verificationCache.set(appInitialUrl, sha256);
      }
      metadataCurrentRuntime = sha256 === ${JSON.stringify(DIAL_RUNTIME_26903.initial)};
      const metadata26908Runtime = sha256 === ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)};
      if (metadataCurrentRuntime || metadata26908Runtime) {
        const signalUrls = urls.filter((url) => new URL(url).pathname.startsWith('/assets/codex-micro-slot-signals-'));
        if (signalUrls.length !== 1) metadataCurrentRuntime = false;
        else {
          let signalHash = verificationCache.get(signalUrls[0]);
          if (signalHash == null) {
            const signalSource = await fetch(signalUrls[0]).then((response) => response.text());
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signalSource));
            signalHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            verificationCache.set(signalUrls[0], signalHash);
          }
          if (metadataCurrentRuntime) {
            metadataCurrentRuntime = signalHash === 'e8089d7f8ebbc4dd76e38913c3d28ded0beb934c02e4c97f8930f1adacbf3c4d';
            metadataSupportedRuntime = metadataCurrentRuntime;
          } else {
            metadataSupportedRuntime = new URL(signalUrls[0]).pathname === '/assets/' + ${JSON.stringify(CURRENT_MICRO_SLOT_SIGNALS_ASSET)}
              && signalHash === ${JSON.stringify(CURRENT_MICRO_SLOT_SIGNALS_SHA256)};
          }
        }
      }
      if (metadataSupportedRuntime) appInitial = await import(appInitialUrl);
    } catch {}
  }
  const appPrimaryUrls = urls.filter((url) => new URL(url).pathname.slice('/assets/'.length).startsWith('app-primary-'));
  let appPrimaryVerified = false;
  if (appPrimaryUrls.length === 1) {
    try {
      const appPrimaryUrl = appPrimaryUrls[0];
      const verificationCache = globalThis.__agiKeysVerifiedAppPrimary26908 ??= new Map();
      let verified = verificationCache.get(appPrimaryUrl);
      if (verified == null) {
        const source = await fetch(appPrimaryUrl).then((response) => response.text());
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        verified = ${JSON.stringify([CURRENT_APP_PRIMARY_SHA256, DIAL_RUNTIME_26903.primary])}.includes(sha256);
        verificationCache.set(appPrimaryUrl, verified);
      }
      appPrimaryVerified = verified === true;
    } catch {}
  }
  const readSlotMetadata = (${readAgentSlotMetadata.toString()});
  const resolveMetadataComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
  const selectMetadataScope = (${selectNativeCommandScope.toString()});
  const metadataComposer = resolveMetadataComposer(document);
  const metadataScope = appInitial ? selectMetadataScope(
    document,
    metadataComposer.root,
    metadataCurrentRuntime ? appInitial.t3t : appInitial.e6t,
    metadataCurrentRuntime ? appInitial.iKt : appInitial.mqt,
    metadataCurrentRuntime ? appInitial.pR : appInitial.hU,
    false,
    true
  ) : null;
  const metadataNamespace = appInitial ? (${agentSlotMetadataNamespace.toString()})(appInitial, metadataCurrentRuntime) : null;
  const slots = found.slots.map((slot) => {
    const metadata = appInitial && metadataScope
      ? readSlotMetadata(slot, metadataScope, metadataNamespace)
      : { metadataAvailability: 'unavailable' };
    return {
      ...slot,
      ...metadata,
      activityAt: toEpoch(slot.activityAt) ?? toEpoch(slot.updatedAt) ?? toEpoch(slot.lastActivityAt) ??
        toEpoch(slot.thread?.updatedAt) ?? toEpoch(slot.task?.updatedAt)
    };
  });

  let usage;
  for (const client of queryClients) {
    try {
      const query = client.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const refreshKey = Symbol.for('codex-deck-rate-limit-refresh-at');
      const now = Date.now();
      const dataUpdatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const lastRefreshAttempt = Number(globalThis[refreshKey]) || 0;
      if (query && typeof query.fetch === 'function' && now - dataUpdatedAt >= 15000 && now - lastRefreshAttempt >= 15000) {
        globalThis[refreshKey] = now;
        // Rate-limit refresh is network-backed and must never hold agent status,
        // selection, or lighting behind its response. A later snapshot reads
        // the refreshed query cache once this best-effort request completes.
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== 'object') continue;
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== 'object') return null;
        const used = Number(window.used_percent);
        if (!Number.isFinite(used)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? 'five-hour'
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? 'weekly'
            : 'other';
        const usedPercent = Math.min(100, Math.max(0, used));
        return {
          id: kind === 'other' ? role + '-' + String(minutes ?? 'unknown') : kind,
          kind,
          usedPercent,
          remainingPercent: 100 - usedPercent,
          windowDurationMins: minutes,
          resetsAt: toEpoch(window.reset_at) ?? null
        };
      };
      const windows = [
        normalizeWindow(rateLimit.primary_window, 'primary'),
        normalizeWindow(rateLimit.secondary_window, 'secondary')
      ].filter(Boolean);
      const available = Number(data.rate_limit_reset_credits?.available_count);
      const applicable = Number(data.rate_limit_reset_credits?.applicable_available_count);
      const observedAt = verifiedUsageObservedAt(query.state?.dataUpdatedAt);
      usage = {
        windows,
        ...(observedAt == null ? {} : { observedAt }),
        resetCreditsAvailable: Number.isFinite(available) ? Math.max(0, Math.floor(available)) : null,
        resetCreditsApplicable: Number.isFinite(applicable) ? Math.max(0, Math.floor(applicable)) : null
      };
      break;
    } catch {}
  }

  const html = document.documentElement;
  const body = document.body;
  const themeWords = [
    html.dataset.theme,
    html.dataset.colorScheme,
    html.className,
    body?.dataset?.theme,
    body?.className,
    getComputedStyle(html).colorScheme
  ].filter(Boolean).join(' ').toLowerCase();
  const explicitDark = /(^|[\\s_-])dark($|[\\s_-])/.test(themeWords);
  const explicitLight = /(^|[\\s_-])light($|[\\s_-])/.test(themeWords);
  const backgrounds = [body, document.getElementById('root'), html]
    .filter(Boolean)
    .map((element) => getComputedStyle(element).backgroundColor)
    .map((value) => value.match(/rgba?\\(([^)]+)\\)/)?.[1]?.split(',').map(Number))
    .filter((channels) => channels?.length >= 3 && (channels.length < 4 || channels[3] > 0));
  const background = backgrounds[0];
  const luminance = background
    ? (0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]) / 255
    : null;
  const theme = explicitDark || (!explicitLight && (luminance != null ? luminance < 0.42 : matchMedia('(prefers-color-scheme: dark)').matches))
    ? 'dark'
    : 'light';
  const activeThreadElement = document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active="true"]')
    ?? document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]');
  const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
  const activeComposer = resolveActiveComposer(document);
  const rawActiveThreadKey = activeComposer.activeThreadKey;
  const readWindowProbe = (${readAgentWindowProbe.toString()});
  const windowProbe = readWindowProbe(document, resolveActiveComposer, activeComposer);
  const activeThreadKey = windowProbe.identityAvailable
    ? windowProbe.activeThreadKey
    : rawActiveThreadKey;
  const activeMetadata = appInitial && metadataScope && activeThreadKey
    ? readSlotMetadata({ threadKey: activeThreadKey }, metadataScope, metadataNamespace)
    : { metadataAvailability: 'unavailable' };
  const activeThreadTitle = activeThreadElement
    ? (activeThreadElement.getAttribute('aria-label') ?? activeThreadElement.textContent ?? '').trim().slice(0, 240) || undefined
    : undefined;
  const composerRoot = activeComposer.root;
  const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
  if (composerRoot && !composerIds.ids.has(composerRoot)) composerIds.ids.set(composerRoot, 'composer-' + (++composerIds.next));
  const activeComposerKey = composerRoot ? composerIds.ids.get(composerRoot) : undefined;
  const markdownCopyTracker = globalThis[Symbol.for('codexDeckMarkdownCopyTracker')];
  const markdownCopyRevision = activeThreadKey
    && markdownCopyTracker?.threadKey === activeThreadKey
    && typeof markdownCopyTracker.revision === 'number'
    && Number.isFinite(markdownCopyTracker.revision)
    ? markdownCopyTracker.revision
    : undefined;
  const reasoningTriggers = composerRoot ? [...composerRoot.querySelectorAll(
    '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
  )] : [];
  const reasoningTrigger = reasoningTriggers.length === 1 ? reasoningTriggers[0] : null;
  const rawReasoningEffort = reasoningTrigger?.getAttribute('data-selected-reasoning-effort') ?? null;
  const reasoningEffort = rawReasoningEffort && /^[a-z][a-z0-9_-]{0,32}$/.test(rawReasoningEffort)
    ? rawReasoningEffort
    : null;
  const selectModelOwner = (${selectNativeModelPickerOwner.toString()});
  const readCurrentModel = (${readNativeCurrentModel.toString()});
  const currentModel = readCurrentModel(composerRoot, reasoningTrigger, appPrimaryVerified, selectModelOwner);
  const modelLabel = currentModel?.modelLabel ?? null;
  const selectPicker = (${selectBoundModelPicker.toString()});
  const boundModelPicker = selectPicker(document, composerRoot);
  const modelPickerOpen = boundModelPicker != null;
  const modelCandidateLabel = (${readFocusedModelCandidate.toString()})(boundModelPicker, document.activeElement);
  const composerReadback = activeComposerKey && reasoningTrigger
    ? {
        ...(activeThreadKey ? { activeThreadKey } : {}),
        currentModelId: currentModel?.modelId ?? null,
        modelLabel,
        modelSelectionMode: currentModel?.selectionMode ?? null,
        modelPickerOpen,
        modelCandidateLabel,
        reasoningEffort,
        fastEnabled: null,
        dictationPhase: 'unavailable',
        observedAt: Date.now()
      }
    : undefined;

  return {
    slots,
    activeThreadKey,
    activeThreadTitle,
    activeComposerKey,
    ...(activeMetadata.approvalPending === undefined ? {} : { approvalPending: activeMetadata.approvalPending }),
    ...(activeMetadata.threadPinned === undefined ? {} : { threadPinned: activeMetadata.threadPinned }),
    ...(composerReadback ? { composerReadback } : {}),
    ...(markdownCopyRevision === undefined ? {} : { markdownCopyRevision }),
    layout,
    agentSource,
    lightingAutoOff,
    theme,
    ...(usage ? { usage } : {})
  };
})()`;
}
