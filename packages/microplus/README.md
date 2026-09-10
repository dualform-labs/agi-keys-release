# Codex Keys

A Mac-only Stream Deck plugin that mirrors the native Codex Micro control
surface. It talks to Codex through a loopback-only CDP endpoint. The plugin
does not start or stop Codex by itself; the optional launcher has explicit
commands for inspecting, starting, and (only with `--restart`) restarting it.

The normal safe flow is:

```sh
# Read-only inspection; this never changes Codex.
./start-microplus.sh status

# Machine-readable preflight; exit 0 means ready, 2 means restart required,
# 3 means launch required, and 4 means multiple Codex processes are ambiguous.
./start-microplus.sh dry-run

# Start only when Codex is not running, or attach to an existing debug session.
./start-microplus.sh start

# Explicitly restart the current Codex process after saving unsent composer text.
./start-microplus.sh start --restart
```

`start` refuses to terminate a normally running Codex session unless
`--restart` is present. It sends a graceful termination signal and waits up to
15 seconds; it never force-kills the process. If multiple Codex main processes
are detected without a reusable bridge, it stops with an ambiguity error to
avoid creating a duplicate instance.

The optional `install` command installs a login watcher. The watcher only
attaches to an already-running Codex process that exposes a loopback endpoint;
it never launches, stops, or restarts Codex. It requires Node.js 20 or newer.

The launcher stores only port/version metadata in its 0600 bridge-state file.
Watcher logs use fixed diagnostic codes and do not record CDP exception text,
composer content, transcripts, audio, tokens, or cookies.

Included controls:

- six live agent slots with native status, selection, title, and context use;
- native `ACT06` through `ACT12` press/release controls;
- joystick up/right/down/left and encoder click;
- reasoning effort up/down with press-and-hold repeat;
- the complete detected Codex Micro keycap catalog exposed as standalone actions;
- account usage overview, individual limit window, and guarded reset credit use.

No Web manager, mobile app, relay, or remote-host service is included.

```sh
npm install
npm run check
npm test
npm run build
npm run validate
```
