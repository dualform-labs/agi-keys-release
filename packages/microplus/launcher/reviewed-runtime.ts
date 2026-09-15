import { trustedRendererAssetUrls } from "../src/renderer-security.js";

export const REVIEWED_LAUNCHER_RUNTIME = {
  initial: "737070f94a072d2b4ede9f326e3e1c4142fb82198961251c2e70479b3f926275",
  primary: "28d317396d30902ab5f2c01f069a7b9773f2299b35cc855272d4cf59b402c276",
  messageBus: "daec5cd2b8cfe9074143c15bbde1f45b76fe40f668cd486f1eff7304e6d4f2ae",
} as const;

export function reviewedRuntimePrelude(): string {
  return `
    const discoveredUrls = [
      ...[...document.querySelectorAll('link[href], script[src]')].map(element => element.href || element.src),
      ...performance.getEntriesByType('resource').map(entry => entry.name)
    ];
    const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
    const expected = ${JSON.stringify(REVIEWED_LAUNCHER_RUNTIME)};
    const reviewedUrls = {};
    for (const kind of ['initial', 'primary', 'messageBus']) {
      const assetPrefix = kind === 'messageBus' ? 'message-bus-' : 'app-' + kind + '-';
      const candidates = urls.filter(url => new URL(url).pathname.startsWith('/assets/' + assetPrefix));
      if (candidates.length !== 1) return { ready: false, reason: 'runtime-asset-ambiguous' };
      const response = await fetch(candidates[0]);
      if (!response.ok) return { ready: false, reason: 'runtime-asset-unavailable' };
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== expected[kind]) return { ready: false, reason: 'runtime-unreviewed' };
      reviewedUrls[kind] = candidates[0];
    }
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
    const initialUrl = reviewedUrls.initial;
    const reviewedModule = await import(reviewedUrls.messageBus);
    const reviewedBus = reviewedModule.r;
    if (!reviewedBus || typeof reviewedBus.dispatchHostMessage !== 'function' || !(reviewedBus.handlers instanceof Map)) {
      return { ready: false, reason: 'runtime-bus-unavailable' };
    }
    if (!document.hasFocus() || document.visibilityState !== 'visible') return { ready: false, reason: 'foreground-target-stale' };
  `;
}
