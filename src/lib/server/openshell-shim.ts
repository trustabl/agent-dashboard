import fs from 'node:fs'
import path from 'node:path'
import { shQuote } from '../shell'

/**
 * autofix 0.2.2 drives the `openshell` CLI in two ways OpenShell 0.0.116
 * rejects, so every OpenShell sandbox fails to start and autofix falls back to
 * static analysis only (after a 3-minute wait):
 *
 * 1. Its built-in sandbox policy ends in `network_policies:\n  outbound: []`.
 *    OpenShell reads `network_policies` as a map of named rules ("invalid
 *    type: sequence, expected struct"). The wrapper rewrites that block to
 *    `network_policies: {}` — the same meaning: no outbound rule, so every
 *    attempt is denied and logged, which is how Probe observes egress.
 * 2. It names sandboxes `autofix-<epoch ms>` (21 characters); OpenShell allows
 *    19. The wrapper passes `af-<epoch ms>` instead and maps the name back in
 *    OpenShell's output, so autofix still finds its sandbox in `sandbox list`.
 *
 * The Console puts this wrapper first on autofix's PATH for OpenShell runs; it
 * then runs the real openshell. Any other policy, name or command passes
 * through untouched.
 */
const SHIM = (real: string) => `#!/usr/bin/env bash
# Written by Agent Dashboard — see src/lib/server/openshell-shim.ts.
n=$#
for a in "$@"; do
  case "$a" in autofix-[0-9]*) a="af-\${a#autofix-}" ;; esac
  set -- "$@" "$a"
done
shift "$n"
if [ "$1" = sandbox ] && [ "$2" = create ]; then
  prev=
  for a in "$@"; do
    if [ "$prev" = --policy ] && [ -f "$a" ]; then
      awk '
        held { held = 0; if ($0 == "  outbound: []") { print "network_policies: {}"; next } print "network_policies:" }
        $0 == "network_policies:" { held = 1; next }
        { print }
        END { if (held) print "network_policies:" }
      ' "$a" > "$a.console" && mv "$a.console" "$a"
    fi
    prev=$a
  done
fi
unshorten() { sed 's/af-\\([0-9]\\{13\\}\\)/autofix-\\1/g'; }
exec > >(unshorten) 2> >(unshorten >&2)
${shQuote(real)} "$@"
`

function onPath(cmd: string, envPath: string): string | undefined {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, cmd)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      // not here
    }
  }
}

/** Writes the wrapper into `<dir>/bin` and returns the env that puts it first
 *  on PATH, or undefined when openshell is not installed (the runner check
 *  already says so). */
export function openShellShimEnv(dir: string, envPath = process.env.PATH ?? ''): Record<string, string> | undefined {
  const real = onPath('openshell', envPath)
  if (!real) return undefined
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'openshell'), SHIM(real), { mode: 0o755 })
  return { PATH: `${bin}${path.delimiter}${envPath}` }
}
