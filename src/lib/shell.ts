/** POSIX shell quoting for "Copy CLI". Safe characters pass through; anything
 *  else is single-quoted with embedded quotes escaped. */
export function shQuote(arg: string): string {
  if (arg === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'"'"'`)}'`
}

export interface CommandSpec {
  bin: string
  args: string[]
  cwd?: string
  /** Text fed to stdin (Probe gets "q" to leave its interactive fix review). */
  stdin?: string
  /** Environment variables the command depends on (names only, never values). */
  envNames?: string[]
}

/** The exact shell command a person can paste to reproduce a run. */
export function formatCommand(spec: CommandSpec): string {
  const parts = [spec.bin, ...spec.args].map(shQuote).join(' ')
  let cmd = parts
  if (spec.stdin !== undefined) {
    const shown = spec.stdin.replace(/\n$/, '')
    cmd = `printf '%s\\n' ${shQuote(shown)} | ${cmd}`
  }
  if (spec.cwd) cmd = `cd ${shQuote(spec.cwd)} && ${cmd}`
  return cmd
}
