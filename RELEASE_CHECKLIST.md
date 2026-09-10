# Release readiness

This is a release candidate, not a claim that all hardware actions have passed.

## Verified

- Version 0.1.0.60: user-reported success after configuring the dictation shortcut in Stream Deck.
- Version 0.1.0.62: user-reported context compaction success.
- Shortcut capture stores physical key codes and distinguishes left/right modifiers.
- Automated checks cover configuration, lifecycle, mapping, rendering and transport. They do not replace device testing.

## Before public release

- Check all 67 actions on the intended Codex version, including task slots, send, side chat, context compaction, model/reasoning and usage dials.
- Confirm reconnect after restarting the Mac and the supported connector installation path.
- Confirm key release, disconnect and simultaneous input do not leave recording active.
- Review the history-free source export, not the development repository history.
- Keep upstream license and third-party notices with the package.
- Publish only after hardware checks and explicit release approval.

## Distribution

Build on macOS using the commands in README.md. Install the generated `.streamDeckPlugin` using Stream Deck. Back up existing profiles before replacing an installed plugin. Shortcut configuration belongs in the Stream Deck property inspector; there is no separate web manager.

Source export excludes local work records and archived files. Automated secret scanning and pattern checks are limited checks, not a guarantee that every kind of personal data has been identified.
