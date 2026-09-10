# Renderer command discovery

`discoverCommands(appPath)` reads the selected ChatGPT bundle through the installed `asar` reader. It hashes the archive and each source asset, then statically scans the current Micro layout, Micro labels, renderer command descriptors, and the Micro command filter. It does not extract the archive, evaluate JavaScript, connect to Codex, inspect auth/session data, or provide an execution API.

The returned `commands` array is the data-only Micro catalog derived from the renderer's `webview`/`electron` filter. `keycaps` preserves the physical keycap IDs and their observed actions. `executableRegistry` is a separate root containing only command IDs and minified handler symbols from the renderer's static `_xi` map; `executableHere` is always `false`. A future adapter must choose and validate its own finite execution registry rather than treating this snapshot as permission to run renderer code.

In the current bundle, the Micro filter's `P5` export is the static `_xi.has(id)` predicate, while the bridge's `I5` export is the `fU` dispatcher used by `fU(commandId, "codex_micro_hid")`. The inventory records the `P5`/`_xi` IDs as a finite source-backed registry and records no runtime result. Dynamic `pU` registrations and the `fU` call itself are deliberately not executed or treated as externally callable support.

Every command and keycap is marked `support.status = "unverified"`. A Micro keycap or app-local keybinding is binding evidence, not proof that an external Stream Deck input can invoke it. The source artifact paths, byte lengths, SHA-256 values, and source regions are retained for review.

The current renderer builds `focusTab1` through `focusTab9` from a literal numeric range. The scanner expands that one source-backed range and omits other unresolved template IDs; it never evaluates the map expression or an arbitrary minified function.
