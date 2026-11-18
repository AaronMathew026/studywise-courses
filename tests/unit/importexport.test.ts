import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { openDb, closeDb } from '../../src/main/db'
import * as repo from '../../src/main/db/repo'
import * as io from '../../src/main/importexport'

let dir: string
let deckId: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-io-'))
  openDb(join(dir, 't.db'))
  deckId = repo.createDeck({ name: 'IO' }).id
})
afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const TXT = `What is the work function?/#*#/the minimum energy needed to remove an electron
#
Explain why a threshold frequency exists (2)/#*#/- below the threshold frequency, photons have less energy than the work function

- so they do not have enough energy to remove an electron
#
Each electron can only absorb _________/#*#/one photon of energy
`

describe('StudySmarter .txt', () => {
  it('imports, stores and exports byte-for-byte', () => {
    const cards = repo.createCards(io.cardsFromStudySmarterText(TXT, deckId))
    expect(cards).toHaveLength(3)
    expect(cards[1].required_points).toBe(2)
    expect(cards[2].kind).toBe('cloze')
    expect(io.cardsToStudySmarterText(repo.listCards(deckId))).toBe(TXT)
  })
})

describe('StudySmarter .xlsx', () => {
  it('has the template columns in order', () => {
    expect(io.XLSX_HEADERS).toEqual([
      'Question',
      'Answer A', 'answer is correct (TRUE if yes, FALSE if no)',
      'Answer B', 'answer is correct (TRUE if yes, FALSE if no)',
      'Answer C', 'answer is correct (TRUE if yes, FALSE if no)',
      'Answer D', 'answer is correct (TRUE if yes, FALSE if no)',
      'Answer E', 'answer is correct (TRUE if yes, FALSE if no)',
      'Answer F', 'answer is correct (TRUE if yes, FALSE if no)',
      'Tags', 'Hints', 'Explanation'
    ])
  })
  it('round-trips regular + multiple-choice cards with line breaks, tags, hints, explanation', async () => {
    const d2 = repo.createDeck({ name: 'X' }).id
    repo.createCards([
      { deck_id: d2, front: 'Describe it (2)', back: '- one\n\n- two', tags: ['a', 'b'], hints: ['think'], explanation: '<b>why</b>' },
      { deck_id: d2, kind: 'multiple_choice', front: 'Pick', back: 'B', options: [{ text: 'A', correct: false }, { text: 'B', correct: true }, { text: 'C', correct: false }] }
    ])
    const buf = await io.cardsToXlsx(repo.listCards(d2))
    const back = await io.cardsFromXlsx(buf, d2)
    expect(back[0]).toMatchObject({ front: 'Describe it (2)', back: '- one\n\n- two', tags: ['a', 'b'], hints: ['think'], explanation: '<b>why</b>', kind: 'regular' })
    expect(back[1]).toMatchObject({ kind: 'multiple_choice', back: 'B' })
    expect(back[1].options).toEqual([{ text: 'A', correct: false }, { text: 'B', correct: true }, { text: 'C', correct: false }])
  })
  it('accepts TRUE/FALSE, =TRUE(), true, 1/0 flags', async () => {
    expect(['TRUE', '=TRUE()', 'true', 1, true, '1'].map(io.parseFlag)).toEqual([true, true, true, true, true, true])
    expect(['FALSE', '=FALSE()', 'false', 0, false, '', null].map(io.parseFlag)).toEqual([false, false, false, false, false, false, false])
    expect(io.parseFlag({ formula: 'TRUE()', result: true })).toBe(true)
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow(io.XLSX_HEADERS)
    ws.addRow(['Q', 'yes', '=TRUE()', 'no', 0, 'maybe', 'FALSE'])
    const cards = await io.cardsFromXlsx(Buffer.from(await wb.xlsx.writeBuffer()), deckId)
    expect(cards[0].options?.map((o) => o.correct)).toEqual([true, false, false])
  })
})

describe('CSV / JSON / notes', () => {
  it('CSV round trip with quotes and newlines', () => {
    const d = repo.createDeck({ name: 'csv' }).id
    repo.createCards([{ deck_id: d, front: 'a, "b"', back: 'line1\nline2', tags: ['t'] }])
    const csv = io.cardsToCsv(repo.listCards(d))
    const back = io.cardsFromCsv(csv, d)
    expect(back[0]).toMatchObject({ front: 'a, "b"', back: 'line1\nline2', tags: ['t'] })
  })
  it('deck JSON parses back', () => {
    const json = io.deckToJson(repo.getDeck(deckId), repo.listCards(deckId))
    const parsed = io.DeckJson.parse(JSON.parse(json))
    expect(parsed.cards).toHaveLength(3)
  })
  it('Notion markdown keeps title and Module/Type/Week', () => {
    const n = io.noteFromMarkdown('# Info Foraging\n\nModule: HCI\nType: Reading\nWeek: 3\n\n## What is IFT?\nstuff', 'Info Foraging 0123456789abcdef0123456789abcdef')
    expect(n).toMatchObject({ title: 'Info Foraging', module: 'HCI', type: 'Reading', week: '3' })
    expect(n.content.startsWith('## What is IFT?')).toBe(true)
  })
})
