import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import Database from 'better-sqlite3'
import JSZip from 'jszip'
import { readAnkiPackage, htmlToMarkdown, renderTemplate, readProtobuf, scheduleFrom } from '../../src/main/anki'

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const CRT = 1_700_000_000 // collection created (unix seconds)
const NOW = (CRT + 100 * 86400) * 1000

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-anki-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const BASIC_REV = {
  id: 1001,
  name: 'Basic (and reversed card)',
  type: 0,
  flds: [
    { name: 'Front', ord: 0 },
    { name: 'Back', ord: 1 }
  ],
  tmpls: [
    { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
    { name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' }
  ]
}
const CLOZE = {
  id: 1002,
  name: 'Cloze',
  type: 1,
  flds: [
    { name: 'Text', ord: 0 },
    { name: 'Back Extra', ord: 1 }
  ],
  tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>\n{{Back Extra}}' }]
}

const NOTES = [
  { id: 1, mid: 1001, flds: ['What is the <b>work function</b>?', 'the minimum energy to remove an electron<br><img src="photo.png">'], tags: ' physics quantum ' },
  { id: 2, mid: 1002, flds: ['{{c1::Photons}} carry energy {{c2::E = hf::formula}}', 'Planck, 1900'], tags: '' }
]
// [id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses]
const CARDS: [number, number, number, number, number, number, number, number, number, number, number][] = [
  [11, 1, 20, 0, 2, 2, 105, 30, 2300, 6, 1], // review card, due day 105
  [12, 1, 20, 1, 0, 0, 1, 0, 0, 0, 0], // reversed, new
  [13, 2, 21, 0, 0, 0, 2, 0, 0, 0, 0], // cloze 1
  [14, 2, 21, 1, 0, 0, 3, 0, 0, 0, 0] // cloze 2
]

function fillCommon(db: Database.Database) {
  db.exec(`CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
    CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);`)
  const n = db.prepare('INSERT INTO notes VALUES (?, ?, ?, 0, 0, ?, ?, ?, 0, 0, ?)')
  for (const x of NOTES) n.run(x.id, `g${x.id}`, x.mid, x.tags, x.flds.join('\x1f'), x.flds[0], '')
  const c = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)')
  for (const x of CARDS) c.run(...x, '')
  db.prepare('INSERT INTO revlog VALUES (?, 11, 0, 3, 30, 10, 2300, 5000, 1)').run((CRT + 75 * 86400) * 1000)
}

function legacyCollection(file: string) {
  const db = new Database(file)
  db.exec(`CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text)`)
  db.prepare('INSERT INTO col VALUES (1, ?, 0, 0, 11, 0, 0, 0, ?, ?, ?, ?, ?)').run(
    CRT,
    '{}',
    JSON.stringify({ 1001: BASIC_REV, 1002: CLOZE }),
    JSON.stringify({ 1: { id: 1, name: 'Default' }, 20: { id: 20, name: 'Physics::Quantum' }, 21: { id: 21, name: 'Physics::Cloze' } }),
    '{}',
    '{}'
  )
  fillCommon(db)
  db.close()
}

// Minimal protobuf writer for the schema-18 configs.
const varint = (n: number) => {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}
const pbField = (field: number, v: number | string | Buffer) =>
  typeof v === 'number' ? Buffer.concat([varint(field * 8), varint(v)]) : Buffer.concat([varint(field * 8 + 2), varint(Buffer.byteLength(v)), Buffer.from(v)])

function modernCollection(file: string) {
  const db = new Database(file)
  db.exec(`CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
    CREATE TABLE notetypes (id integer primary key, name text COLLATE NOCASE, mtime_secs integer, usn integer, config blob);
    CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL COLLATE NOCASE, config blob NOT NULL, PRIMARY KEY (ntid, ord)) WITHOUT ROWID;
    CREATE UNIQUE INDEX idx_fields_name_ntid ON fields (name, ntid);
    CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL COLLATE NOCASE, mtime_secs integer, usn integer, config blob, PRIMARY KEY (ntid, ord)) WITHOUT ROWID;
    CREATE TABLE decks (id integer primary key, name text COLLATE NOCASE, mtime_secs integer, usn integer, common blob, kind blob);`)
  db.prepare("INSERT INTO col VALUES (1, ?, 0, 0, 18, 0, 0, 0, '', '', '', '', '')").run(CRT)
  for (const m of [BASIC_REV, CLOZE]) {
    db.prepare('INSERT INTO notetypes VALUES (?, ?, 0, 0, ?)').run(m.id, m.name, m.type === 1 ? pbField(1, 1) : Buffer.alloc(0))
    for (const f of m.flds) db.prepare('INSERT INTO fields VALUES (?, ?, ?, ?)').run(m.id, f.ord, f.name, Buffer.alloc(0))
    for (const t of m.tmpls) db.prepare('INSERT INTO templates VALUES (?, ?, ?, 0, 0, ?)').run(m.id, t.ord, t.name, Buffer.concat([pbField(1, t.qfmt), pbField(2, t.afmt)]))
  }
  for (const [id, name] of [
    [1, 'Default'],
    [20, 'Physics\x1fQuantum'],
    [21, 'Physics\x1fCloze']
  ] as const)
    db.prepare('INSERT INTO decks VALUES (?, ?, 0, 0, ?, ?)').run(id, name, Buffer.alloc(0), Buffer.alloc(0))
  fillCommon(db)
  // Real Anki uses its own "unicase" collation, which SQLite can't create here,
  // so declare it the way Anki's schema does after the fact.
  db.unsafeMode(true)
  db.pragma('writable_schema = ON')
  db.prepare("UPDATE sqlite_master SET sql = replace(sql, 'COLLATE NOCASE', 'COLLATE unicase')").run()
  db.pragma('writable_schema = OFF')
  db.close()
}

async function makePackage(kind: 'legacy' | 'modern'): Promise<string> {
  const col = join(dir, `${kind}.sqlite`)
  const zip = new JSZip()
  if (kind === 'legacy') {
    legacyCollection(col)
    zip.file('collection.anki2', readFileSync(col))
    zip.file('media', JSON.stringify({ 0: 'photo.png' }))
    zip.file('0', PNG)
  } else {
    modernCollection(col)
    zip.file('collection.anki2', Buffer.from('stub')) // what new Anki writes for old clients
    zip.file('collection.anki21b', zstdCompressSync(readFileSync(col)))
    const entry = Buffer.concat([pbField(1, 'photo.png'), pbField(2, PNG.length)])
    zip.file('media', zstdCompressSync(pbField(1, entry)))
    zip.file('0', zstdCompressSync(PNG))
  }
  const out = join(dir, `${kind}.apkg`)
  require('node:fs').writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }))
  return out
}

describe('htmlToMarkdown', () => {
  it('converts the HTML Anki fields use', () => {
    expect(htmlToMarkdown('<div>Line one</div><div>Line <b>two</b> &amp; <i>more</i></div>')).toBe('Line one\nLine **two** & *more*')
    expect(htmlToMarkdown('a&nbsp;b<br>c [sound:x.mp3]')).toBe('a b\nc')
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
    expect(htmlToMarkdown('\\(E = hf\\) and \\[x^2\\] and [$]y[/$]')).toBe('$E = hf$ and $$x^2$$ and $y$')
    expect(htmlToMarkdown('H<sub>2</sub>O &#8594; &#x3bb;')).toBe('H~2~O → λ')
    expect(htmlToMarkdown('<img src="a%20b.png">', (n) => (n === 'a b.png' ? 'studywise-file://attachments/x.png' : null))).toBe('![](studywise-file://attachments/x.png)')
    expect(htmlToMarkdown('<img src="missing.png">text')).toBe('text')
  })
})

describe('renderTemplate', () => {
  it('handles fields, filters and conditionals', () => {
    const f = { Front: 'Q', Back: '<b>A</b>', Extra: '' }
    expect(renderTemplate('{{Front}}{{#Extra}} ({{Extra}}){{/Extra}}{{^Extra}} none{{/Extra}}', f, {})).toBe('Q none')
    expect(renderTemplate('{{text:Back}} {{type:Back}}|', f, {})).toBe('A |')
    expect(renderTemplate('{{FrontSide}}<hr id=answer>{{Back}}', f, { FrontSide: 'Q' })).toBe('Q<hr id=answer><b>A</b>')
  })
})

describe('protobuf reader', () => {
  it('reads varints and strings', () => {
    const m = readProtobuf(Buffer.concat([pbField(1, 1), pbField(2, 'hello'), pbField(3, 300)]))
    expect(m.get(1)).toEqual([1])
    expect(Buffer.from(m.get(2)![0] as Uint8Array).toString()).toBe('hello')
    expect(m.get(3)).toEqual([300])
  })
})

for (const kind of ['legacy', 'modern'] as const) {
  describe(`${kind} .apkg`, () => {
    it('imports decks, cards, cloze, images and review progress', async () => {
      const file = await makePackage(kind)
      const saved: string[] = []
      const pkg = await readAnkiPackage(file, { now: NOW, saveImage: (name, data) => (saved.push(`${name}:${data.length}`), `studywise-file://attachments/${name}`) })

      expect(pkg.skipped).toBe(0)
      expect(pkg.decks.map((d) => d.name).sort()).toEqual(['Physics › Cloze', 'Physics › Quantum'])
      expect(saved).toEqual([`photo.png:${PNG.length}`])

      const quantum = pkg.decks.find((d) => d.name === 'Physics › Quantum')!
      const [fwd, rev] = quantum.cards
      expect(fwd.input.front).toBe('What is the **work function**?')
      expect(fwd.input.back).toBe('the minimum energy to remove an electron\n![](studywise-file://attachments/photo.png)')
      expect(fwd.input.tags).toEqual(['physics', 'quantum'])
      expect(rev.input.front).toBe(fwd.input.back)
      expect(rev.input.back).toBe('What is the **work function**?')

      // Review card: due on day 105, last reviewed from the revlog.
      expect(fwd.schedule).toMatchObject({ interval: 30, ease: 2.3, repetitions: 6, lapses: 1, sr_state: 1, good_count: 2 })
      expect(fwd.schedule!.due).toBe(new Date((CRT + 105 * 86400) * 1000).toISOString())
      expect(fwd.schedule!.last_reviewed).toBe(new Date((CRT + 75 * 86400) * 1000).toISOString())
      expect(rev.schedule).toBeNull()

      const cloze = pkg.decks.find((d) => d.name === 'Physics › Cloze')!.cards
      expect(cloze).toHaveLength(2)
      expect(cloze[0].input).toMatchObject({ kind: 'cloze', front: '_____ carry energy E = hf', cloze_answers: ['Photons'], back: 'Photons', explanation: 'Planck, 1900' })
      expect(cloze[1].input).toMatchObject({ kind: 'cloze', front: 'Photons carry energy _____ (formula)', cloze_answers: ['E = hf'] })
    })

    it('can leave review progress behind', async () => {
      const pkg = await readAnkiPackage(join(dir, `${kind}.apkg`), { keepSchedule: false })
      expect(pkg.decks.flatMap((d) => d.cards).every((c) => c.schedule === null)).toBe(true)
      // No saveImage: images are dropped rather than left as broken links.
      expect(pkg.decks[0].cards.concat(pkg.decks[1].cards).some((c) => c.input.back?.includes('![]'))).toBe(false)
    })
  })
}

describe('scheduleFrom', () => {
  const base = { id: 1, nid: 1, did: 1, ord: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, odue: 0, odid: 0, data: null }
  it('maps relearning cards due at a unix time', () => {
    const due = CRT + 50 * 86400
    const s = scheduleFrom({ ...base, type: 3, queue: 1, due, ivl: 4, factor: 2000, reps: 9, lapses: 2 }, CRT, null, NOW)!
    expect(s.sr_state).toBe(-1)
    expect(s.due).toBe(new Date(due * 1000).toISOString())
  })
  it('uses FSRS difficulty when present', () => {
    const s = scheduleFrom({ ...base, type: 2, queue: 2, due: 120, ivl: 200, factor: 2500, reps: 10, data: '{"s":120,"d":5.5}' }, CRT, null, NOW)!
    expect(s.difficulty).toBeCloseTo(0.5, 5)
    expect(s.sr_state).toBe(2)
  })
})
