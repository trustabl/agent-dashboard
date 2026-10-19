import { DatabaseSync } from 'node:sqlite'
import { paths, ensureDir } from './paths'

/**
 * SQLite through Node's built-in driver (node:sqlite, Node >= 22.13) — no
 * native module to compile, one file on disk. A single local user needs no
 * database server.
 */

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS repos (
     id TEXT PRIMARY KEY,
     path TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY,
     repo_id TEXT REFERENCES repos(id) ON DELETE CASCADE,
     tool TEXT NOT NULL,
     action TEXT NOT NULL,
     status TEXT NOT NULL,
     argv TEXT NOT NULL,
     command TEXT NOT NULL,
     cwd TEXT NOT NULL,
     tool_version TEXT,
     commit_sha TEXT,
     rules_sha TEXT,
     exit_code INTEGER,
     pid INTEGER,
     error TEXT,
     options TEXT NOT NULL DEFAULT '{}',
     summary TEXT NOT NULL DEFAULT '{}',
     started_at INTEGER NOT NULL,
     finished_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS runs_repo ON runs(repo_id, tool, started_at);
   CREATE TABLE IF NOT EXISTS artifacts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     path TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     UNIQUE(run_id, kind)
   );
   CREATE TABLE IF NOT EXISTS findings (
     run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
     fingerprint TEXT NOT NULL,
     rule_id TEXT NOT NULL,
     category TEXT,
     scope TEXT,
     severity TEXT NOT NULL,
     confidence REAL NOT NULL,
     title TEXT NOT NULL,
     explanation TEXT,
     suggested_fix TEXT,
     tool_name TEXT,
     file_path TEXT,
     start_line INTEGER,
     end_line INTEGER,
     origin TEXT,
     PRIMARY KEY (run_id, fingerprint)
   );
   CREATE INDEX IF NOT EXISTS findings_repo ON findings(repo_id);
   CREATE TABLE IF NOT EXISTS skills (
     repo_id TEXT PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
     check_status TEXT,
     check_detail TEXT,
     check_run_id TEXT,
     checked_at INTEGER
   );
   CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
]

type GlobalWithDb = typeof globalThis & { __trustablDb?: DatabaseSync }

export function db(): DatabaseSync {
  const g = globalThis as GlobalWithDb
  if (g.__trustablDb) return g.__trustablDb
  ensureDir(paths.home())
  const conn = new DatabaseSync(paths.db())
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  conn.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = conn.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
  let version = row?.version ?? 0
  if (!row) conn.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  while (version < MIGRATIONS.length) {
    conn.exec(MIGRATIONS[version])
    version++
    conn.prepare('UPDATE schema_version SET version = ?').run(version)
  }
  g.__trustablDb = conn
  return conn
}

export function getSetting<T>(key: string): T | undefined {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : undefined
}

export function setSetting(key: string, value: unknown): void {
  db()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}

/** Test hook: close and forget the connection (a new TRUSTABL_CONSOLE_HOME takes effect). */
export function resetDbForTests(): void {
  const g = globalThis as GlobalWithDb
  g.__trustablDb?.close()
  g.__trustablDb = undefined
}
