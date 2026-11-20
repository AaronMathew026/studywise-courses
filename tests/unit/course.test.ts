import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  sanitizeQuestion,
  parseBlanks,
  markCourseAnswer,
  pageList,
  mergeOutlines,
  wordTokens,
  type CourseQuestion,
  type CourseOutline
} from '@shared/course'

const extra = { hint: '', why: '' }

describe('course questions', () => {
  it('parses blanks with alternatives', () => {
    const b = parseBlanks('Passing tests is [[evidence|support]] of correctness, not [[proof]].')
    expect(b.answers).toEqual(['evidence', 'proof'])
    expect(b.alternatives[0]).toEqual(['evidence', 'support'])
    expect(b.segments.filter((s) => s.type === 'blank')).toHaveLength(2)
  })

  it('accepts alternative answers in fill_blank', () => {
    const q: CourseQuestion = { type: 'fill_blank', text: 'Passing tests is [[evidence|support]] of correctness, not [[proof]].', ...extra }
    expect(markCourseAnswer(q, { type: 'fill_blank', values: ['Support', 'proofs'] })?.verdict).toBe('correct')
    expect(markCourseAnswer(q, { type: 'fill_blank', values: ['evidence', 'truth'] })?.verdict).toBe('wrong')
  })

  it('drops wrong_word questions whose word is missing or repeated', () => {
    const base = { type: 'wrong_word' as const, correct: 'lowest', ...extra }
    expect(sanitizeQuestion({ ...base, text: 'The threshold is the highest frequency.', wrong: 'highest' })).not.toBeNull()
    expect(sanitizeQuestion({ ...base, text: 'The highest is the highest frequency.', wrong: 'highest' })).toBeNull()
    expect(sanitizeQuestion({ ...base, text: 'The threshold is the top frequency.', wrong: 'highest' })).toBeNull()
  })

  it('marks wrong_word by the tapped word, ignoring punctuation', () => {
    const q: CourseQuestion = { type: 'wrong_word', text: 'Electrons leave after a delay.', wrong: 'delay', correct: 'instant', ...extra }
    const idx = wordTokens(q.text).findIndex((t) => t.startsWith('delay'))
    expect(markCourseAnswer(q, { type: 'wrong_word', index: idx })?.verdict).toBe('correct')
    expect(markCourseAnswer(q, { type: 'wrong_word', index: 0 })?.verdict).toBe('wrong')
  })

  it('marks order by position, only correct when all are right', () => {
    const q: CourseQuestion = { type: 'order', q: 'Order', items: ['a', 'b', 'c', 'd'], ...extra }
    expect(markCourseAnswer(q, { type: 'order', order: [0, 1, 2, 3] })?.verdict).toBe('correct')
    const m = markCourseAnswer(q, { type: 'order', order: [0, 1, 3, 2] })!
    expect(m.verdict).not.toBe('correct')
    expect(m.detail?.wrongItems).toEqual([2, 3])
  })

  it('marks mcq, true_false, match and sort through the Learn marker', () => {
    expect(markCourseAnswer({ type: 'mcq', q: 'q', options: ['a', 'b', 'c', 'd'], answer: 2, ...extra }, { type: 'multiple_choice', index: 2 })?.verdict).toBe('correct')
    expect(markCourseAnswer({ type: 'true_false', q: 's', answer: false, ...extra }, { type: 'true_false', value: true })?.verdict).toBe('wrong')
    const match: CourseQuestion = { type: 'match', q: 'm', pairs: [{ term: 'a', meaning: '1' }, { term: 'b', meaning: '2' }, { term: 'c', meaning: '3' }], ...extra }
    expect(markCourseAnswer(match, { type: 'match_pairs', mapping: { 0: 0, 1: 1, 2: 2 } })?.verdict).toBe('correct')
    const sort: CourseQuestion = { type: 'sort', q: 's', buckets: ['Wave', 'Particle'], items: [{ item: 'x', bucket: 'wave' }, { item: 'y', bucket: 'Particle' }, { item: 'z', bucket: 'Wave' }], ...extra }
    expect(markCourseAnswer(sanitizeQuestion(sort)!, { type: 'categorize', assignments: { 0: 'Wave', 1: 'Particle', 2: 'Wave' } })?.verdict).toBe('correct')
  })

  it('reads page ranges and ignores timestamps', () => {
    expect(pageList('slides 4–7', 20)).toEqual([4, 5, 6, 7])
    expect(pageList('pp. 3-4, 9', 20)).toEqual([3, 4, 9])
    expect(pageList('pages 18–25', 20)).toEqual([18, 19, 20])
    expect(pageList('12:30–31:00', 20)).toEqual([])
  })

  it('merges per-file outlines by title and renumbers ids', () => {
    const t = (id: string, title: string, needs: string[] = []) => ({ id, title, goal: '', sections: [title], sources: [], needs, stressed: [], minutes: 10 })
    const a: CourseOutline = { course: 'C', topics: [t('t1', 'Intro'), t('t2', 'Testing', ['t1'])] }
    const b: CourseOutline = { course: '', topics: [t('t1', 'testing'), t('t2', 'Refactoring', ['t1'])] }
    const m = mergeOutlines([a, b])
    expect(m.topics.map((x) => [x.id, x.title])).toEqual([
      ['t1', 'Intro'],
      ['t2', 'Testing'],
      ['t3', 'Refactoring']
    ])
    // b's t1 was "testing", which became t2.
    expect(m.topics[2].needs).toEqual(['t2'])
    expect(m.topics[1].needs).toEqual(['t1'])
  })
})

// ---------------------------------------------------------------------------
// The whole flow with mock AI: plan, write, figures, recall, marking.

let dir: string
let svc: typeof import('../../src/main/services/course')
let closeDb: () => void

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sw-course-'))
  process.env.STUDYWISE_DATA_DIR = dir
  const db = await import('../../src/main/db')
  closeDb = db.closeDb
  db.openDb(join(dir, 't.db'))
  const { seedPresets } = await import('../../src/main/ai/presets')
  seedPresets()
  svc = await import('../../src/main/services/course')
})
afterAll(() => {
  closeDb?.()
  rmSync(dir, { recursive: true, force: true })
})

const ctx = () => ({ signal: new AbortController().signal, progress: () => {}, delta: () => {}, meta: () => {} })

describe('course service (mock AI)', () => {
  it('plans, writes a topic, renders its figure and serves recall cards', async () => {
    expect(process.env.AI_MOCK).toBe('1')
    const transcript = join(dir, 'transcript.txt')
    writeFileSync(transcript, 'So, the photoelectric effect. This is important, it will come up. Electrons come out instantly.')
    const course = svc.createCourse({ name: 'Quantum 101', level: 'first-year physics' })
    const w1 = svc.addWeek(course.id)
    expect(w1.label).toBe('Week 1')
    await expect(svc.planWeek(w1.id, ctx())).rejects.toThrow(/Add files/)
    await svc.addFiles(w1.id, [resolve('tests/fixtures/photoelectric-lecture.pdf'), transcript])
    expect(svc.listFiles(course.id).map((f) => [f.name, f.pages])).toEqual([
      ['photoelectric-lecture.pdf', 12],
      ['transcript.txt', null]
    ])

    expect(await svc.planWeek(w1.id, ctx())).toEqual({ topics: 3 })
    const topics = svc.listTopics(course.id)
    expect(topics.map((t) => [t.key, t.status])).toEqual([
      ['w1t1', 'planned'],
      ['w1t2', 'planned'],
      ['w1t3', 'planned']
    ])
    expect(topics[1].plan.needs).toEqual(['w1t1'])

    // Week 2 has its own files; its keys don't clash and it lists after week 1.
    const w2 = svc.addWeek(course.id, 'Week 2: more')
    await svc.addFiles(w2.id, [resolve('tests/fixtures/photoelectric-lecture.pdf')])
    expect(svc.listFiles(course.id).map((f) => f.name)).toEqual(['photoelectric-lecture.pdf', 'transcript.txt', 'photoelectric-lecture (2).pdf'])
    await svc.planWeek(w2.id, ctx())
    const all = svc.listTopics(course.id)
    expect(all.map((t) => t.key)).toEqual(['w1t1', 'w1t2', 'w1t3', 'w2t1', 'w2t2', 'w2t3'])
    expect(svc.getCourse(course.id).weeks.map((w) => [w.label, w.topics.length, w.files.length])).toEqual([
      ['Week 1', 3, 2],
      ['Week 2: more', 3, 1]
    ])

    // Topic 2 uses pages 5–8, so page 2 of the excerpt is page 6 of the PDF.
    const r = await svc.writeTopic(topics[1].id, ctx())
    expect(r.cards).toBe(4)
    const t2 = svc.getTopic(topics[1].id)
    expect(t2.status).toBe('ready')
    expect(t2.card_count).toBe(4)
    const fig = t2.content!.sections.find((s) => s.figure)!.figure!
    expect(fig.page).toBe(6)
    const url = await svc.figureUrl(fig.fileId, fig.page)
    expect(url).toMatch(/^studywise-file:\/\/courses\/.+\.png$/)
    expect(existsSync(join(dir, 'courses', course.id, 'figures', `${fig.fileId}-p6.png`))).toBe(true)

    // Every question survived sanitising, all eight types.
    const types = new Set(t2.content!.sections.flatMap((s) => s.questions.map((q) => q.type)))
    expect(types.size).toBe(8)

    // No recall until another topic has been started.
    await svc.writeTopic(topics[0].id, ctx())
    expect(svc.recallCard(course.id, topics[0].id)).toBeNull()
    svc.saveProgress(topics[1].id, { ...t2.progress, section: 1 })
    const rc = svc.recallCard(course.id, topics[0].id)
    expect(rc?.topicTitle).toBe(t2.content!.title)
    svc.recallReview(rc!.card.id, true)

    // Rewriting replaces the topic's cards rather than adding more.
    await svc.writeTopic(topics[1].id, ctx())
    expect(svc.getTopic(topics[1].id).card_count).toBe(4)

    const explainQ = t2.content!.sections[2].questions.find((q) => q.type === 'explain')!
    if (explainQ.type !== 'explain') throw new Error('expected explain')
    const good = await svc.markExplain(course.id, explainQ, 'Each photon has too little energy and one photon frees one electron, more photons does not help')
    expect(good.mark.verdict).toBe('correct')
    const empty = await svc.markExplain(course.id, explainQ, '  ')
    expect(empty.mark.score).toBe(0)

    const noteId = svc.topicAsNote(topics[1].id)
    expect(noteId).toBeTruthy()

    // Recall reaches back into earlier weeks.
    const w2t1 = all[3]
    await svc.writeTopic(w2t1.id, ctx())
    svc.saveProgress(topics[0].id, { ...svc.getTopic(topics[0].id).progress, section: 2 })
    expect(svc.recallCard(course.id, w2t1.id)?.topicTitle).toBe(svc.getTopic(topics[0].id).content!.title)

    // Deleting a week takes its topics and their cards with it.
    const deckId = svc.getCourse(course.id).deck_id!
    const { listCards } = await import('../../src/main/db/repo')
    const before = listCards(deckId).length
    svc.deleteWeek(w2.id)
    expect(svc.listTopics(course.id)).toHaveLength(3)
    expect(listCards(deckId).length).toBe(before - 4)
    expect(svc.listFiles(course.id)).toHaveLength(2)

    svc.deleteCourse(course.id, false)
    expect(svc.listCourses()).toHaveLength(0)
  }, 60_000)
})
