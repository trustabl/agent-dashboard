const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r(?!\n)/g

/** Remove terminal color/cursor sequences so CLI output reads cleanly. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

export function tailLines(s: string, n: number): string {
  const lines = s.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.slice(-n).join('\n')
}

export function shortSha(sha: string | null | undefined, n = 7): string {
  return sha ? sha.slice(0, n) : ''
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
