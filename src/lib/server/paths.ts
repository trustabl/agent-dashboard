import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Every byte of Console state lives under one directory so it can be wiped
 * with one command (`make wipe`). Override with AGENT_DASHBOARD_HOME.
 */
export function consoleHome(): string {
  const fromEnv = process.env.AGENT_DASHBOARD_HOME
  const dir = fromEnv && fromEnv.trim() !== '' ? fromEnv : path.join(os.homedir(), '.agent-dashboard')
  return path.resolve(dir)
}

export const paths = {
  home: () => consoleHome(),
  db: () => path.join(consoleHome(), 'console.db'),
  bin: () => path.join(consoleHome(), 'bin'),
  runs: () => path.join(consoleHome(), 'runs'),
  run: (id: string) => path.join(consoleHome(), 'runs', id),
  /** XDG_CACHE_HOME handed to the CLIs, so their rule and result caches sit
   *  under the Console home on Linux/WSL (macOS ignores XDG; see README). */
  cliCache: () => path.join(consoleHome(), 'cache'),
  tmp: () => path.join(consoleHome(), 'tmp'),
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** The path forge writes, relative to a repo root. Fixed by the prompt. */
export const SKILL_REL_PATH = path.join('.claude', 'skills', 'trustabl-pre-coding', 'SKILL.md')
