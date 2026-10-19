#!/usr/bin/env bash
# Deletes ALL Trustabl Console state: repos list, run history, artifacts,
# downloaded CLIs, and the CLIs' own caches (rules, Probe results).
# Your repositories and any SKILL.md the Console wrote into them are not touched.
set -euo pipefail
HOME_DIR="${TRUSTABL_CONSOLE_HOME:-$HOME/.trustabl-console}"
targets=("$HOME_DIR")
# On macOS the CLIs ignore XDG_CACHE_HOME and use ~/Library/Caches.
if [ "$(uname -s)" = "Darwin" ]; then
  targets+=("$HOME/Library/Caches/trustabl" "$HOME/Library/Caches/trustabl-probe")
fi
echo "This permanently deletes:"
for t in "${targets[@]}"; do [ -e "$t" ] && echo "  $t"; done
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Type 'wipe' to continue: " answer
  [ "$answer" = "wipe" ] || { echo "Aborted."; exit 1; }
fi
for t in "${targets[@]}"; do rm -rf "$t"; done
echo "Done. Start again with: make run"
