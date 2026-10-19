#!/usr/bin/env bash
# One-command start for Trustabl Console (what `make run` calls).
#   1. use Node >= 22.13 from PATH, or install a private copy under the Console home
#   2. install npm dependencies (npm ci) when package-lock.json changed
#   3. fetch the pinned trustabl + autofix CLIs (SHA-256 verified)
#   4. build when sources changed, then serve on http://127.0.0.1:4317 (localhost only)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export TRUSTABL_CONSOLE_HOME="${TRUSTABL_CONSOLE_HOME:-$HOME/.trustabl-console}"
PORT="${TRUSTABL_CONSOLE_PORT:-4317}"
NODE_VERSION="22.22.0"   # used only when no suitable Node is on PATH
mkdir -p "$TRUSTABL_CONSOLE_HOME"
chmod 700 "$TRUSTABL_CONSOLE_HOME"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
}

install_node() {
  local os arch dir tarball base
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "Unsupported OS $(uname -s)"; exit 1 ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
  dir="$TRUSTABL_CONSOLE_HOME/node/node-v$NODE_VERSION-$os-$arch"
  if [ ! -x "$dir/bin/node" ]; then
    say "Node >= 22.13 not found — installing Node $NODE_VERSION into $TRUSTABL_CONSOLE_HOME/node"
    base="https://nodejs.org/dist/v$NODE_VERSION"
    tarball="node-v$NODE_VERSION-$os-$arch.tar.gz"
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
    curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | (sha256sum -c - 2>/dev/null || shasum -a 256 -c -)) \
      || { echo "Node download failed its checksum; aborting."; exit 1; }
    mkdir -p "$TRUSTABL_CONSOLE_HOME/node"
    tar -xzf "$tmp/$tarball" -C "$TRUSTABL_CONSOLE_HOME/node"
    rm -rf "$tmp"
  fi
  export PATH="$dir/bin:$PATH"
}

node_ok || install_node
say "Node $(node -v)"

# Dependencies: reinstall only when the lockfile changed.
# Keyed on platform too: node_modules holds native builds (SWC, lightningcss).
LOCK_SUM="$(node -e 'process.stdout.write(process.platform+"-"+process.arch+"-"+require("crypto").createHash("sha256").update(require("fs").readFileSync("package-lock.json")).digest("hex"))')"
if [ ! -f node_modules/.lock-sum ] || [ "$(cat node_modules/.lock-sum)" != "$LOCK_SUM" ]; then
  say "Installing dependencies (npm ci)"
  npm ci --no-audit --no-fund --loglevel=error
  echo "$LOCK_SUM" > node_modules/.lock-sum
fi

say "Checking pinned CLIs"
node scripts/fetch-tools.mjs

# Build when anything that ships changed since the last build.
SRC_SUM="$(node scripts/source-sum.mjs)"
if [ ! -f .next/BUILD_ID ] || [ ! -f .next/.src-sum ] || [ "$(cat .next/.src-sum)" != "$SRC_SUM" ]; then
  say "Building"
  NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=ExperimentalWarning" npx next build
  echo "$SRC_SUM" > .next/.src-sum
fi

say "Trustabl Console → http://127.0.0.1:$PORT  (state: $TRUSTABL_CONSOLE_HOME, Ctrl-C to stop)"
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=ExperimentalWarning"
exec npx next start -H 127.0.0.1 -p "$PORT"
