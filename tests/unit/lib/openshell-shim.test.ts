import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openShellShimEnv } from '@/lib/server/openshell-shim'

// The policy autofix 0.2.2 hands to `openshell sandbox create --policy` (verbatim).
const AUTOFIX_POLICY = `version: 1

filesystem_policy:
  read_only: [/usr, /lib, /etc, /dev/urandom, /dev/random]
  read_write: [/sandbox, /tmp]

landlock:
  compatibility: best_effort

process:
  run_as_user: sandbox
  run_as_group: sandbox

network_policies:
  outbound: []
`

describe('OpenShell policy shim', () => {
  let tmp: string
  let realDir: string
  let policy: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'))
    // A stand-in for the real openshell: prints its argv, then the policy file it was given.
    realDir = path.join(tmp, 'real')
    fs.mkdirSync(realDir)
    fs.writeFileSync(
      path.join(realDir, 'openshell'),
      '#!/bin/sh\necho "argv: $*"\nprev=\nfor a in "$@"; do [ "$prev" = --policy ] && cat "$a"; prev=$a; done\n',
      { mode: 0o755 },
    )
    policy = path.join(tmp, 'policy.yaml')
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const run = (env: Record<string, string>, args: string[]) => execFileSync('openshell', args, { env: { ...process.env, ...env }, encoding: 'utf8' })

  it('rewrites the empty outbound list to an empty rule map before sandbox create', () => {
    fs.writeFileSync(policy, AUTOFIX_POLICY)
    const env = openShellShimEnv(path.join(tmp, 'run'), `${realDir}:/usr/bin:/bin`)!
    const out = run(env, ['sandbox', 'create', '--name', 'x', '--from', 'openclaw', '--policy', policy, '--', 'sleep', 'infinity'])
    expect(out).toContain('argv: sandbox create --name x --from openclaw --policy')
    expect(out).toContain('network_policies: {}\n')
    expect(out).not.toContain('outbound')
    expect(out).toContain('run_as_user: sandbox')
  })

  it('leaves other commands and other policies untouched', () => {
    const custom = 'network_policies:\n  github:\n    endpoints: []\n'
    fs.writeFileSync(policy, custom)
    const env = openShellShimEnv(path.join(tmp, 'run'), `${realDir}:/usr/bin:/bin`)!
    expect(run(env, ['sandbox', 'create', '--policy', policy])).toContain(custom)
    expect(fs.readFileSync(policy, 'utf8')).toBe(custom)
    expect(run(env, ['sandbox', 'list'])).toBe('argv: sandbox list\n')
  })

  it('shortens autofix sandbox names to fit OpenShell, and maps them back in its output', () => {
    // The stand-in echoes its argv, so the name round-trips: short going in, long coming out.
    const env = openShellShimEnv(path.join(tmp, 'run'), `${realDir}:/usr/bin:/bin`)!
    expect(run(env, ['sandbox', 'exec', '-n', 'autofix-1792460985915', '--no-tty'])).toBe('argv: sandbox exec -n autofix-1792460985915 --no-tty\n')
    fs.writeFileSync(path.join(realDir, 'openshell'), '#!/bin/sh\necho "$*" >&2\n', { mode: 0o755 })
    const res = spawnSync('openshell', ['logs', 'autofix-1792460985915'], { env: { ...process.env, ...env }, encoding: 'utf8' })
    expect(res.stderr).toBe('logs autofix-1792460985915\n')
    const seen = path.join(tmp, 'argv')
    fs.writeFileSync(path.join(realDir, 'openshell'), `#!/bin/sh\necho "$*" > ${seen}\n`, { mode: 0o755 })
    run(env, ['sandbox', 'delete', 'autofix-1792460985915'])
    expect(fs.readFileSync(seen, 'utf8')).toBe('sandbox delete af-1792460985915\n')
  })

  it('passes the exit code through', () => {
    fs.writeFileSync(path.join(realDir, 'openshell'), '#!/bin/sh\nexit 3\n', { mode: 0o755 })
    const env = openShellShimEnv(path.join(tmp, 'run'), `${realDir}:/usr/bin:/bin`)!
    expect(spawnSync('openshell', ['sandbox', 'list'], { env: { ...process.env, ...env } }).status).toBe(3)
  })

  it('is not installed when openshell is not on PATH', () => {
    expect(openShellShimEnv(path.join(tmp, 'run'), '/nonexistent')).toBeUndefined()
  })
})
