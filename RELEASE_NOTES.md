# AGI Keys 0.1.0.66 — Preview

English | [日本語](RELEASE_NOTES.ja.md)

An unofficial macOS Stream Deck+ plugin for task selection, models, reasoning effort, dictation, send, side chat, usage and context displays. All configuration is inside Stream Deck.

## Changes

- Renamed the product to AGI Keys and moved the plugin/action namespace to `com.dualform.agikeys` before public release.
- English localization across the action list, settings, display feedback and documentation, with Japanese retained.

- Custom icon reads now validate names, links and file sizes. Prototype-property names render safely as fallback labels.
- Failed key release retains input ownership so another input cannot collide with it.
- Context compaction no longer treats a completed response as an active task. Hardware success was confirmed on 0.1.0.62.
- Record a shortcut by pressing it, with left/right modifiers and per-key settings. Hardware dictation success was confirmed on 0.1.0.60.
- Configuration normalization was extracted into a module; invalid settings and disconnected save feedback were corrected.

## Install

1. Back up your profiles in Stream Deck.
2. Open the included `.streamDeckPlugin` and follow Stream Deck's installer.
3. Drag actions from the action list and configure language and press behavior in the property inspector.
4. Confirm the Codex connection before using the actions. Plugin installation alone does not establish the connection. Fresh installation and automatic recovery after restart remain pending final verification.

This pre-release rename changes the plugin UUID to `com.dualform.agikeys`. Pre-release profiles that referenced the former development UUID must assign the AGI Keys actions again.

## Voice input

Register the receiving app's **toggle recording** shortcut. The default is Right Option; this differs from its hold-to-talk shortcut. The plugin sends one toggle when pressed and another when released. Start with recording stopped and do not toggle it manually while holding the key. The plugin receives no direct recording-state acknowledgement.

## ACT06–ACT12

These send Codex Micro physical key identifiers. They do not identify Stream Deck positions. Their behavior follows Codex's mapping; use named actions for ordinary assignments.

## Verification and limitations

- The connection depends on Codex's Micro operation path rather than a public API; Codex updates can change compatibility.
- Some operations can be observed only as accepted dispatches, not confirmed downstream effects.
- The AGI Keys 0.1.0.66 source passed 723 automated checks, type checking and official Stream Deck package validation. This does not establish hardware acceptance of all 67 actions, all shortcuts or restart recovery.
- This is a Preview. Complete hardware and fresh-install checks before a stable release.
- The local CDP client-authentication limitation remains unresolved. See [SECURITY.md](SECURITY.md).

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICE.md` in the release bundle, or `packages/microplus/THIRD_PARTY_NOTICE.md` in the source tree. This is not an official OpenAI, Elgato or Work Louder product.
