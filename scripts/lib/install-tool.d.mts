export type HashSource = 'lock' | 'upstream'

export interface LockEntry {
  version: string
  repo: string
  binary: string
  archive: string
  sha256: Record<string, string>
}

export interface Platform {
  os: 'darwin' | 'linux'
  arch: 'amd64' | 'arm64'
}

export type InstallStep = 'resolve' | 'checksums' | 'download' | 'verify' | 'extract'

export class InstallError extends Error {
  constructor(message: string, step: InstallStep)
  step: InstallStep
}

export interface InstallOptions {
  name: string
  entry: LockEntry
  version: string
  home: string
  hashSource: HashSource
  onProgress?: (line: string) => void
  download?: (url: string, dest: string) => Promise<void>
  /** Folder of release archives used instead of downloading, for 'lock' only.
   *  Defaults to TRUSTABL_TOOLS_ARCHIVE_DIR. */
  archiveDir?: string
}

export interface InstallResult {
  dir: string
  bin: string
  sha256: string
  hashSource: HashSource
}

export function platform(): Platform
export function archiveName(entry: LockEntry, version: string, plat?: Platform): string
export function download(url: string, dest: string): Promise<void>
export function parseChecksums(text: string): Map<string, string>
export function parseLatestTag(finalUrl: string): string
export function latestVersion(repo: string, opts?: { resolve?: (url: string) => Promise<string> }): Promise<string>
export function installTool(opts: InstallOptions): Promise<InstallResult>
