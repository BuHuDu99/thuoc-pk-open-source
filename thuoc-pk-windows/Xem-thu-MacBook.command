#!/bin/zsh
cd "$(dirname "$0")" || exit 1
preview_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$preview_node" ]]; then preview_node="$(command -v node)"; fi
if [[ ! -x "$preview_node" ]]; then
  print 'Cần Node.js để mở bản xem thử.'
  read -k 1
  exit 1
fi
exec "$preview_node" scripts/start-preview-mac.js
