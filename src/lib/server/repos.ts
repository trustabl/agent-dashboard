import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from './db'
import { folderName, originName } from './git'

export interface RepoRow {
  id: string
  path: string
  name: string
  created_at: number
}

export class InputError extends Error {
  status = 400
}

/** Expand "~" and resolve to an absolute, normalized path. */
export function normalizeRepoPath(input: string): string {
  const raw = input.trim()
  if (raw === '') throw new InputError('A local path is required.')
  const expanded = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
  if (!path.isAbsolute(expanded)) throw new InputError(`Use an absolute path (or ~/…): ${raw}`)
  return path.resolve(expanded)
}

export function listRepos(): RepoRow[] {
  return db().prepare('SELECT * FROM repos ORDER BY name COLLATE NOCASE').all() as unknown as RepoRow[]
}

export function getRepo(id: string): RepoRow | undefined {
  return db().prepare('SELECT * FROM repos WHERE id = ?').get(id) as unknown as RepoRow | undefined
}

export function findRepoByPath(p: string): RepoRow | undefined {
  return db().prepare('SELECT * FROM repos WHERE path = ?').get(p) as unknown as RepoRow | undefined
}

/**
 * Register a local directory. `create` makes the folder first — the run
 * dialog's "New local path — agent not built" case. Nothing else is written.
 */
export async function addRepo(input: string, { create = false } = {}): Promise<RepoRow> {
  const p = normalizeRepoPath(input)
  const existing = findRepoByPath(p)
  if (existing) return existing
  if (!fs.existsSync(p)) {
    if (!create) throw new InputError(`Folder does not exist: ${p}`)
    fs.mkdirSync(p, { recursive: true })
  }
  if (!fs.statSync(p).isDirectory()) throw new InputError(`Not a folder: ${p}`)
  const name = (await originName(p)) ?? folderName(p)
  const row: RepoRow = { id: randomUUID(), path: p, name, created_at: Date.now() }
  db().prepare('INSERT INTO repos (id, path, name, created_at) VALUES (?, ?, ?, ?)').run(row.id, row.path, row.name, row.created_at)
  return row
}

export function removeRepo(id: string): void {
  db().prepare('DELETE FROM repos WHERE id = ?').run(id)
}
