# Security status

Codex Keys is a preview. It has not passed an exhaustive security or hardware certification. The supported deployment is a local macOS account using Stream Deck and Codex on the same machine.

## Known transport limitation

The current connector enables a loopback TCP Chrome DevTools Protocol (CDP) endpoint. The plugin checks the destination, application identity and listener process before connecting. These checks do **not** authenticate other local clients connecting to that endpoint. Another local process may gain access to the authenticated Codex renderer. The port must never be forwarded, tunneled or rebound to a network interface.

An authenticated proxy does not remove this exposure while the original CDP TCP listener remains reachable. A receiver-supported private IPC transport must replace that listener before client isolation can be claimed. That change is not implemented or verified in this preview. Do not deploy the connector on systems with untrusted local processes or users on the assumption that loopback provides isolation.

## Local inputs and data

The plugin reads local task metadata and performs user-triggered keyboard/app operations. Custom icon names are restricted to ASCII letters, digits, hyphens and underscores, up to 128 characters; SVG reads are limited to 256 KiB. Static symlinks and non-regular icon files are rejected. These checks are not a guarantee against a process that can concurrently replace the user's filesystem tree.

Voice shortcuts are toggle pairs, with no direct acknowledgement of the recording application's state. Avoid manually toggling recording while the Stream Deck key is held.

## Reporting

Do not put access tokens, private conversation text, audio, local session files or unredacted logs in a public issue. Report the affected version and a minimal synthetic reproduction. Use GitHub private vulnerability reporting if it is enabled on the published repository. A private reporting channel has not yet been configured for this release candidate.

## Publication

Publish the reviewed, history-free source export, not this development repository's full history. Retain the MIT license and third-party notices. Secret scanners and automated tests do not prove absence of all personal information or all vulnerabilities.
