// Library export/import: one .studywise file that moves everything to another
// computer, Mac or Windows.
//
// The file is a zip:
//   library.json      every deck, card, note, folder and course, plus your
//                     prompts and custom actions
//   attachments/...   pasted and imported images
//   courses/<id>/...  each course's copied source files and rendered figures
//
// Review history and where you are in each topic only go in when asked
// (includeProgress). Nothing machine-specific goes in: no settings, API keys or
// absolute paths; course files are stored relative to their course folder.
//
// Importing adds to the library rather than replacing it. Every id gets a new
// one, so importing the same file twice gives two copies instead of clashing.
// Ids are UUIDs, and every reference to one (rows, figure URLs inside notes,
// file names of figures) is the same string, so one pass over the JSON with
// an old→new map rewrites them all.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, normalize, relative, sep } from 'node:path'
import JSZip from 'jszip'
import { getDb } from './db'
import { paths } from './paths'
import { exportPresets, importPresets } from './ai/presets'

export const LIBRARY_EXT = 'studywise'
const FORMAT = 1

type Row = Record<string, unknown>

interface LibraryJson {
  app: 'studywise-courses'
  format: number
  exportedAt: string
  includesProgress: boolean
  tables: Record<string, Row[]>
  presets?: unknown
}

export interface LibraryCounts {
  decks: number
  cards: number
  notes: number
  courses: number
  files: number
  reviews: number
}

/** Tables in insert order (parents first). The last two are progress. */
const CONTENT_TABLES = ['folders', 'decks', 'cards', 'notes', 'note_decks', 'courses', 'weeks', 'course_files', 'topics'] as const
const PROGRESS_TABLES = ['review_state', 'review_log'] as const
/** Tables whose `id` column is a UUID that gets replaced on import. */
const ID_TABLES = ['folders', 'decks', 'cards', 'notes', 'courses', 'weeks', 'course_files', 'topics']

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const zipPath = (p: string) => p.split(sep).join('/')

// ---------------------------------------------------------------------------
// Export

export async function exportLibrary(file: string, opts: { includeProgress: boolean }): Promise<LibraryCounts> {
  const d = getDb()
  const tables: Record<string, Row[]> = {}
  for (const t of CONTENT_TABLES) tables[t] = d.prepare(`SELECT * FROM ${t}`).all() as Row[]
  if (opts.includeProgress) {
    tables.review_state = d.prepare('SELECT * FROM review_state').all() as Row[]
    tables.review_log = (d.prepare('SELECT * FROM review_log').all() as Row[]).map(({ id: _id, ...r }) => r)
  } else {
    // A fresh start: every topic unstarted.
    tables.topics = tables.topics.map((t) => ({ ...t, progress: '{}' }))
  }
  // Course files are stored relative to their course folder, so paths work anywhere.
  tables.course_files = tables.course_files.map((f) => ({ ...f, path: zipPath(relative(join(paths.courses, String(f.course_id)), String(f.path))) }))

  const lib: LibraryJson = { app: 'studywise-courses', format: FORMAT, exportedAt: new Date().toISOString(), includesProgress: opts.includeProgress, tables, presets: exportPresets() }
  const zip = new JSZip()
  zip.file('library.json', JSON.stringify(lib), { compression: 'DEFLATE' })
  for (const f of walk(paths.attachments)) zip.file(`attachments/${zipPath(relative(paths.attachments, f))}`, readFileSync(f))
  const courseIds = new Set(tables.courses.map((c) => String(c.id)))
  for (const id of courseIds) for (const f of walk(join(paths.courses, id))) zip.file(`courses/${zipPath(relative(paths.courses, f))}`, readFileSync(f))
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
  return countsOf(tables)
}

function countsOf(t: Record<string, Row[]>): LibraryCounts {
  return {
    decks: t.decks?.length ?? 0,
    cards: t.cards?.length ?? 0,
    notes: t.notes?.length ?? 0,
    courses: t.courses?.length ?? 0,
    files: t.course_files?.length ?? 0,
    reviews: t.review_state?.length ?? 0
  }
}

// ---------------------------------------------------------------------------
// Import

/** Names that work as file names on both Windows and macOS. */
export function safeFileName(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim()
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s) ? `_${s}` : s || 'file'
}

/** Parents before children, so folder references always resolve. */
function sortFolders(rows: Row[]): Row[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: Row[] = []
  const seen = new Set<unknown>()
  const visit = (r: Row) => {
    if (seen.has(r.id)) return
    seen.add(r.id)
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined
    if (parent) visit(parent)
    out.push(r)
  }
  rows.forEach(visit)
  return out
}

export async function importLibrary(file: string): Promise<LibraryCounts & { includesProgress: boolean }> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const entry = zip.file('library.json')
  if (!entry) throw new Error('This isn’t a Studywise library file.')
  const raw = await entry.async('string')
  const parsed = JSON.parse(raw) as LibraryJson
  if (parsed.app !== 'studywise-courses' || typeof parsed.tables !== 'object') throw new Error('This isn’t a Studywise library file.')
  if (parsed.format > FORMAT) throw new Error('This library was exported by a newer version of Studywise. Update the app, then import it again.')

  // New ids for everything, applied to every place an id appears.
  const remap = new Map<string, string>()
  for (const t of ID_TABLES) for (const r of parsed.tables[t] ?? []) if (typeof r.id === 'string') remap.set(r.id.toLowerCase(), randomUUID())
  const swap = (s: string) => s.replace(UUID, (m) => remap.get(m.toLowerCase()) ?? m)
  const tables = JSON.parse(swap(JSON.stringify(parsed.tables))) as Record<string, Row[]>

  const d = getDb()
  const columns = (t: string) => new Set((d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name))
  const insert = (t: string, rows: Row[]) => {
    if (!rows.length) return
    const have = columns(t)
    for (const r of rows) {
      const keys = Object.keys(r).filter((k) => have.has(k) && !(t === 'review_log' && k === 'id'))
      d.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(Object.fromEntries(keys.map((k) => [k, r[k]])))
    }
  }

  // Course files go back under this computer's course folder.
  for (const f of tables.course_files ?? []) {
    const rel = normalize(String(f.path)).split(sep).filter((p) => p && p !== '..')
    f.path = join(paths.courses, String(f.course_id), ...rel.slice(0, -1), safeFileName(rel[rel.length - 1] ?? String(f.name)))
  }
  // Anything still running when it was exported isn't running here.
  for (const w of tables.weeks ?? []) if (w.status === 'planning') Object.assign(w, { status: 'error', error: 'Planning was interrupted. Plan it again.' })
  for (const t of tables.topics ?? []) if (t.status === 'writing') Object.assign(t, { status: 'error', error: 'Interrupted. Write it again.' })

  d.transaction(() => {
    for (const t of CONTENT_TABLES) insert(t, t === 'folders' ? sortFolders(tables[t] ?? []) : (tables[t] ?? []))
    if (parsed.includesProgress) for (const t of PROGRESS_TABLES) insert(t, tables[t] ?? [])
  })()

  // Files: images keep their names (already unique); course files move with their course's new id.
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir) continue
    let out: string | null = null
    if (name.startsWith('attachments/')) {
      out = join(paths.attachments, ...name.slice('attachments/'.length).split('/').map(safeFileName))
      if (existsSync(out)) continue
    } else if (name.startsWith('courses/')) {
      const parts = swap(name.slice('courses/'.length)).split('/').filter((p) => p && p !== '..')
      out = join(paths.courses, ...parts.slice(0, -1), safeFileName(parts[parts.length - 1]))
    }
    if (!out) continue
    // Never write outside the data folder.
    if (!out.startsWith(paths.attachments + sep) && !out.startsWith(paths.courses + sep)) continue
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, await f.async('nodebuffer'))
  }

  if (parsed.presets) {
    try {
      importPresets(parsed.presets)
    } catch {
      /* prompts are a bonus; the library itself is in */
    }
  }
  return { ...countsOf(tables), reviews: parsed.includesProgress ? (tables.review_state?.length ?? 0) : 0, includesProgress: parsed.includesProgress }
}

export const libraryFileName = () => `Studywise library ${new Date().toISOString().slice(0, 10)}.${LIBRARY_EXT}`
export const isLibraryFile = (f: string) => basename(f).toLowerCase().endsWith(`.${LIBRARY_EXT}`)
