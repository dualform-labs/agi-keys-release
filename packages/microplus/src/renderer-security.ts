/**
 * Select renderer assets only from the exact app origin and asset directory.
 * The check is intentionally based on protocol/host rather than URL.origin,
 * because custom Electron schemes commonly report the opaque origin `null`.
 */
export function trustedRendererAssetUrls(urls: Iterable<string>, rendererUrl: string): string[] {
  let renderer: URL;
  try { renderer = new URL(rendererUrl); }
  catch { return []; }
  if (renderer.protocol !== "app:" || !renderer.host || renderer.username || renderer.password) return [];

  const selected = new Set<string>();
  for (const raw of urls) {
    try {
      const candidate = new URL(raw);
      if (candidate.protocol !== renderer.protocol || candidate.host !== renderer.host) continue;
      if (candidate.username || candidate.password || candidate.search || candidate.hash) continue;
      if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(candidate.pathname)) continue;
      selected.add(candidate.href);
    } catch {}
  }
  return [...selected];
}

/** Return one unambiguous asset whose basename starts with the requested prefix. */
export function selectTrustedRendererAssetUrl(
  urls: Iterable<string>,
  rendererUrl: string,
  prefix: string
): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*-$/.test(prefix)) return undefined;
  const matches = trustedRendererAssetUrls(urls, rendererUrl).filter((raw) => {
    const basename = new URL(raw).pathname.slice("/assets/".length);
    return basename.startsWith(prefix) && basename.length > prefix.length + 3;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** Restrict a CDP WebSocket URL to the already verified IPv4 loopback port. */
export function validateLoopbackWebSocketUrl(raw: string, expectedPort: number): string {
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65_535) {
    throw new Error("E_INVALID_DEBUG_WEBSOCKET");
  }
  let candidate: URL;
  try { candidate = new URL(raw); }
  catch { throw new Error("E_INVALID_DEBUG_WEBSOCKET"); }
  if (
    candidate.protocol !== "ws:" ||
    candidate.hostname !== "127.0.0.1" ||
    candidate.port !== String(expectedPort) ||
    candidate.username || candidate.password ||
    candidate.search || candidate.hash ||
    !candidate.pathname.startsWith("/devtools/")
  ) {
    throw new Error("E_INVALID_DEBUG_WEBSOCKET");
  }
  return candidate.href;
}
