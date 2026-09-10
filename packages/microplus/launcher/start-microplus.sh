#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
runtime="$script_dir/codex-micro-plus-macos.mjs"

if [[ ! -f "$runtime" ]]; then
  print -u2 "Codex Keys runtime is missing. Run npm run build first."
  exit 1
fi

for node_candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node(N) /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node; do
  [[ -x "$node_candidate" ]] || continue
  node_version=$("$node_candidate" --version 2>/dev/null) || continue
  node_major=${${node_version#v}%%.*}
  [[ "$node_major" == <-> && "$node_major" -ge 20 ]] || continue
  exec "$node_candidate" "$runtime" "${@:-status}"
done

print -u2 "Node.js 20 or newer was not found."
exit 78
