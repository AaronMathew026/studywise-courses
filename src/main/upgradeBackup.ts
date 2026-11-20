import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Installing a new version over an old one keeps the data folder (the installer
// never touches it), but the new version may migrate the database on first
// launch. Before that happens, copy the database aside so an upgrade can always
// be undone by hand: quit, copy the file from backups/ back over studywise.db.

const KEEP = 5

/**
 * Copies `db` (with its -wal/-shm files) into `backupsDir` when the app version
 * differs from the one that last ran. Returns the backup folder, or null if none
 * was needed. Call before the database is opened.
 */
export function backupOnUpgrade(db: string, backupsDir: string, markerFile: string, version: string): string | null {
  const last = existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : null
  if (last === version) return null
  let out: string | null = null
  if (existsSync(db)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    out = join(backupsDir, `before-${version}-from-${last ?? 'unknown'}-${stamp}`)
    mkdirSync(out, { recursive: true })
    for (const ext of ['', '-wal', '-shm']) if (existsSync(db + ext)) copyFileSync(db + ext, join(out, `studywise.db${ext}`))
    prune(backupsDir)
  }
  writeFileSync(markerFile, version)
  return out
}

/** Keep only the newest few upgrade backups (folder names sort by date). */
function prune(backupsDir: string): void {
  const stamp = (n: string) => n.replace(/^.*-(\d{4}-\d{2}-\d{2}T[\d-]+Z)$/, '$1')
  const byDate = readdirSync(backupsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('before-'))
    .map((d) => d.name)
    .sort((a, b) => stamp(a).localeCompare(stamp(b)))
  for (const d of byDate.slice(0, Math.max(0, byDate.length - KEEP))) rmSync(join(backupsDir, d), { recursive: true, force: true })
}
