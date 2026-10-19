import { spawn } from 'node:child_process'

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

/** Run a short command (git, docker info, `<tool> version`) and capture its
 *  output. Never through a shell: argv is passed as-is. */
export function execCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ code: null, stdout, stderr, timedOut, error: (err as Error).message })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs ?? 30_000)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err: Error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, timedOut, error: err.message })
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}
