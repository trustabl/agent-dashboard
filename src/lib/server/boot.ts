import { db } from './db'
import { reapOrphans } from './runner'
import { ensureRulesStatus } from './actions/forge'
import { cleanupInstallTemp, onToolInstalled } from './tools'
// Side-effect imports: register each action's finalizer.
import './actions/analyzer'
import './actions/probe'

type G = typeof globalThis & { __trustablBooted?: Promise<void> }

/** One-time server start work: open/migrate the DB, mark runs orphaned by a
 *  restart as interrupted, drop half-finished CLI installs, refresh the rules
 *  SHA if it is old (only when trustabl is already installed: a fresh start
 *  downloads nothing). */
export function boot(): Promise<void> {
  const g = globalThis as G
  g.__trustablBooted ??= (async () => {
    db()
    const n = reapOrphans()
    if (n) console.log(`[agent-dashboard] marked ${n} run(s) interrupted by a restart`)
    cleanupInstallTemp()
    // The first trustabl install resolves the rules SHA, as a start would.
    onToolInstalled('rules', (name) => {
      if (name === 'trustabl' && process.env.AGENT_DASHBOARD_NO_AUTORULES !== '1') void ensureRulesStatus()
    })
    if (process.env.AGENT_DASHBOARD_NO_AUTORULES !== '1') void ensureRulesStatus()
  })()
  return g.__trustablBooted
}
