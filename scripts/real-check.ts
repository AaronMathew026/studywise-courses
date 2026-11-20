// npm run ai:real-check [-- --only=tasks|pdf]
// Makes one real Claude call for every task and checks the output parses,
// then generates notes and flashcards from a 12-page PDF with tables and
// diagrams (one 20-page chunk). Writes results to ./real-check-out/.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDb, closeDb } from '../src/main/db'
import * as repo from '../src/main/db/repo'
import { seedPresets, listActions, getPresetByKey } from '../src/main/ai/presets'
import { detectClaude } from '../src/main/ai/claudePath'
import { runAI, friendlyError } from '../src/main/ai'
import * as learn from '../src/main/services/learn'
import * as gen from '../src/main/services/generate'
import * as explain from '../src/main/services/explain'
import type { JobContext } from '../src/main/jobs'
import { QUESTION_TYPES } from '../src/shared/types'

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]
const outDir = resolve('real-check-out')
mkdirSync(outDir, { recursive: true })

const ctx = (label: string): JobContext => ({
  signal: new AbortController().signal,
  progress: (m) => process.stdout.write(`\r  ${label}: ${m.padEnd(70)}`),
  delta: () => {},
  meta: () => {}
})

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'studywise-real-'))
  openDb(join(dir, 'real.db'))
  seedPresets()
  const st = await detectClaude()
  console.log(`claude ${st.version} at ${st.path} (${st.loggedIn ? 'logged in' : 'NOT logged in'})`)
  if (!st.loggedIn) process.exit(1)
  let failed = 0
  const step = async (name: string, fn: () => Promise<string>) => {
    const t = Date.now()
    try {
      const r = await fn()
      console.log(`\n✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s) ${r.replace(/\s+/g, ' ').slice(0, 160)}`)
    } catch (e) {
      failed++
      console.log(`\n✗ ${name}: ${friendlyError(e)}`)
    }
  }

  const deck = repo.createDeck({ name: 'Photoelectric' })
  const cards = repo.createCards([
    { deck_id: deck.id, front: 'What is the work function?', back: 'the **minimum energy** needed to remove an electron from the surface of a metal' },
    { deck_id: deck.id, front: 'Explain why a threshold frequency exists (2)', back: '- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron' },
    { deck_id: deck.id, front: 'Each electron can only absorb _________', back: 'one photon of energy', cloze_answers: ['one photon of energy'] },
    { deck_id: deck.id, front: 'What does increasing intensity change?', back: 'the **number** of photoelectrons emitted per second' },
    { deck_id: deck.id, front: 'What is the equation for photon energy?', back: '**E = hf**' },
    { deck_id: deck.id, front: 'What is 1 eV in joules?', back: '**1.60 × 10⁻¹⁹ J**' }
  ])

  if (only !== 'pdf') {
    await step('make_questions (all 8 types via Learn)', async () => {
      const items = QUESTION_TYPES.map((t, i) => {
        const c = t === 'fill_blank' ? cards[2] : t === 'choice_blank' ? cards[0] : cards[i % cards.length]
        return { type: t, card_id: c.id, card_ids: t === 'match_pairs' || t === 'categorize' ? cards.map((x) => x.id) : [c.id] }
      })
      const qs = await learn.buildQuestions(deck.id, items, { noCache: true })
      writeFileSync(join(outDir, 'learn-questions.json'), JSON.stringify(qs, null, 2))
      const fallback = qs.filter((q, i) => q.type !== items[i].type)
      if (fallback.length) throw new Error(`fell back for ${fallback.map((q) => q.type).join(', ')}`)
      return qs.map((q) => q.type).join(', ')
    })
    await step('mark_free_answer', async () => {
      const r = await learn.markAnswer(deck.id, { id: 'q', type: 'free_answer', card_id: cards[1].id, card_ids: [cards[1].id], cached: false, payload: { question: cards[1].front, expected_answer: cards[1].back } }, { type: 'free_answer', text: 'the photons dont have enough energy' })
      return JSON.stringify(r)
    })
    await step('mark_fill_blank (AI path)', async () => {
      const q = { id: 'q', type: 'fill_blank' as const, card_id: cards[2].id, card_ids: [cards[2].id], cached: false, payload: { prompt: '', segments: [{ type: 'text' as const, value: 'Each electron can only absorb ' }, { type: 'blank' as const, value: 'one photon of energy' }], answers: ['one photon of energy'] } }
      return JSON.stringify(await learn.markAnswer(deck.id, q, { type: 'fill_blank', values: ['a single photon'] }))
    })
    const attempt = await learn.submitAnswer(null, deck.id, { id: 'q', type: 'true_false', card_id: cards[3].id, card_ids: [cards[3].id], cached: false, payload: { statement: 'Increasing intensity increases the maximum kinetic energy of photoelectrons', is_true: false, correction: 'it increases the number of electrons' } }, { type: 'true_false', value: true })
    await step('feedback_wrong', async () => JSON.stringify(await learn.feedbackFor(attempt.attemptId)))
    const right = await learn.submitAnswer(null, deck.id, { id: 'q2', type: 'multiple_choice', card_id: cards[4].id, card_ids: [cards[4].id], cached: false, payload: { question: 'Photon energy?', options: ['E = hf', 'E = mc', 'E = hλ', 'E = f/h'], correct_index: 0 } }, { type: 'multiple_choice', index: 0 })
    await step('feedback_right', async () => JSON.stringify(await learn.feedbackFor(right.attemptId)))
    await step('hint', async () => (await learn.hintFor(cards[0].id, { id: 'q', type: 'free_answer', card_id: cards[0].id, card_ids: [cards[0].id], cached: false, payload: { question: cards[0].front, expected_answer: cards[0].back } }, 0, [])).hint)
    await step('fix_cards', async () => JSON.stringify(await gen.fixCard({ front: 'Describe photoemission (3)', back: '- photon absorbed\n\n- electron escapes', problem: 'Question says (3) but the answer has 2 bullets' })))
    let explanationId = ''
    await step('explain (stream)', async () => {
      let n = 0
      const r = await explain.explain({ cardId: cards[1].id }, 'diagram', null, () => n++)
      explanationId = r.explanationId
      return `${n} chunks, mermaid=${r.text.includes('```mermaid')} · ${r.text}`
    })
    await step('explain_chat', async () => (await explain.chat(explanationId, 'So why does brightness not help?', () => {})).text)
    for (const kind of ['simplify', 'shorten', 'fix_formatting', 'expand'] as const) {
      await step(`note_${kind}`, async () => explain.noteAction(kind, '## Work function:\n**Work function:**\n- the minimum energy needed to remove an electron from a metal surface, measured in eV or J\n- depends on the metal', null, () => {}))
    }
    const actions = listActions()
    await step('custom_action (markdown)', async () => {
      const r = await explain.runAction(actions[0].id, { cardId: cards[0].id }, () => {})
      return r.kind === 'markdown' ? r.text : 'cards?'
    })
    await step('make_categorize', async () => {
      const r = await runAI<{ categories: string[]; items: unknown[] }>({ task: 'make_categorize', deckId: deck.id, vars: { cards: JSON.stringify(cards.map((c) => ({ card_id: c.id, front: c.front, back: c.back }))) } })
      return `${r.data.categories.join(' / ')} · ${r.data.items.length} items`
    })
    await step('generate_cards (Standard cards, json, MC)', async () => {
      const r = await gen.generateCards(
        { sources: { files: [], topic: '', text: 'The work function is the minimum energy needed to remove an electron from a metal. E = hf. 1 eV = 1.6e-19 J.', noteIds: [] }, presetId: getPresetByKey('cards.standard')!.id, format: 'question_answer', cardType: 'multiple_choice', language: '', instructions: '', count: 3 },
        ctx('json cards')
      )
      return `${r.cards.length} cards, ${r.cards.filter((c) => c.kind === 'multiple_choice').length} multiple choice`
    })
  }

  if (only !== 'tasks') {
    const pdf = resolve('tests/fixtures/photoelectric-lecture.pdf')
    await step('generate_notes from 12-page PDF (My notes, 2 chunks)', async () => {
      const r = await gen.generateNotes({ sources: { files: [pdf], topic: '', text: '', noteIds: [] }, title: 'The photoelectric effect', module: 'PHYS201', type: 'Lecture', week: '4', length: 'medium', level: '', instructions: '' }, ctx('notes'))
      const note = repo.getNote(r.noteId)
      writeFileSync(join(outDir, 'notes.md'), note.content)
      const imageFacts = ['gradient', 'intercept', 'microammeter', '-13.6'].filter((k) => note.content.toLowerCase().includes(k.toLowerCase()))
      return `${note.content.length} chars, ${note.content.split('\n').filter((l) => l.startsWith('## ')).length} sections, facts from images: ${imageFacts.join(', ') || 'none'}`
    })
    await step('generate_cards from 12-page PDF (Exam style, studysmarter_text)', async () => {
      const r = await gen.generateCards({ sources: { files: [pdf], topic: '', text: '', noteIds: [] }, format: 'question_answer', cardType: 'regular', language: '', instructions: '', count: null }, ctx('cards'))
      writeFileSync(join(outDir, 'cards.txt'), r.cards.map((c) => `${c.front}/#*#/${c.back}`).join('\n#\n'))
      writeFileSync(join(outDir, 'cards-warnings.json'), JSON.stringify(r.warnings, null, 2))
      const all = r.cards.map((c) => `${c.front} ${c.back}`.toLowerCase()).join('\n')
      const imageFacts = ['gradient', 'intercept', 'microammeter', '13.6'].filter((k) => all.includes(k))
      return `${r.cards.length} cards in ${r.rounds} round(s), ${r.warnings.length} warnings, ${r.cards.filter((c) => c.kind === 'cloze').length} cloze, facts from images: ${imageFacts.join(', ') || 'none'}`
    })
  }

  const calls = repo.listAiCalls(500)
  console.log(`\n\nai_calls: ${calls.length} (${calls.filter((c) => !c.ok).length} failed). Output in ${outDir}`)
  closeDb()
  rmSync(dir, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
}

void main()
