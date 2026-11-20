import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { getDb, uid, now, json } from '../db'
import * as repo from '../db/repo'
import { runAI } from '../ai'
import { paths } from '../paths'
import { extractText, pdfPageCount } from '../files'
import type { JobContext } from '../jobs'
import { thresholdsFor } from './learn'
import { planTracker, topicTracker } from './liveProgress'
import { verdictFor } from '@shared/marking'
import { isDue } from '@shared/sm2'
import type { Mark } from '@shared/questions'
import type { Card, ReviewState } from '@shared/types'
import {
  emptyProgress,
  mergeOutlines,
  pageList,
  sanitizeQuestions,
  type AiTopic,
  type Course,
  type CourseFile,
  type CourseFull,
  type CourseMarkOut,
  type CourseOutline,
  type CourseQuestion,
  type CourseSummary,
  type Figure,
  type OutlineTopic,
  type Topic,
  type TopicContent,
  type TopicProgress,
  type Week,
  type WeekFull
} from '@shared/course'

// A course is a run of weeks. Each week has its own files; its topics are
// planned from those files only, knowing what earlier weeks already cover.

export const COURSE_SOURCE_EXT = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown', '.vtt', '.srt']

/** Above this much text, a week is planned one file at a time and merged. */
const ONE_CALL_CHARS = 300_000
/** Attach a whole PDF to a topic call up to this many pages; beyond it we need page ranges. */
const WHOLE_PDF_PAGES = 40

// ---------------------------------------------------------------------------
// Rows

type CourseRow = Course & { note_folder_id?: string | null }
type WeekRow = Week & { outline: string | null }
type TopicRow = { id: string; course_id: string; week_id: string; key: string; position: number; plan: string; status: string; error: string | null; content: string | null; progress: string; updated_at: string; note_id: string | null }

function cardCounts(deckId: string | null): Map<string, number> {
  const m = new Map<string, number>()
  if (!deckId) return m
  const rows = getDb()
    .prepare("SELECT json_extract(source, '$.ref') ref, COUNT(*) n FROM cards WHERE deck_id = ? AND json_extract(source, '$.type') = 'topic' GROUP BY ref")
    .all(deckId) as { ref: string; n: number }[]
  for (const r of rows) m.set(r.ref, r.n)
  return m
}

const toTopic = (r: TopicRow, counts: Map<string, number>): Topic => ({
  id: r.id,
  course_id: r.course_id,
  week_id: r.week_id,
  key: r.key,
  position: r.position,
  plan: json(r.plan, {} as OutlineTopic),
  status: r.status as Topic['status'],
  error: r.error,
  content: json<TopicContent | null>(r.content, null),
  progress: { ...emptyProgress(), ...json<Partial<TopicProgress>>(r.progress, {}) },
  card_count: counts.get(r.id) ?? 0,
  note_id: r.note_id ?? null,
  updated_at: r.updated_at
})

const toWeek = ({ outline: _o, ...w }: WeekRow): Week => w

function courseRow(id: string): CourseRow {
  const r = getDb().prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined
  if (!r) throw new Error('Course not found')
  return r
}

function weekRow(id: string): WeekRow {
  const r = getDb().prepare('SELECT * FROM weeks WHERE id = ?').get(id) as WeekRow | undefined
  if (!r) throw new Error('Week not found')
  return r
}

export function getCourse(id: string): CourseFull {
  const { note_folder_id: _f, ...c } = courseRow(id)
  const files = listFiles(id)
  const topics = listTopics(id)
  const weeks = (getDb().prepare('SELECT * FROM weeks WHERE course_id = ? ORDER BY position').all(id) as WeekRow[]).map(
    (w): WeekFull => ({ ...toWeek(w), files: files.filter((f) => f.week_id === w.id), topics: topics.filter((t) => t.week_id === w.id) })
  )
  return { ...c, weeks }
}

export function listCourses(): CourseSummary[] {
  const rows = getDb().prepare('SELECT * FROM courses ORDER BY updated_at DESC').all() as CourseRow[]
  return rows.map((r) => {
    const topics = getDb().prepare('SELECT status, progress FROM topics WHERE course_id = ?').all(r.id) as { status: string; progress: string }[]
    const weeks = getDb().prepare('SELECT status FROM weeks WHERE course_id = ?').all(r.id) as { status: string }[]
    let due = 0
    if (r.deck_id) {
      try {
        due = repo.dueCards(r.deck_id).length
      } catch {
        due = 0
      }
    }
    const { note_folder_id: _f, ...course } = r
    return {
      ...course,
      week_count: weeks.length,
      planning: weeks.some((w) => w.status === 'planning'),
      topic_count: topics.length,
      ready_count: topics.filter((t) => t.status === 'ready').length,
      done_count: topics.filter((t) => json<Partial<TopicProgress>>(t.progress, {}).done).length,
      due_count: due
    }
  })
}

export function listFiles(courseId: string): CourseFile[] {
  return getDb()
    .prepare('SELECT f.id, f.course_id, f.week_id, f.name, f.path, f.pages FROM course_files f JOIN weeks w ON w.id = f.week_id WHERE f.course_id = ? ORDER BY w.position, f.position')
    .all(courseId) as CourseFile[]
}

/** All topics of a course, in teaching order (week, then position). */
export function listTopics(courseId: string): Topic[] {
  const r = courseRow(courseId)
  const counts = cardCounts(r.deck_id)
  return (getDb().prepare('SELECT t.* FROM topics t JOIN weeks w ON w.id = t.week_id WHERE t.course_id = ? ORDER BY w.position, t.position').all(courseId) as TopicRow[]).map((t) =>
    toTopic(t, counts)
  )
}

export function getTopic(id: string): Topic {
  const r = getDb().prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined
  if (!r) throw new Error('Topic not found')
  return toTopic(r, cardCounts(courseRow(r.course_id).deck_id))
}

function touchCourse(id: string): void {
  getDb().prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now(), id)
}

function setWeek(id: string, patch: { status?: string; error?: string | null; outline?: string | null; label?: string }): void {
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`)
  if (sets.length) getDb().prepare(`UPDATE weeks SET ${sets.join(', ')} WHERE id = @id`).run({ ...patch, id })
}

function setTopic(id: string, patch: { status?: string; error?: string | null; content?: string | null; progress?: string }): void {
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`)
  getDb().prepare(`UPDATE topics SET ${[...sets, 'updated_at = @updated_at'].join(', ')} WHERE id = @id`).run({ ...patch, updated_at: now(), id })
}

/** After a crash or quit, nothing is still being written. */
export function recoverInterrupted(): void {
  const d = getDb()
  d.prepare("UPDATE topics SET status = 'error', error = 'Interrupted. Write it again.' WHERE status = 'writing'").run()
  d.prepare("UPDATE weeks SET status = 'error', error = 'Planning was interrupted. Plan it again.' WHERE status = 'planning'").run()
}

// ---------------------------------------------------------------------------
// Creating

function courseDir(courseId: string): string {
  return join(paths.courses, courseId)
}

function ensureDeck(courseId: string): string {
  const c = courseRow(courseId)
  if (c.deck_id) {
    try {
      repo.getDeck(c.deck_id)
      return c.deck_id
    } catch {
      /* deleted: make a new one */
    }
  }
  const deck = repo.createDeck({ name: c.name, description: 'Recall cards from the course' })
  getDb().prepare('UPDATE courses SET deck_id = ? WHERE id = ?').run(deck.id, courseId)
  return deck.id
}

export function createCourse(input: { name: string; level: string }): Course {
  const id = uid()
  const t = now()
  getDb().prepare('INSERT INTO courses (id, name, module, level, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(id, input.name, input.name, input.level, t, t)
  ensureDeck(id)
  return courseRow(id)
}

export function addWeek(courseId: string, label?: string): Week {
  courseRow(courseId)
  const n = (getDb().prepare('SELECT COUNT(*) n, COALESCE(MAX(position), -1) p FROM weeks WHERE course_id = ?').get(courseId) as { n: number; p: number })
  const id = uid()
  getDb()
    .prepare("INSERT INTO weeks (id, course_id, position, label, status, error, outline, created_at) VALUES (?, ?, ?, ?, 'empty', NULL, NULL, ?)")
    .run(id, courseId, n.p + 1, label?.trim() || `Week ${n.n + 1}`, now())
  touchCourse(courseId)
  return toWeek(weekRow(id))
}

export function getCourseIdForWeek(weekId: string): string {
  return weekRow(weekId).course_id
}

export function renameWeek(weekId: string, label: string): void {
  setWeek(weekId, { label })
}

/** Removes the week, its files, its topics and their recall cards. */
export function deleteWeek(weekId: string): void {
  const w = weekRow(weekId)
  const c = courseRow(w.course_id)
  const topicIds = (getDb().prepare('SELECT id FROM topics WHERE week_id = ?').all(weekId) as { id: string }[]).map((r) => r.id)
  if (c.deck_id) for (const t of topicIds) repo.deleteCards(topicCardIds(c.deck_id, t))
  for (const f of listFiles(w.course_id).filter((f) => f.week_id === weekId)) rmSync(f.path, { force: true })
  getDb().prepare('DELETE FROM weeks WHERE id = ?').run(weekId)
  touchCourse(w.course_id)
}

export async function addFiles(weekId: string, files: string[]): Promise<CourseFile[]> {
  const w = weekRow(weekId)
  const dir = join(courseDir(w.course_id), 'files')
  mkdirSync(dir, { recursive: true })
  const all = listFiles(w.course_id)
  const taken = new Set(all.map((f) => f.name.toLowerCase()))
  let pos = all.filter((f) => f.week_id === weekId).length
  const ins = getDb().prepare('INSERT INTO course_files (id, course_id, week_id, name, path, pages, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const f of files) {
    if (!COURSE_SOURCE_EXT.includes(extname(f).toLowerCase())) continue
    let name = basename(f)
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${basename(f, extname(f))} (${n})${extname(f)}`
    taken.add(name.toLowerCase())
    const dest = join(dir, name)
    copyFileSync(f, dest)
    const pages = extname(f).toLowerCase() === '.pdf' ? await pdfPageCount(dest).catch(() => null) : null
    ins.run(uid(), w.course_id, weekId, name, dest, pages, pos++)
  }
  touchCourse(w.course_id)
  return listFiles(w.course_id).filter((f) => f.week_id === weekId)
}

export function removeFile(fileId: string): void {
  const f = getDb().prepare('SELECT path FROM course_files WHERE id = ?').get(fileId) as { path: string } | undefined
  if (!f) return
  getDb().prepare('DELETE FROM course_files WHERE id = ?').run(fileId)
  rmSync(f.path, { force: true })
}

export function deleteCourse(id: string, keepDeck: boolean): void {
  const c = courseRow(id)
  getDb().prepare('DELETE FROM courses WHERE id = ?').run(id)
  if (!keepDeck && c.deck_id) repo.deleteDeck(c.deck_id)
  rmSync(courseDir(id), { recursive: true, force: true })
}

export function renameCourse(id: string, name: string): void {
  getDb().prepare('UPDATE courses SET name = ?, module = ?, updated_at = ? WHERE id = ?').run(name, name, now(), id)
  const f = courseRow(id).note_folder_id
  if (f) repo.renameFolder(f, name)
}

// ---------------------------------------------------------------------------
// Reading sources

async function pdfPagesText(file: string): Promise<{ num: number; text: string }[]> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: readFileSync(file) })
  try {
    return (await parser.getText()).pages.map((p) => ({ num: p.num, text: p.text }))
  } finally {
    await parser.destroy()
  }
}

/** Text of a file for the prompt; PDFs get [page N] markers. Null for a PDF with no text layer. */
async function fileText(f: CourseFile): Promise<string | null> {
  if (extname(f.name).toLowerCase() === '.pdf') {
    const pages = await pdfPagesText(f.path)
    const chars = pages.reduce((n, p) => n + p.text.trim().length, 0)
    if (chars < pages.length * 20) return null // scanned slides: send the file instead
    return pages.map((p) => `[page ${p.num}]\n${p.text.trim()}`).join('\n\n')
  }
  return extractText(f.path)
}

const fileBlock = (name: string, body: string, where = '') => `<file name="${name}"${where ? ` part="${where.replace(/"/g, "'")}"` : ''}>\n${body}\n</file>`

// ---------------------------------------------------------------------------
// 1. Plan a week's topics

const weekNo = (w: Week) => w.position + 1
const keyFor = (w: Week, localId: string) => `w${weekNo(w)}${localId}` // t3 in week 2 → w2t3

export async function planWeek(weekId: string, ctx: JobContext, instructions = ''): Promise<{ topics: number }> {
  const week = toWeek(weekRow(weekId))
  const course = courseRow(week.course_id)
  ctx.meta({ weekId, courseId: course.id })
  if ((getDb().prepare("SELECT 1 FROM topics WHERE week_id = ? AND status = 'writing'").get(weekId))) throw new Error('Wait for this week’s topics to finish writing first.')
  const files = listFiles(course.id).filter((f) => f.week_id === weekId)
  if (!files.length) throw new Error(`Add files to ${week.label} first.`)
  setWeek(weekId, { status: 'planning', error: null })
  const live = ctx.live ?? (() => {})
  try {
    ctx.progress('Reading the files…')
    live({ stage: 'Reading the files…', percent: 0.02 })
    const texts: { file: CourseFile; text: string | null }[] = []
    for (const f of files) texts.push({ file: f, text: await fileText(f).catch(() => null) })
    const describe = (list: typeof texts) => list.map(({ file }) => `${file.name}${file.pages ? ` (${file.pages} pages)` : ''}`).join(', ')
    const baseVars = { module: course.module || course.name, level: course.level, instructions }
    const total = texts.reduce((n, t) => n + (t.text?.length ?? 0), 0)

    // What earlier weeks already teach, so this week doesn't repeat it.
    const earlier = listTopics(course.id).filter((t) => {
      const w = weekRow(t.week_id)
      return w.position < week.position
    })
    const earlierNote = earlier.length
      ? `This is ${week.label} of the course. Earlier weeks already have these topics:\n${earlier.map((t) => `- ${t.key}: ${t.content?.title ?? t.plan.title}`).join('\n')}\nDon't plan topics for what they already cover, unless this week takes it further. When a topic builds on one of them, put its id (like ${earlier[0].key}) in "needs". Number this week's own topics t1, t2, …`
      : ''

    live({ stage: 'Sending them to Claude…', percent: 0.08, log: files.map((f) => `Read ${f.name}`) })
    const callFor = async (list: typeof texts, partInfo: string, from = 0.1, to = 0.95): Promise<CourseOutline> => {
      // PDFs without a text layer go in as files so Claude can look at the slides.
      const attach = list.filter((t) => t.text === null && t.file.name.toLowerCase().endsWith('.pdf')).map((t) => t.file.path)
      const source = list.filter((t) => t.text !== null).map((t) => fileBlock(t.file.name, t.text!.slice(0, ONE_CALL_CHARS))).join('\n\n')
      const r = await runAI<CourseOutline>({
        task: 'course_outline',
        vars: { ...baseVars, files: describe(list), source_text: source, part_info: [earlierNote, partInfo].filter(Boolean).join('\n\n') },
        files: attach.length ? attach : undefined,
        deckId: course.deck_id,
        signal: ctx.signal
      })
      return r.data
    }

    const known = earlier.map((t) => t.key)
    let outline: CourseOutline
    if (total <= ONE_CALL_CHARS || texts.length === 1) {
      ctx.progress(`Planning ${week.label} from ${files.length} file${files.length === 1 ? '' : 's'}…`)
      outline = mergeOutlines([await callFor(texts, '')], known)
    } else {
      // Too much for one call: plan file by file, telling each call what's already planned.
      const parts: CourseOutline[] = []
      for (const [i, t] of texts.entries()) {
        ctx.progress(`Planning file ${i + 1} of ${texts.length} (${t.file.name})…`)
        const sofar = parts.length ? mergeOutlines(parts, known) : null
        const note = [
          `This is file ${i + 1} of ${texts.length} for ${week.label} (all files: ${describe(texts)}). Plan only the topics in this file.`,
          sofar
            ? `Topics already planned from this week's earlier files:\n${sofar.topics.map((x) => `- ${x.id}: ${x.title}`).join('\n')}\nIf this file continues one of those, use exactly the same title so they can be merged.`
            : ''
        ]
          .filter(Boolean)
          .join('\n')
        parts.push(await callFor([t], note, 0.1 + (0.85 * i) / texts.length, 0.1 + (0.85 * (i + 1)) / texts.length))
      }
      outline = mergeOutlines(parts, known)
    }
    if (!outline.topics.length) throw new Error('Claude didn’t find any topics in these files.')

    // Week-local ids (t1…) become course-wide keys (w2t1…).
    const rekey = (id: string) => (/^t\d+$/.test(id) ? keyFor(week, id) : id)
    const topics = outline.topics.map((t) => ({ ...t, id: rekey(t.id), needs: t.needs.map(rekey) }))

    const d = getDb()
    d.transaction(() => {
      // Re-planning replaces this week's topics. Their recall cards stay in the deck.
      d.prepare('DELETE FROM topics WHERE week_id = ?').run(weekId)
      const ins = d.prepare("INSERT INTO topics (id, course_id, week_id, key, position, plan, status, error, content, progress, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'planned', NULL, NULL, '{}', ?)")
      topics.forEach((t, i) => ins.run(uid(), course.id, weekId, t.id, i, JSON.stringify(t), now()))
    })()
    setWeek(weekId, { status: 'ready', error: null, outline: JSON.stringify({ ...outline, topics }) })
    touchCourse(course.id)
    return { topics: topics.length }
  } catch (e) {
    setWeek(weekId, { status: 'error', error: ctx.signal.aborted ? 'Cancelled' : (e as Error).message })
    throw e
  }
}

// ---------------------------------------------------------------------------
// 2. Write a topic

interface Attached {
  name: string
  fileId: string
  /** Original page number for each page of the attached PDF. */
  pages: number[]
}

function findFile(files: CourseFile[], name: string): CourseFile | undefined {
  const n = name.trim().toLowerCase()
  const stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '')
  return files.find((f) => f.name.toLowerCase() === n) ?? files.find((f) => stem(f.name) === stem(n)) ?? files.find((f) => stem(f.name).includes(stem(n)) || stem(n).includes(stem(f.name)))
}

async function pdfExcerpt(f: CourseFile, pages: number[], dir: string): Promise<string> {
  const src = await PDFDocument.load(readFileSync(f.path), { ignoreEncryption: true, updateMetadata: false })
  const doc = await PDFDocument.create()
  const copied = await doc.copyPages(src, pages.map((p) => p - 1))
  copied.forEach((p) => doc.addPage(p))
  const contiguous = pages.every((p, i) => i === 0 || p === pages[i - 1] + 1)
  const stem = basename(f.name, extname(f.name)).replace(/[^\w.-]+/g, '_')
  const out = join(dir, `${stem}_pages_${contiguous ? `${pages[0]}-${pages[pages.length - 1]}` : 'selected'}.pdf`)
  writeFileSync(out, await doc.save())
  return out
}

/** What to send for one topic: only its own week's sources, cut to the pages it uses. */
async function topicSources(files: CourseFile[], plan: OutlineTopic, work: string): Promise<{ attach: string[]; attached: Attached[]; text: string; notes: string[] }> {
  const byFile = new Map<string, { file: CourseFile; where: string[] }>()
  for (const s of plan.sources ?? []) {
    const f = findFile(files, s.file)
    if (!f) continue
    const cur = byFile.get(f.id) ?? { file: f, where: [] }
    if (s.where) cur.where.push(s.where)
    byFile.set(f.id, cur)
  }
  // The outline named nothing we recognise: fall back to the whole week.
  if (byFile.size === 0) for (const f of files) byFile.set(f.id, { file: f, where: [] })

  const attach: string[] = []
  const attached: Attached[] = []
  const blocks: string[] = []
  const notes: string[] = []
  for (const { file, where } of byFile.values()) {
    const isPdf = extname(file.name).toLowerCase() === '.pdf'
    if (isPdf && file.pages) {
      const pages = [...new Set(where.flatMap((w) => pageList(w, file.pages!)))].sort((a, b) => a - b)
      if (!pages.length && file.pages <= WHOLE_PDF_PAGES) {
        attach.push(file.path)
        attached.push({ name: file.name, fileId: file.id, pages: Array.from({ length: file.pages }, (_, i) => i + 1) })
        continue
      }
      if (pages.length) {
        const out = await pdfExcerpt(file, pages, work)
        attach.push(out)
        attached.push({ name: basename(out), fileId: file.id, pages })
        const gaps = pages.length !== pages[pages.length - 1] - pages[0] + 1
        notes.push(`${basename(out)} is pages ${pages[0]}–${pages[pages.length - 1]} of ${file.name}${gaps ? ` (pages ${pages.join(', ')})` : ''}.`)
        continue
      }
      // Long PDF with no usable page range: send the text instead.
    }
    const text = await fileText(file).catch(() => null)
    if (text) blocks.push(fileBlock(file.name, text, where.join('; ')))
    if (where.length && !isPdf) notes.push(`From ${file.name}, focus on: ${where.join('; ')}.`)
  }
  return { attach, attached, text: blocks.join('\n\n'), notes }
}

/** The whole course's plan, short, with this topic in full. */
function courseOutline(course: CourseRow, topic: Topic): string {
  const all = listTopics(course.id)
  const weeks = new Map((getDb().prepare('SELECT id, label FROM weeks WHERE course_id = ?').all(course.id) as { id: string; label: string }[]).map((w) => [w.id, w.label]))
  return JSON.stringify(
    {
      course: course.name,
      topics: all.map((t) => (t.id === topic.id ? { ...t.plan, week: weeks.get(t.week_id) } : { id: t.key, week: weeks.get(t.week_id), title: t.content?.title ?? t.plan.title, goal: t.plan.goal, sections: t.plan.sections }))
    },
    null,
    1
  )
}

function mapFigure(fig: AiTopic['sections'][number]['figure'], attached: Attached[]): Figure | null {
  if (!fig) return null
  const a = attached.find((x) => x.name.toLowerCase() === fig.file.trim().toLowerCase()) ?? (attached.length === 1 ? attached[0] : undefined)
  if (!a) return null
  const page = a.pages[fig.page - 1]
  return page ? { fileId: a.fileId, page, caption: fig.caption } : null
}

function topicCardIds(deckId: string, topicId: string): string[] {
  return (getDb().prepare("SELECT id FROM cards WHERE deck_id = ? AND json_extract(source, '$.type') = 'topic' AND json_extract(source, '$.ref') = ?").all(deckId, topicId) as { id: string }[]).map((r) => r.id)
}

export async function writeTopic(topicId: string, ctx: JobContext, instructions = ''): Promise<{ topicId: string; sections: number; cards: number }> {
  const topic = getTopic(topicId)
  const course = courseRow(topic.course_id)
  ctx.meta({ topicId, courseId: course.id })
  setTopic(topicId, { status: 'writing', error: null })
  const work = mkdtempSync(join(tmpdir(), 'studywise-topic-'))
  const live = ctx.live ?? (() => {})
  try {
    ctx.progress('Gathering this topic’s sources…')
    live({ stage: 'Picking out this topic’s pages…', percent: 0.02 })
    const weekFiles = listFiles(course.id).filter((f) => f.week_id === topic.week_id)
    const src = await topicSources(weekFiles, topic.plan, work)
    ctx.progress(`Writing ${topic.plan.title}…`)
    live({ stage: 'Sending them to Claude…', percent: 0.06, log: src.notes.length ? src.notes : ['Sending the week’s files'] })
    const r = await runAI<AiTopic>({
      task: 'course_topic',
      vars: {
        module: course.module || course.name,
        level: course.level,
        outline: courseOutline(course, topic),
        topic_id: topic.key,
        topic_title: topic.plan.title,
        source_text: src.text,
        part_info: src.notes.join('\n'),
        instructions
      },
      files: src.attach.length ? src.attach : undefined,
      deckId: course.deck_id,
      onEvent: topicTracker(live, topic.plan.sections.length, 0.08, 0.9),
      signal: ctx.signal
    })
    const ai = r.data
    live({ stage: 'Saving…', percent: 0.9, preview: null })
    const content: TopicContent = {
      title: ai.title || topic.plan.title,
      goal: ai.goal || topic.plan.goal,
      sections: ai.sections
        .filter((s) => s.heading.trim() || s.notes.trim())
        .map((s) => ({ heading: s.heading.trim(), notes: s.notes.trim(), figure: mapFigure(s.figure, src.attached), questions: sanitizeQuestions(s.questions) })),
      check: sanitizeQuestions(ai.check)
    }
    if (!content.sections.length) throw new Error('Claude returned a topic with no sections.')

    // Recall cards replace this topic's old ones.
    const deckId = ensureDeck(course.id)
    const old = topicCardIds(deckId, topicId)
    if (old.length) repo.deleteCards(old)
    const cards = repo.createCards(
      ai.cards
        .filter((c) => c.front.trim() && c.back.trim())
        .map((c) => ({ deck_id: deckId, format: 'question_answer' as const, front: c.front.trim(), back: c.back.trim(), tags: [content.title], source: { type: 'topic' as const, ref: topicId, section: content.title } }))
    )
    setTopic(topicId, { status: 'ready', error: null, content: JSON.stringify(content), progress: JSON.stringify(emptyProgress()) })
    touchCourse(course.id)

    const figs = content.sections.map((s) => s.figure).filter((f): f is Figure => !!f)
    if (figs.length) {
      ctx.progress('Rendering figures…')
      live({ stage: 'Rendering figures…', percent: 0.93 })
      for (const f of figs) await figureUrl(f.fileId, f.page).catch(() => null)
    }
    live({ stage: 'Saving the notes…', percent: 0.97 })
    const noteId = await syncTopicNote(topicId).catch(() => null)
    ctx.meta({ noteId })
    return { topicId, sections: content.sections.length, cards: cards.length }
  } catch (e) {
    setTopic(topicId, { status: 'error', error: ctx.signal.aborted ? 'Cancelled' : (e as Error).message })
    throw e
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Figures: the slide rendered from the PDF, cached as a PNG.

export async function figureUrl(fileId: string, page: number): Promise<string> {
  const f = getDb().prepare('SELECT id, course_id, week_id, name, path, pages FROM course_files WHERE id = ?').get(fileId) as CourseFile | undefined
  if (!f) throw new Error('That file is no longer in the course')
  if (!Number.isInteger(page) || page < 1 || (f.pages && page > f.pages)) throw new Error('No such page')
  const dir = join(courseDir(f.course_id), 'figures')
  const name = `${f.id}-p${page}.png`
  const out = join(dir, name)
  if (!existsSync(out)) {
    mkdirSync(dir, { recursive: true })
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: readFileSync(f.path) })
    try {
      const shot = await parser.getScreenshot({ partial: [page], desiredWidth: 1600, imageBuffer: true, imageDataUrl: false })
      const data = shot.pages[0]?.data
      if (!data) throw new Error('Could not render that page')
      writeFileSync(out, data)
    } finally {
      await parser.destroy()
    }
  }
  return `studywise-file://courses/${f.course_id}/figures/${name}`
}

// ---------------------------------------------------------------------------
// Learning

export function saveProgress(topicId: string, progress: TopicProgress): Topic {
  setTopic(topicId, { progress: JSON.stringify({ ...progress, lastStudied: now() }) })
  touchCourse(getTopic(topicId).course_id)
  return getTopic(topicId)
}

export function resetTopicProgress(topicId: string): Topic {
  setTopic(topicId, { progress: JSON.stringify(emptyProgress()) })
  return getTopic(topicId)
}

export async function markExplain(courseId: string, q: Extract<CourseQuestion, { type: 'explain' }>, answer: string): Promise<{ mark: Mark; wrong: string }> {
  const c = courseRow(courseId)
  if (!answer.trim()) return { mark: { score: 0, verdict: 'wrong', detail: { points_found: [], points_missing: q.points, short_feedback: 'Have a go first, even a rough answer gets marks.' }, by: 'code' }, wrong: '' }
  const r = await runAI<CourseMarkOut>({
    task: 'course_mark',
    vars: { module: c.module || c.name, level: c.level, question: q.q, model: q.model, points: q.points.map((p) => `- ${p}`).join('\n'), answer },
    deckId: c.deck_id
  })
  const m = r.data
  const score = Math.max(0, Math.min(10, m.score))
  return {
    mark: { score, verdict: verdictFor(score, thresholdsFor(c.deck_id)), detail: { points_found: m.got, points_missing: m.missed, short_feedback: m.feedback }, by: 'ai' },
    wrong: m.wrong
  }
}

/**
 * A surprise recall card from a different topic you've already started
 * (any week). Due or never-reviewed cards first.
 */
export function recallCard(courseId: string, excludeTopicId: string, exclude: string[] = []): { card: Card; topicTitle: string } | null {
  const c = courseRow(courseId)
  if (!c.deck_id) return null
  const started = listTopics(courseId).filter((t) => t.id !== excludeTopicId && t.status === 'ready' && (t.progress.section > 0 || t.progress.done))
  if (!started.length) return null
  const titles = new Map(started.map((t) => [t.id, t.content?.title ?? t.plan.title]))
  const cards = repo.listCards(c.deck_id).filter((card) => card.source?.type === 'topic' && card.source.ref && titles.has(card.source.ref) && !exclude.includes(card.id))
  if (!cards.length) return null
  const states = new Map((getDb().prepare('SELECT r.* FROM review_state r JOIN cards c ON c.id = r.card_id WHERE c.deck_id = ?').all(c.deck_id) as ReviewState[]).map((s) => [s.card_id, s]))
  const due = cards.filter((card) => isDue(states.get(card.id)))
  const pool = due.length ? due : cards
  const card = pool[Math.floor(Math.random() * pool.length)]
  return { card, topicTitle: titles.get(card.source!.ref!) ?? '' }
}

export function recallReview(cardId: string, knew: boolean): void {
  repo.applyReview(cardId, knew ? 3 : 1, 'learn')
}

function noteFolder(courseId: string): string {
  const c = courseRow(courseId)
  if (c.note_folder_id && repo.listFolders('note').some((f) => f.id === c.note_folder_id)) return c.note_folder_id
  const f = repo.createFolder(c.name, 'note')
  getDb().prepare('UPDATE courses SET note_folder_id = ? WHERE id = ?').run(f.id, courseId)
  return f.id
}

/**
 * The topic's notes as one note, in the course's notes folder, with its figures.
 * Made when the topic is written and updated when it's written again.
 */
export async function syncTopicNote(topicId: string): Promise<string> {
  const t = getTopic(topicId)
  if (!t.content) throw new Error('Write the topic first')
  const course = courseRow(t.course_id)
  const week = weekRow(t.week_id)
  const parts: string[] = []
  if (t.content.goal) parts.push(`_${t.content.goal}_`)
  for (const s of t.content.sections) {
    parts.push(`## ${s.heading}\n\n${s.notes}`)
    if (s.figure) {
      const url = await figureUrl(s.figure.fileId, s.figure.page).catch(() => null)
      if (url) parts.push(`![${s.figure.caption.replace(/[[\]]/g, '')}](${url})${s.figure.caption ? `\n_${s.figure.caption}_` : ''}`)
    }
  }
  // The notes list shows "Week <week>", so "Week 3" is stored as "3".
  const fields = { title: t.content.title, module: course.module || course.name, type: 'Lecture', week: week.label.replace(/^week\s+/i, ''), content: `${parts.join('\n\n')}\n` }
  let noteId = t.note_id
  if (noteId) {
    try {
      repo.updateNote(noteId, fields)
    } catch {
      noteId = null // deleted: make a new one
    }
  }
  if (!noteId) {
    noteId = repo.createNote({ ...fields, folder_id: noteFolder(course.id) }).id
    getDb().prepare('UPDATE topics SET note_id = ? WHERE id = ?').run(noteId, topicId)
  }
  if (course.deck_id) repo.linkNoteDeck(noteId, course.deck_id, true)
  return noteId
}

/** Topics written before notes were automatic get theirs now. */
export async function backfillNotes(): Promise<void> {
  const ids = (getDb().prepare("SELECT id FROM topics WHERE status = 'ready' AND (note_id IS NULL OR note_id NOT IN (SELECT id FROM notes))").all() as { id: string }[]).map((r) => r.id)
  for (const id of ids) await syncTopicNote(id).catch(() => null)
}
