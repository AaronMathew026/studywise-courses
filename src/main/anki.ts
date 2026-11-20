// Anki .apkg / .colpkg import.
//
// A package is a zip holding the collection (SQLite) plus numbered media files.
// Three generations are handled:
//   collection.anki2   schema 11, note types as JSON in col.models
//   collection.anki21  schema 11 (or 18), same idea
//   collection.anki21b schema 18, zstd-compressed, note types in their own
//                      tables with protobuf configs; media list is protobuf too
// When a newer file is present the older one is only a "please update" stub.
//
// Each Anki card (note × template) becomes one Studywise card: the template is
// rendered, HTML is turned into Markdown, images are copied into attachments,
// and cloze notes become fill-in-the-blank cards. Review progress can come too.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import Database from 'better-sqlite3'
import JSZip from 'jszip'
import type { CardInput, ReviewState } from '@shared/types'

export type AnkiCard = { input: Omit<CardInput, 'deck_id'>; schedule: Omit<ReviewState, 'card_id'> | null }
export interface AnkiDeck {
  ankiId: number
  /** Full path, levels joined with " › " */
  name: string
  cards: AnkiCard[]
}
export interface AnkiPackage {
  decks: AnkiDeck[]
  skipped: number
  images: number
}

// ---------------------------------------------------------------------------
// Tiny protobuf reader (only what note type / media configs need)

type PbValue = number | Uint8Array
export function readProtobuf(buf: Uint8Array): Map<number, PbValue[]> {
  const out = new Map<number, PbValue[]>()
  let i = 0
  const varint = (): number => {
    let result = 0
    let mul = 1
    for (;;) {
      const b = buf[i++]
      if (b === undefined) throw new Error('Truncated protobuf')
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
      mul *= 128
    }
  }
  while (i < buf.length) {
    const tag = varint()
    const field = Math.floor(tag / 8)
    const wire = tag & 7
    let v: PbValue
    if (wire === 0) v = varint()
    else if (wire === 1) {
      v = 0
      i += 8
    } else if (wire === 2) {
      const len = varint()
      v = buf.subarray(i, i + len)
      i += len
    } else if (wire === 5) {
      v = 0
      i += 4
    } else throw new Error(`Unsupported protobuf wire type ${wire}`)
    const list = out.get(field) ?? []
    list.push(v)
    out.set(field, list)
  }
  return out
}
const pbString = (m: Map<number, PbValue[]>, f: number): string => {
  const v = m.get(f)?.[0]
  return v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : ''
}
const pbNumber = (m: Map<number, PbValue[]>, f: number): number | null => {
  const v = m.get(f)?.[0]
  return typeof v === 'number' ? v : null
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((x, i) => b[i] === x)
const unzstd = (b: Uint8Array): Buffer => (isZstd(b) ? zstdDecompressSync(b) : Buffer.from(b))

// ---------------------------------------------------------------------------
// HTML → Markdown

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', times: '×', divide: '÷', deg: '°', plusmn: '±', micro: 'µ', middot: '·', rarr: '→', larr: '←', harr: '↔', rArr: '⇒', le: '≤', ge: '≥', ne: '≠', asymp: '≈', minus: '−', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', copy: '©', reg: '®', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', Sigma: 'Σ', theta: 'θ', omega: 'ω', Omega: 'Ω' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Anki field HTML → the Markdown Studywise cards use. `image` maps a media
 * file name to a URL (or null to drop it). */
export function htmlToMarkdown(html: string, image: (name: string) => string | null = () => null): string {
  // In HTML a raw newline is just a space; only <br> and blocks break lines.
  let s = html.replace(/[ \t]*\r?\n[ \t]*/g, ' ')
  s = s.replace(/\[sound:[^\]]*\]/g, '')
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // Maths: MathJax and Anki's LaTeX tags → KaTeX dollars.
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => `$${t.trim()}$`)
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => `$$${t.trim()}$$`)
  s = s.replace(/\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (_m, t: string) => `$$${t.trim()}$$`)
  s = s.replace(/\[\$\]([\s\S]+?)\[\/\$\]/g, (_m, t: string) => `$${t.trim()}$`)
  s = s.replace(/\[latex\]([\s\S]+?)\[\/latex\]/gi, (_m, t: string) => `$$${t.trim()}$$`)
  s = s.replace(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (_m, a?: string, b?: string, c?: string) => {
    const name = decodeEntities(a ?? b ?? c ?? '')
    let file = name
    try {
      file = decodeURIComponent(name)
    } catch {
      /* keep as is */
    }
    const url = image(file)
    return url ? `\u0001![](${url})\u0001` : ''
  })
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n')
  // Block edges become a soft break (\u0001), so <div>a</div><div>b</div> is one line break, not two.
  s = s.replace(/<li\b[^>]*>/gi, '\u0001- ')
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|table|blockquote|pre)>/gi, '\u0001')
  s = s.replace(/<(p|div|h[1-6]|ul|ol|table|blockquote|pre)\b[^>]*>/gi, '\u0001')
  s = s.replace(/<\/t[dh]>/gi, '  ')
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.replace(/<[^>]+>/g, '').trim() ? `**${inner.trim()}**` : inner))
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.replace(/<[^>]+>/g, '').trim() ? `*${inner.trim()}*` : inner))
  s = s.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '~$1~')
  s = s.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^$1^')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s).replace(/ /g, ' ')
  // Soft breaks merge with each other and with real line breaks next to them.
  s = s.replace(/\s*\u0001[\s\u0001]*/g, (m) => ((m.match(/\n/g)?.length ?? 0) >= 2 ? '\n\n' : '\n'))
  return s
    .split('\n')
    .map((l) => l.replace(/^[ \t]+(?!- )|[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const stripHtml = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Templates

interface NoteType {
  id: number
  name: string
  cloze: boolean
  fields: string[]
  templates: { ord: number; name: string; qfmt: string; afmt: string }[]
}

const BLANK = '\u0000B\u0000'

/** Render a cloze field for card number n: active clozes become blanks. */
function renderCloze(text: string, n: number, answers: string[]): string {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_m, num: string, ans: string, hint?: string) => {
    if (Number(num) !== n) return ans
    answers.push(stripHtml(ans))
    return hint ? `${BLANK} (${hint})` : BLANK
  })
}

/** Anki's template language: {{Field}}, {{filter:Field}}, {{#F}}…{{/F}}, {{^F}}…{{/F}}, {{FrontSide}}. */
export function renderTemplate(tpl: string, fields: Record<string, string>, extra: { FrontSide?: string; Tags?: string; Deck?: string; Card?: string; Type?: string; clozeN?: number; answers?: string[] }): string {
  const value = (name: string) => {
    if (name === 'FrontSide') return extra.FrontSide ?? ''
    if (name in fields) return fields[name]
    if (['Tags', 'Deck', 'Card', 'Type'].includes(name)) return String((extra as Record<string, unknown>)[name] ?? '')
    return ''
  }
  let s = tpl
  // Conditionals, innermost first.
  const section = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/
  for (let guard = 0; guard < 200 && section.test(s); guard++) {
    s = s.replace(section, (_m, kind: string, name: string, body: string) => {
      const filled = stripHtml(value(name.split(':').pop()!.trim())).length > 0
      return (kind === '#') === filled ? body : ''
    })
  }
  return s.replace(/\{\{([^{}]+?)\}\}/g, (_m, inner: string) => {
    const parts = inner.split(':').map((p) => p.trim())
    const name = parts.pop()!
    const filters = parts
    if (filters.includes('type')) return ''
    if (filters.includes('cloze')) {
      if (extra.clozeN == null) return value(name)
      return renderCloze(value(name), extra.clozeN, extra.answers ?? [])
    }
    let v = value(name)
    if (filters.includes('text')) v = stripHtml(v)
    if (filters.includes('kanji')) v = v.replace(/\[[^\]]*\]/g, '')
    if (filters.includes('kana')) v = v.replace(/[^\s[\]]+\[([^\]]*)\]/g, '$1')
    if (filters.includes('furigana')) v = v.replace(/ ?([^\s[\]]+)\[([^\]]*)\]/g, '$1($2)')
    return v
  })
}

/** The answer side minus the repeated question. */
function answerPart(rendered: string, front: string): string {
  const hr = rendered.search(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i)
  if (hr !== -1) return rendered.slice(rendered.indexOf('>', hr) + 1)
  if (front && rendered.startsWith(front)) return rendered.slice(front.length)
  return rendered
}

// ---------------------------------------------------------------------------
// Reading the collection

interface ColInfo {
  crt: number
  noteTypes: Map<number, NoteType>
  deckNames: Map<number, string>
}

function readColInfo(db: Database.Database): ColInfo {
  const col = db.prepare('SELECT * FROM col LIMIT 1').get() as Record<string, unknown>
  const crt = Number(col.crt ?? 0)
  const noteTypes = new Map<number, NoteType>()
  const deckNames = new Map<number, string>()
  const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)

  if (hasTable('notetypes')) {
    for (const nt of db.prepare('SELECT id, name, config FROM notetypes').all() as { id: number; name: string; config: Uint8Array | null }[]) {
      const cfg = nt.config ? readProtobuf(nt.config) : new Map()
      const fields = (db.prepare('SELECT name FROM fields WHERE ntid = ? ORDER BY ord').all(nt.id) as { name: string }[]).map((f) => f.name)
      const templates = (db.prepare('SELECT ord, name, config FROM templates WHERE ntid = ? ORDER BY ord').all(nt.id) as { ord: number; name: string; config: Uint8Array | null }[]).map((t) => {
        const c = t.config ? readProtobuf(t.config) : new Map()
        return { ord: t.ord, name: t.name, qfmt: pbString(c, 1), afmt: pbString(c, 2) }
      })
      noteTypes.set(Number(nt.id), { id: Number(nt.id), name: nt.name, cloze: pbNumber(cfg, 1) === 1, fields, templates })
    }
  }
  if (noteTypes.size === 0 && typeof col.models === 'string' && col.models) {
    const models = JSON.parse(col.models) as Record<string, { id: number; name: string; type: number; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }>
    for (const m of Object.values(models)) {
      noteTypes.set(Number(m.id), {
        id: Number(m.id),
        name: m.name,
        cloze: m.type === 1,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt }))
      })
    }
  }

  if (hasTable('decks')) {
    for (const d of db.prepare('SELECT id, name FROM decks').all() as { id: number; name: string }[]) deckNames.set(Number(d.id), d.name.split('\u001f').join('::'))
  }
  if (deckNames.size === 0 && typeof col.decks === 'string' && col.decks) {
    for (const d of Object.values(JSON.parse(col.decks) as Record<string, { id: number; name: string }>)) deckNames.set(Number(d.id), d.name)
  }
  return { crt, noteTypes, deckNames }
}

const DAY = 86_400_000
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

interface CardRow {
  id: number
  nid: number
  did: number
  ord: number
  type: number
  queue: number
  due: number
  ivl: number
  factor: number
  reps: number
  lapses: number
  odue: number
  odid: number
  data: string | null
}

/** Anki scheduling → Studywise review state. Null for new cards. */
export function scheduleFrom(c: CardRow, crt: number, lastReview: number | null, now = Date.now()): Omit<ReviewState, 'card_id'> | null {
  if (c.type === 0) return null
  const dueRaw = c.odid ? c.odue : c.due
  // Learning cards (queue 1) are due at a unix time; everything else in days since the collection was made.
  const dueMs = c.queue === 1 || (c.type !== 2 && dueRaw > 1_000_000_000) ? dueRaw * 1000 : (crt + dueRaw * 86400) * 1000
  const due = Number.isFinite(dueMs) && dueMs > 0 ? dueMs : now
  const interval = c.type === 2 ? Math.max(1, c.ivl) : Math.max(0, c.ivl > 0 ? c.ivl : 0)
  const ease = c.factor > 0 ? c.factor / 1000 : 2.5
  let difficulty = clamp(0.6 - (ease - 2.5) * 0.5, 0.1, 0.95)
  if (c.data) {
    try {
      const d = (JSON.parse(c.data) as { d?: number }).d
      if (typeof d === 'number' && d >= 1 && d <= 10) difficulty = clamp((d - 1) / 9, 0.05, 0.95)
    } catch {
      /* not FSRS */
    }
  }
  const srState = c.type === 3 ? -1 : c.type === 1 ? 0 : interval >= 115 ? 2 : 1
  return {
    ease,
    interval,
    repetitions: c.reps,
    lapses: c.lapses,
    due: new Date(due).toISOString(),
    last_reviewed: new Date(lastReview ?? Math.min(now, due - interval * DAY)).toISOString(),
    difficulty,
    sr_state: srState,
    good_count: c.type === 2 ? 2 : Math.min(c.reps, 1)
  }
}

// ---------------------------------------------------------------------------
// Media

async function mediaIndex(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>() // file name → zip entry
  const entry = zip.file('media')
  if (!entry) return out
  const raw = await entry.async('uint8array')
  if (!raw.length) return out
  if (isZstd(raw)) {
    const list = readProtobuf(unzstd(raw)).get(1) ?? []
    list.forEach((e, i) => {
      if (!(e instanceof Uint8Array)) return
      const m = readProtobuf(e)
      const name = pbString(m, 1)
      const legacy = pbNumber(m, 255)
      if (name) out.set(name, String(legacy ?? i))
    })
    return out
  }
  try {
    for (const [k, v] of Object.entries(JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, string>)) out.set(v, k)
  } catch {
    /* no usable media list */
  }
  return out
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])

// ---------------------------------------------------------------------------

export interface ReadOptions {
  keepSchedule?: boolean
  /** Store an image and return its URL. */
  saveImage?: (name: string, data: Buffer) => string
  now?: number
}

export async function readAnkiPackage(file: string | Buffer, opts: ReadOptions = {}): Promise<AnkiPackage> {
  const zip = await JSZip.loadAsync(typeof file === 'string' ? (await import('node:fs')).readFileSync(file) : file)
  const pick = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.file(n))
  if (!pick) throw new Error('This doesn’t look like an Anki package (no collection inside).')
  const dbBytes = unzstd(await zip.file(pick)!.async('uint8array'))
  const work = mkdtempSync(join(tmpdir(), 'studywise-anki-'))
  const dbPath = join(work, 'collection.sqlite')
  writeFileSync(dbPath, dbBytes)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const info = readColInfo(db)
    const media = await mediaIndex(zip)
    const saved = new Map<string, string | null>()
    const pending: { name: string; entry: string }[] = []
    // Images are referenced synchronously during conversion and written after.
    const imageUrl = (name: string): string | null => {
      if (saved.has(name)) return saved.get(name)!
      const entry = media.get(name)
      if (!entry || !IMAGE_EXT.has(extname(name).toLowerCase()) || !opts.saveImage || !zip.file(entry)) {
        saved.set(name, null)
        return null
      }
      const token = `\u0000IMG${pending.length}\u0000`
      pending.push({ name, entry })
      saved.set(name, token)
      return token
    }

    const lastReview = new Map<number, number>()
    try {
      for (const r of db.prepare('SELECT cid, MAX(id) AS at FROM revlog GROUP BY cid').all() as { cid: number; at: number }[]) lastReview.set(Number(r.cid), Number(r.at))
    } catch {
      /* no revlog */
    }

    const notes = new Map<number, { mid: number; flds: string; tags: string }>()
    for (const n of db.prepare('SELECT id, mid, flds, tags FROM notes').all() as { id: number; mid: number; flds: string; tags: string }[]) notes.set(Number(n.id), { mid: Number(n.mid), flds: n.flds, tags: n.tags })

    const decks = new Map<number, AnkiDeck>()
    let skipped = 0
    const cards = db.prepare('SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odue, odid, data FROM cards ORDER BY did, nid, ord').all() as CardRow[]
    for (const c of cards) {
      const note = notes.get(Number(c.nid))
      const nt = note && info.noteTypes.get(note.mid)
      if (!note || !nt) {
        skipped++
        continue
      }
      const values = note.flds.split('\u001f')
      const fields: Record<string, string> = {}
      nt.fields.forEach((f, i) => (fields[f] = values[i] ?? ''))
      const tags = note.tags.trim() ? note.tags.trim().split(/\s+/) : []
      const deckId = Number(c.odid || c.did)
      const deckName = info.deckNames.get(deckId) ?? 'Imported'
      const base = { Tags: note.tags.trim(), Deck: deckName, Type: nt.name }

      let input: Omit<CardInput, 'deck_id'> | null = null
      if (nt.cloze) {
        const tpl = nt.templates[0]
        if (!tpl) {
          skipped++
          continue
        }
        const n = c.ord + 1
        const answers: string[] = []
        const frontHtml = renderTemplate(tpl.qfmt, fields, { ...base, Card: `Cloze ${n}`, clozeN: n, answers })
        if (!answers.length || /image-occlusion:/i.test(frontHtml)) {
          skipped++
          continue
        }
        // Whatever the answer side adds beyond the cloze text (e.g. "Back Extra").
        const extraHtml = renderTemplate(tpl.afmt.replace(/\{\{[^{}]*cloze:[^{}]*\}\}/gi, ''), fields, { ...base, Card: `Cloze ${n}`, FrontSide: '' })
        const front = htmlToMarkdown(frontHtml, imageUrl).replace(/\u0000B\u0000/g, '_____')
        input = {
          format: 'question_answer',
          kind: 'cloze',
          front,
          back: answers.length === 1 ? answers[0] : answers.map((a) => `- ${a}`).join('\n\n'),
          cloze_answers: answers,
          tags,
          explanation: htmlToMarkdown(extraHtml, imageUrl),
          source: { type: 'import', ref: 'Anki' }
        }
      } else {
        const tpl = nt.templates.find((t) => t.ord === c.ord) ?? nt.templates[0]
        if (!tpl) {
          skipped++
          continue
        }
        const card = { ...base, Card: tpl.name }
        const frontHtml = renderTemplate(tpl.qfmt, fields, card)
        const backHtml = answerPart(renderTemplate(tpl.afmt, fields, { ...card, FrontSide: frontHtml }), frontHtml)
        const front = htmlToMarkdown(frontHtml, imageUrl)
        const back = htmlToMarkdown(backHtml, imageUrl)
        if (!front && !back) {
          skipped++
          continue
        }
        input = { format: 'question_answer', kind: 'regular', front, back, tags, source: { type: 'import', ref: 'Anki' } }
      }

      const deck = decks.get(deckId) ?? { ankiId: deckId, name: deckName.split('::').map((p) => p.trim()).join(' › '), cards: [] }
      deck.cards.push({ input, schedule: opts.keepSchedule === false ? null : scheduleFrom(c, info.crt, lastReview.get(Number(c.id)) ?? null, opts.now) })
      decks.set(deckId, deck)
    }

    // Copy the images that were used, then swap the placeholders for URLs.
    const urls: string[] = []
    for (const p of pending) {
      const data = unzstd(await zip.file(p.entry)!.async('uint8array'))
      urls.push(opts.saveImage!(p.name, data))
    }
    const fill = (s: string | undefined) => (s ? s.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => urls[Number(i)] ?? '') : s)
    for (const d of decks.values())
      for (const c of d.cards) {
        c.input.front = fill(c.input.front)
        c.input.back = fill(c.input.back)
        c.input.explanation = fill(c.input.explanation)
      }

    return { decks: [...decks.values()].filter((d) => d.cards.length), skipped, images: urls.length }
  } finally {
    db.close()
    rmSync(work, { recursive: true, force: true })
  }
}

export const isAnkiFile = (f: string) => ['.apkg', '.colpkg'].includes(extname(f).toLowerCase())
export const ankiStem = (f: string) => basename(f, extname(f))
