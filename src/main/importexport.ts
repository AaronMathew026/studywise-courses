import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { basename, extname, dirname, join, resolve, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseFrontmatter, importMarkdown, type ImportOptions } from '@shared/noteFormats'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { z } from 'zod'
import { parseStudySmarterText, serializeStudySmarterText } from '@shared/ssText'
import type { Card, CardInput } from '@shared/types'
import { CardInput as CardInputSchema } from '@shared/types'

// ---------- StudySmarter .txt ----------
export function cardsFromStudySmarterText(text: string, deckId: string): CardInput[] {
  return parseStudySmarterText(text).cards.map((p) => ({
    deck_id: deckId,
    format: 'question_answer',
    kind: p.kind,
    front: p.front,
    back: p.back,
    cloze_answers: p.cloze_answers,
    required_points: p.required_points,
    source: { type: 'import', ref: 'StudySmarter text' }
  }))
}
export function cardsToStudySmarterText(cards: Card[]): string {
  return serializeStudySmarterText(cards)
}

// ---------- StudySmarter .xlsx ----------
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const FLAG = 'answer is correct (TRUE if yes, FALSE if no)'
export const XLSX_HEADERS = ['Question', ...LETTERS.flatMap((l) => [`Answer ${l}`, FLAG]), 'Tags', 'Hints', 'Explanation']

/** Accept TRUE/FALSE, =TRUE()/=FALSE(), true/false, 1/0 (and formula cells). */
export function parseFlag(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1
  if (typeof v === 'object') {
    const o = v as { result?: unknown; formula?: string; richText?: { text: string }[] }
    if (o.result !== undefined) return parseFlag(o.result)
    if (o.formula) return /^=?\s*TRUE\s*\(\s*\)$/i.test(o.formula.trim()) || /^=?\s*TRUE$/i.test(o.formula.trim())
    if (o.richText) return parseFlag(o.richText.map((r) => r.text).join(''))
  }
  const s = String(v).trim().replace(/^=/, '').replace(/\(\)$/, '').toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: string; result?: unknown; hyperlink?: string }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (o.text !== undefined) return String(o.text)
    if (o.result !== undefined) return String(o.result)
    if (v instanceof Date) return v.toISOString()
  }
  return String(v)
}

const splitList = (s: string) =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)

export async function cardsFromXlsx(file: string | Buffer, deckId: string): Promise<CardInput[]> {
  const wb = new ExcelJS.Workbook()
  if (typeof file === 'string') await wb.xlsx.readFile(file)
  else await wb.xlsx.load(file as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  // Find columns by header names, falling back to the template order.
  const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => cellText(v).trim().toLowerCase())
  const col = (name: string, fallback: number) => {
    const i = header.findIndex((h) => h === name.toLowerCase())
    return (i === -1 ? fallback : i) + 1
  }
  const qCol = col('Question', 0)
  const ansCols = LETTERS.map((l, i) => ({ a: col(`Answer ${l}`, 1 + i * 2), f: col(`Answer ${l}`, 1 + i * 2) + 1 }))
  const tagsCol = col('Tags', 13)
  const hintsCol = col('Hints', 14)
  const explCol = col('Explanation', 15)
  const out: CardInput[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const front = cellText(row.getCell(qCol).value).trim()
    if (!front) return
    const answers = ansCols
      .map(({ a, f }) => ({ text: cellText(row.getCell(a).value).replace(/\r\n?/g, '\n').trim(), correct: parseFlag(row.getCell(f).value) }))
      .filter((x) => x.text)
    const isMc = answers.length > 1
    const correct = answers.filter((x) => x.correct)
    const back = isMc ? correct.map((c) => c.text).join('\n') : (answers[0]?.text ?? '')
    out.push({
      deck_id: deckId,
      format: 'question_answer',
      kind: isMc ? 'multiple_choice' : 'regular',
      front,
      back,
      options: isMc ? answers : [],
      tags: splitList(cellText(row.getCell(tagsCol).value)),
      hints: splitList(cellText(row.getCell(hintsCol).value)),
      explanation: cellText(row.getCell(explCol).value),
      source: { type: 'import', ref: 'xlsx' }
    })
  })
  return out
}

export async function cardsToXlsx(cards: Card[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Cards')
  ws.addRow(XLSX_HEADERS)
  ws.getRow(1).font = { bold: true }
  for (const c of cards) {
    const answers: { text: string; correct: boolean }[] =
      c.kind === 'multiple_choice' && c.options.length ? c.options.slice(0, 6) : [{ text: c.back, correct: true }]
    const cells: (string | boolean | null)[] = [c.front]
    for (let i = 0; i < 6; i++) {
      const a = answers[i]
      cells.push(a ? a.text : null, a ? a.correct : null)
    }
    cells.push(c.tags.join(';'), c.hints.join(';'), c.explanation || null)
    const row = ws.addRow(cells)
    row.alignment = { wrapText: true, vertical: 'top' }
  }
  ws.columns.forEach((col, i) => (col.width = i === 0 ? 50 : i % 2 === 1 ? 40 : 14))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ---------- JSON / CSV ----------
export const DeckJson = z.object({
  app: z.literal('studywise').optional(),
  kind: z.literal('deck').optional(),
  name: z.string(),
  description: z.string().optional(),
  extra_instructions: z.string().optional(),
  cards: z.array(CardInputSchema.omit({ deck_id: true }).partial())
})
export type DeckJson = z.infer<typeof DeckJson>

export function deckToJson(deck: { name: string; description: string; extra_instructions: string }, cards: Card[]): string {
  return JSON.stringify(
    {
      app: 'studywise',
      kind: 'deck',
      name: deck.name,
      description: deck.description,
      extra_instructions: deck.extra_instructions,
      cards: cards.map(({ id: _i, deck_id: _d, position: _p, created_at: _c, updated_at: _u, ...rest }) => rest)
    },
    null,
    2
  )
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function cardsToCsv(cards: Card[]): string {
  const head = ['front', 'back', 'kind', 'format', 'tags', 'hints', 'explanation', 'options']
  const rows = cards.map((c) =>
    [c.front, c.back, c.kind, c.format, c.tags.join(';'), c.hints.join(';'), c.explanation, c.options.length ? JSON.stringify(c.options) : ''].map(csvEscape).join(',')
  )
  return [head.join(','), ...rows].join('\n') + '\n'
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else q = false
      } else field += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}

export function cardsFromCsv(text: string, deckId: string): CardInput[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const hasHeader = head.includes('front') || head.includes('question')
  const idx = (names: string[], fb: number) => {
    const i = head.findIndex((h) => names.includes(h))
    return hasHeader ? i : fb
  }
  const fi = idx(['front', 'question', 'term'], 0)
  const bi = idx(['back', 'answer', 'definition'], 1)
  const ti = idx(['tags'], -1)
  const hi = idx(['hints'], -1)
  const ei = idx(['explanation'], -1)
  const oi = idx(['options'], -1)
  const ki = idx(['kind'], -1)
  const fmi = idx(['format'], -1)
  return rows.slice(hasHeader ? 1 : 0).map((r) => {
    let options: { text: string; correct: boolean }[] = []
    if (oi >= 0 && r[oi]) {
      try {
        options = z.array(z.object({ text: z.string(), correct: z.boolean() })).parse(JSON.parse(r[oi]))
      } catch {
        options = []
      }
    }
    const kind = ki >= 0 && ['regular', 'multiple_choice', 'cloze'].includes(r[ki]) ? (r[ki] as CardInput['kind']) : options.length ? 'multiple_choice' : 'regular'
    const format = fmi >= 0 && ['term_definition', 'question_answer', 'vocabulary'].includes(r[fmi]) ? (r[fmi] as CardInput['format']) : 'term_definition'
    return {
      deck_id: deckId,
      front: r[fi] ?? '',
      back: r[bi] ?? '',
      kind,
      format,
      options,
      tags: ti >= 0 ? splitList(r[ti] ?? '') : [],
      hints: hi >= 0 ? splitList(r[hi] ?? '') : [],
      explanation: ei >= 0 ? (r[ei] ?? '') : '',
      source: { type: 'import' as const, ref: 'csv' }
    }
  })
}

// ---------- notes import ----------
export interface ImportedNote {
  title: string
  module: string
  type: string
  week: string
  content: string
}

/**
 * A note from Notion or Obsidian Markdown (or plain Markdown). Properties come
 * from frontmatter (Obsidian) or "Key: value" lines under the title (Notion);
 * callouts, toggles, page links and images are converted (see noteFormats).
 */
export function noteFromMarkdown(md: string, fallbackTitle: string, opts: ImportOptions = {}): ImportedNote {
  let text = md.replace(/\r\n?/g, '\n')
  let title = fallbackTitle.replace(/\s+[0-9a-f]{32}$/i, '').trim()
  const meta: Record<string, string> = {}
  // Obsidian frontmatter comes first; Notion's title heading comes first.
  const fm = parseFrontmatter(text)
  for (const [k, v] of Object.entries(fm.data)) meta[k] = Array.isArray(v) ? v.join(', ') : v
  text = fm.body
  const h1 = text.match(/^\s*#\s+(.+)\n/)
  if (h1) {
    title = h1[1].trim()
    text = text.slice(h1[0].length)
  }
  // Notion property lines right after the title
  const lines = text.split('\n')
  let i = 0
  let props = 0
  while (i < lines.length && (lines[i].trim() === '' || /^(Module|Type|Week|Created|Tags|Status|Date)\s*:/i.test(lines[i]))) {
    const m = lines[i].match(/^(\w+)\s*:\s*(.*)$/)
    if (m) (meta[m[1].toLowerCase()] = m[2].trim()), props++
    i++
  }
  if (props) text = lines.slice(i).join('\n')
  if (meta.title) title = meta.title
  // Frontmatter properties the note has no field for stay in the note, so exporting to Obsidian brings them back.
  const extra = Object.entries(fm.data).filter(([k]) => !['title', 'module', 'type', 'week'].includes(k))
  const keep = extra.length ? `---\n${extra.map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n')}\n---\n\n` : ''
  return { title: title || 'Untitled', module: meta.module ?? '', type: meta.type ?? '', week: meta.week ?? '', content: keep + importMarkdown(text, opts).trim() + '\n' }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i

/** Copy an imported image into the attachments folder; returns the URL notes use for it. */
function saveImage(attachmentsDir: string, name: string, data: Buffer | Uint8Array): string {
  mkdirSync(attachmentsDir, { recursive: true })
  const fname = `${randomUUID()}${extname(name).toLowerCase() || '.png'}`
  writeFileSync(join(attachmentsDir, fname), data)
  return `studywise-file://attachments/${fname}`
}

/**
 * Notes from a .md file or a .zip (a Notion export or an Obsidian vault).
 * Images they reference are copied into `attachmentsDir`: by relative path
 * (Notion), or by file name anywhere nearby (Obsidian's ![[embeds]]).
 */
export async function notesFromFile(file: string, attachmentsDir?: string): Promise<ImportedNote[]> {
  const ext = extname(file).toLowerCase()
  const saved = new Map<string, string>()
  const once = (key: string, name: string, load: () => Buffer | Uint8Array | null): string | null => {
    if (!attachmentsDir) return null
    if (saved.has(key)) return saved.get(key)!
    const data = load()
    if (!data) return null
    const url = saveImage(attachmentsDir, name, data)
    saved.set(key, url)
    return url
  }
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const dir = dirname(file)
    // Where Obsidian and Notion usually keep a note's images.
    const near = [dir, join(dir, 'attachments'), join(dir, 'assets'), join(dir, 'images'), join(dir, '_resources'), join(dir, basename(file, ext)), dirname(dir), join(dirname(dir), 'attachments')]
    const resolveImage = (ref: string) => {
      if (!IMAGE_EXT.test(ref)) return null
      const hit = [resolve(dir, ref), ...near.map((d) => join(d, basename(ref)))].find((p) => existsSync(p) && statSync(p).isFile())
      return hit ? once(hit, hit, () => readFileSync(hit)) : null
    }
    return [noteFromMarkdown(readFileSync(file, 'utf8'), basename(file, ext), { resolveImage })]
  }
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(readFileSync(file))
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX'))
    const images = new Map<string, Uint8Array>()
    for (const n of entries.filter((n) => IMAGE_EXT.test(n))) images.set(n, await zip.files[n].async('uint8array'))
    const byName = new Map<string, string>()
    for (const n of images.keys()) if (!byName.has(basename(n).toLowerCase())) byName.set(basename(n).toLowerCase(), n)
    const out: ImportedNote[] = []
    for (const n of entries.filter((n) => /\.(md|markdown)$/i.test(n)).sort()) {
      const base = n.includes('/') ? n.slice(0, n.lastIndexOf('/') + 1) : ''
      const resolveImage = (ref: string) => {
        const rel = posix.normalize(base + ref.replace(/^\.\//, ''))
        const key = images.has(rel) ? rel : byName.get(basename(ref).toLowerCase())
        return key ? once(key, key, () => images.get(key) ?? null) : null
      }
      const md = await zip.files[n].async('string')
      out.push(noteFromMarkdown(md, basename(n).replace(/\.(md|markdown)$/i, ''), { resolveImage }))
    }
    return out
  }
  throw new Error(`Can't import notes from ${ext} files`)
}

export function writeText(file: string, text: string): void {
  writeFileSync(file, text, 'utf8')
}
