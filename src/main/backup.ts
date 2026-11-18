import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, renameSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { getDb, closeDb, openDb } from './db'
import { paths } from './paths'

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** Zip the database (a consistent snapshot) plus attachments. */
export async function backupLibrary(file: string): Promise<void> {
  const snap = join(tmpdir(), `studywise-backup-${Date.now()}.db`)
  await getDb().backup(snap)
  const zip = new JSZip()
  zip.file('studywise.db', readFileSync(snap))
  rmSync(snap, { force: true })
  for (const f of walk(paths.attachments)) zip.file(join('attachments', relative(paths.attachments, f)), readFileSync(f))
  zip.file('backup.json', JSON.stringify({ app: 'studywise', created: new Date().toISOString(), version: 1 }, null, 2))
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export async function restoreLibrary(file: string): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  if (!zip.files['studywise.db']) throw new Error('This zip is not a Studywise backup (no studywise.db inside).')
  // Keep the current library next to it, just in case.
  closeDb()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (existsSync(paths.db)) renameSync(paths.db, `${paths.db}.before-restore-${stamp}`)
  for (const ext of ['-wal', '-shm']) rmSync(paths.db + ext, { force: true })
  writeFileSync(paths.db, await zip.files['studywise.db'].async('nodebuffer'))
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('attachments/')) continue
    const out = join(paths.userData, name)
    if (!out.startsWith(paths.attachments)) continue // no path traversal
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, await entry.async('nodebuffer'))
  }
  openDb(paths.db)
}
