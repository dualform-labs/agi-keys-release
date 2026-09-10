import { trustedRendererAssetUrls } from "../src/renderer-security.js";

export const REVIEWED_LAUNCHER_RUNTIME = {
  initial: "c87b94027faefdc31cc165975dc0f14b28e3f6d922f6a5188756c8f570f2b3d7",
  primary: "0aa689053d9e32d7286dfb1d85ac62cadc3858086335518f15b1f97604eb61e9",
} as const;

export function reviewedRuntimePrelude(): string {
  return `
    const discoveredUrls = [
      ...[...document.querySelectorAll('link[href], script[src]')].map(element => element.href || element.src),
      ...performance.getEntriesByType('resource').map(entry => entry.name)
    ];
    const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
    const expected = ${JSON.stringify(REVIEWED_LAUNCHER_RUNTIME)};
    let initialUrl;
    for (const kind of ['initial', 'primary']) {
      const candidates = urls.filter(url => new URL(url).pathname.startsWith('/assets/app-' + kind + '-'));
      if (candidates.length !== 1) return { ready: false, reason: 'runtime-asset-ambiguous' };
      const response = await fetch(candidates[0]);
      if (!response.ok) return { ready: false, reason: 'runtime-asset-unavailable' };
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== expected[kind]) return { ready: false, reason: 'runtime-unreviewed' };
      if (kind === 'initial') initialUrl = candidates[0];
    }
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
    const reviewedModule = await import(initialUrl);
    const reviewedBus = reviewedModule._mn;
    if (!reviewedBus || typeof reviewedBus.dispatchHostMessage !== 'function' || !(reviewedBus.handlers instanceof Map)) {
      return { ready: false, reason: 'runtime-bus-unavailable' };
    }
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
  `;
}
