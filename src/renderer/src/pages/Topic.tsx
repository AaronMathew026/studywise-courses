import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Lightbulb, CheckCircle2, XCircle, CircleDot, BookOpen, Trophy, Brain, ArrowRight, Sparkles, Shuffle, NotebookPen } from 'lucide-react'
import {
  COURSE_QUESTION_LABELS,
  expectedText,
  markCourseAnswer,
  questionText,
  type CourseAnswer,
  type CourseQuestion,
  type Topic,
  type TopicProgress,
  type TopicSection
} from '@shared/course'
import type { Mark } from '@shared/questions'
import type { Card } from '@shared/types'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { Markdown } from '../components/Markdown'
import { Button, Dots, Kbd, Modal, Pill, Textarea, cx } from '../components/ui'
import { CourseQuestionView } from '../learn/CourseQuestions'
import { SUBMIT_EVENT } from '../learn/Questions'

/** Chance of a surprise recall card from another topic after a section. */
const RECALL_CHANCE = 0.25

type Step =
  | { kind: 'notes'; section: number }
  | { kind: 'q'; section: number; index: number; q: CourseQuestion } // section -1 = topic check
  | { kind: 'recall'; after: number }
  | { kind: 'check_intro' }
  | { kind: 'summary' }

interface Slot {
  answer: CourseAnswer | null
  mark: Mark | null
  marking: boolean
  hint: boolean
  correction: string
  overridden: boolean
}
const emptySlot = (): Slot => ({ answer: null, mark: null, marking: false, hint: false, correction: '', overridden: false })

function buildSteps(t: Topic): Step[] {
  const c = t.content!
  const steps: Step[] = []
  c.sections.forEach((s, i) => {
    steps.push({ kind: 'notes', section: i })
    s.questions.forEach((q, j) => steps.push({ kind: 'q', section: i, index: j, q }))
    // Never two recall cards in a row: there's always a section between them.
    if (i < c.sections.length - 1 && Math.random() < RECALL_CHANCE) steps.push({ kind: 'recall', after: i })
  })
  if (c.check.length) {
    steps.push({ kind: 'check_intro' })
    c.check.forEach((q, j) => steps.push({ kind: 'q', section: -1, index: j, q }))
  }
  steps.push({ kind: 'summary' })
  return steps
}

const credit = (m: Mark | null) => (!m ? 0 : m.verdict === 'correct' ? 1 : m.verdict === 'partial' ? 0.5 : 0)

export function TopicPage({ id }: { id: string }) {
  const go = useStore((s) => s.go)
  const openExplain = useStore((s) => s.openExplain)
  const [topic, setTopic] = useState<Topic | null>(null)
  const [siblings, setSiblings] = useState<Topic[]>([])
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [at, setAt] = useState(0)
  const [slots, setSlots] = useState<Record<number, Slot>>({})
  const [notesOpen, setNotesOpen] = useState(false)
  const progress = useRef<TopicProgress | null>(null)

  useEffect(() => {
    let alive = true
    api.courses
      .topic({ id })
      .then(async (t) => {
        if (!alive) return
        if (!t.content) throw new Error('This topic hasn’t been written yet.')
        const s = buildSteps(t)
        const p = t.progress
        // Resume at the start of the section you were on; a finished topic starts over.
        let start = 0
        if (!p.done && p.section > 0) {
          const i = p.section >= t.content.sections.length ? s.findIndex((x) => x.kind === 'check_intro' || x.kind === 'summary') : s.findIndex((x) => x.kind === 'notes' && x.section === p.section)
          start = Math.max(0, i)
        }
        progress.current = p.done ? { ...p, section: 0, answered: 0, correct: 0 } : { ...p }
        setTopic(t)
        setSteps(s)
        setAt(start)
        setSlots({})
        const c = await api.courses.get({ id: t.course_id })
        if (alive) setSiblings(c.weeks.flatMap((w) => w.topics))
      })
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [id])

  const step = steps[at]
  const slot = slots[at] ?? emptySlot()
  const patch = (i: number, p: Partial<Slot>) => setSlots((cur) => ({ ...cur, [i]: { ...(cur[i] ?? emptySlot()), ...p } }))

  const save = (p: Partial<TopicProgress>) => {
    if (!progress.current || !topic) return
    progress.current = { ...progress.current, ...p }
    void api.courses.progress({ topicId: topic.id, progress: progress.current }).catch(() => {})
  }

  // Remember where you are, and wrap up at the end.
  useEffect(() => {
    if (!step || !topic?.content) return
    if (step.kind === 'notes') save({ section: step.section })
    if (step.kind === 'check_intro') save({ section: topic.content.sections.length })
    if (step.kind === 'summary') {
      const checks = steps.map((s, i) => [s, i] as const).filter(([s]) => s.kind === 'q' && s.section === -1)
      const score = checks.reduce((n, [, i]) => n + credit(slots[i]?.mark ?? null), 0)
      save({ section: topic.content.sections.length, done: true, checkScore: checks.length ? Math.round(score * 10) / 10 : null, checkTotal: checks.length || null })
      useStore.getState().bump()
    }
  }, [at, step?.kind])

  const next = () => setAt((i) => Math.min(steps.length - 1, i + 1))

  const submit = async (a: CourseAnswer) => {
    if (!step || step.kind !== 'q' || !topic || slot.mark || slot.marking) return
    const i = at
    const q = step.q
    patch(i, { answer: a, marking: true })
    try {
      let mark: Mark | null
      let correction = ''
      if (q.type === 'explain') {
        const r = await api.courses.mark({ courseId: topic.course_id, question: q, answer: a.type === 'free_answer' ? a.text : '' })
        mark = r.mark
        correction = r.wrong
      } else mark = markCourseAnswer(q, a)
      patch(i, { mark, marking: false, correction })
      if (progress.current) save({ answered: progress.current.answered + 1, correct: progress.current.correct + credit(mark) })
    } catch (e) {
      patch(i, { marking: false, answer: null })
      toast(errorText(e), 'bad')
    }
  }

  const override = () => {
    if (!slot.mark || slot.mark.verdict === 'correct' || !progress.current) return
    const before = credit(slot.mark)
    patch(at, { mark: { ...slot.mark, score: 10, verdict: 'correct' }, overridden: true })
    save({ correct: progress.current.correct + 1 - before })
  }

  const explain = () => {
    if (!step || step.kind !== 'q' || !topic?.content) return
    const sec = step.section >= 0 ? topic.content.sections[step.section] : null
    const userAnswer = slot.answer?.type === 'free_answer' ? slot.answer.text : slot.mark ? (slot.mark.verdict === 'correct' ? '(answered correctly)' : '(answered incorrectly)') : null
    openExplain({
      ctx: { question: questionText(step.q), expectedAnswer: expectedText(step.q), userAnswer, selection: sec ? `${sec.heading}\n\n${sec.notes}` : null },
      title: questionText(step.q).split('\n')[0],
      mode: slot.mark && slot.mark.verdict !== 'correct' ? 'why_wrong' : 'explain'
    })
  }

  // Keys: ↩ continues or submits, t/f for true or false, h for a hint.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || document.querySelector('[data-modal]')) return
      if (!step) return
      if (e.key === 'Escape') return void go({ name: 'course', id: topic!.course_id })
      if (step.kind === 'notes' || step.kind === 'check_intro') {
        if (e.key === 'Enter') (e.preventDefault(), next())
        return
      }
      if (step.kind !== 'q') return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (slot.mark) next()
        else window.dispatchEvent(new Event(SUBMIT_EVENT))
      } else if (!slot.mark && step.q.type === 'true_false' && (e.key === 't' || e.key === 'f')) void submit({ type: 'true_false', value: e.key === 't' })
      else if (!slot.mark && e.key === 'h') patch(at, { hint: true })
      else if (slot.mark && e.key === 'r') override()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (error)
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <XCircle className="size-10 text-bad" />
          <p className="text-muted">{error}</p>
          <Button onClick={() => history.length && useStore.getState().goBack()}>Back</Button>
        </div>
      </div>
    )
  if (!topic?.content || !step) return null
  const content = topic.content
  const sectionCount = content.sections.length
  const curSection = step.kind === 'notes' || step.kind === 'q' ? step.section : step.kind === 'recall' ? step.after : sectionCount
  const inCheck = step.kind === 'check_intro' || (step.kind === 'q' && step.section === -1)
  const idx = siblings.findIndex((t) => t.id === topic.id)
  const nextTopic = siblings.slice(idx + 1).find((t) => t.status === 'ready' && !t.progress.done)
  const verdict = slot.mark?.verdict

  return (
    <div className="flex min-h-full flex-col px-[clamp(16px,3vw,40px)] pt-5 pb-10">
      <div className="mx-auto flex w-full max-w-[860px] items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => go({ name: 'course', id: topic.course_id })} title="Back to course (esc)">
          <X className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[0.85rem] text-muted">
            <span className="truncate font-semibold">{content.title}</span>
            <span>{inCheck ? 'Topic check' : step.kind === 'summary' ? 'Done' : `Section ${Math.min(curSection + 1, sectionCount)} of ${sectionCount}`}</span>
          </div>
          <div className="flex gap-1">
            {content.sections.map((_, i) => (
              <div key={i} className={cx('h-2 flex-1 rounded-full transition-colors duration-500', i < curSection || inCheck || step.kind === 'summary' ? 'bg-good' : i === curSection ? 'bg-accent' : 'bg-surface-2')} />
            ))}
            {content.check.length > 0 && <div className={cx('h-2 w-10 rounded-full transition-colors duration-500', step.kind === 'summary' ? 'bg-good' : inCheck ? 'bg-accent' : 'bg-surface-2')} />}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setNotesOpen(true)} title="All notes so far">
          <BookOpen className="size-5" />
        </Button>
      </div>

      <div className="mx-auto mt-7 w-full max-w-[860px] flex-1">
        {step.kind === 'notes' && <NotesStep key={at} section={content.sections[step.section]} first={step.section === 0} goal={content.goal} onNext={next} />}

        {step.kind === 'recall' && <RecallStep key={at} courseId={topic.course_id} topicId={topic.id} onNext={next} />}

        {step.kind === 'check_intro' && (
          <div className="pop-in flex flex-col items-start gap-4 rounded-xl border border-line bg-surface p-[clamp(18px,3.4vw,36px)]">
            <Brain className="size-8 text-accent" strokeWidth={1.6} />
            <h2 className="text-[clamp(1.4rem,2.6vw,1.9rem)] leading-tight font-semibold tracking-tight">Topic check</h2>
            <p className="text-muted">
              {content.check.length} questions across the whole topic, a bit harder than the ones so far. No notes this time.
            </p>
            <Button variant="primary" size="lg" onClick={next}>
              Start the check <Kbd className="ml-1 border-current/30">↩</Kbd>
            </Button>
          </div>
        )}

        {step.kind === 'q' && (
          <div key={at} className="pop-in">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Pill tone="accent">{COURSE_QUESTION_LABELS[step.q.type]}</Pill>
              <span className="flex-1" />
              {!slot.mark && step.q.hint && (
                <Button size="sm" variant="ghost" onClick={() => patch(at, { hint: true })} disabled={slot.hint} title="Hint (H)">
                  Hint
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={explain} title="Explain">
                Explain
              </Button>
            </div>
            {slot.hint && !slot.mark && (
              <div className="pop-in mb-4 flex items-start gap-2 rounded-lg bg-warn-soft px-4 py-2.5 text-[0.95rem]">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" /> <span>{step.q.hint}</span>
              </div>
            )}
            <div className={cx('rounded-xl border bg-surface p-[clamp(18px,3.4vw,36px)] transition-colors duration-500', verdict === 'correct' ? 'border-good/50' : verdict === 'partial' ? 'border-warn/50' : verdict === 'wrong' ? 'border-bad/50' : 'border-line')}>
              <CourseQuestionView q={step.q} qid={`${topic.id}:${at}`} mark={slot.mark} answer={slot.answer} onAnswer={submit} disabled={!!slot.mark || slot.marking} />
              {slot.marking && (
                <div className="mt-4 flex items-center gap-2 text-muted">
                  Marking <Dots />
                </div>
              )}
            </div>
            {slot.mark && (
              <div className="pop-in mt-4 flex flex-col gap-3">
                <div className={cx('flex flex-wrap items-center gap-3 rounded-xl px-5 py-4', verdict === 'correct' ? 'bg-good-soft text-good' : verdict === 'partial' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad')}>
                  {verdict === 'correct' ? <CheckCircle2 className="size-6" /> : verdict === 'partial' ? <CircleDot className="size-6" /> : <XCircle className="size-6" />}
                  <span className="text-lg font-semibold">{verdict === 'correct' ? (slot.overridden ? 'Marked correct' : 'Correct!') : verdict === 'partial' ? 'Partly right' : 'Not quite'}</span>
                  <span className="flex-1" />
                  {verdict !== 'correct' && (
                    <Button size="sm" variant="outline" onClick={override} title="I was right (R)">
                      I was right
                    </Button>
                  )}
                  <Button size="sm" variant="ink" onClick={next}>
                    Continue <Kbd className="ml-1 border-current/30">↩</Kbd>
                  </Button>
                </div>
                {(step.q.why || slot.correction) && (
                  <div className="rounded-xl border border-line bg-surface p-5">
                    {slot.correction && (
                      <p className="mb-2">
                        <span className="font-semibold text-bad">Careful: </span>
                        {slot.correction}
                      </p>
                    )}
                    {step.q.why && (
                      <>
                        <h3 className="mb-1 text-[0.78rem] font-semibold text-muted">Why</h3>
                        <Markdown>{step.q.why}</Markdown>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {!slot.mark && !slot.marking && (
              <div className="mt-4 flex justify-end">
                <Button size="sm" variant="ghost" onClick={next}>
                  Skip
                </Button>
              </div>
            )}
          </div>
        )}

        {step.kind === 'summary' && (
          <Summary
            steps={steps}
            slots={slots}
            title={content.title}
            onCourse={() => go({ name: 'course', id: topic.course_id })}
            onNext={nextTopic ? () => go({ name: 'topic', id: nextTopic.id }) : null}
            nextTitle={nextTopic?.content?.title ?? nextTopic?.plan.title}
            onSaveNote={async () => {
              const noteId = await api.courses.saveNote({ topicId: topic.id })
              useStore.getState().bump()
              toast('Saved as a note', 'good', { label: 'Open', run: () => go({ name: 'notes', id: noteId }) })
            }}
          />
        )}
      </div>

      <Modal open={notesOpen} onClose={() => setNotesOpen(false)} title={content.title} wide>
        <div className="flex flex-col gap-6">
          {content.sections.slice(0, Math.max(1, Math.min(sectionCount, inCheck || step.kind === 'summary' ? sectionCount : curSection + 1))).map((s, i) => (
            <section key={i}>
              <h2 className="mb-2 text-[1.15rem] font-semibold">{s.heading}</h2>
              <Markdown>{s.notes}</Markdown>
            </section>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function NotesStep({ section, first, goal, onNext }: { section: TopicSection; first: boolean; goal: string; onNext: () => void }) {
  const [img, setImg] = useState<string | null>(null)
  const [imgErr, setImgErr] = useState(false)
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    if (!section.figure) return
    api.courses
      .figure({ fileId: section.figure.fileId, page: section.figure.page })
      .then(setImg)
      .catch(() => setImgErr(true))
  }, [section.figure?.fileId, section.figure?.page])
  return (
    <div className="pop-in flex flex-col gap-5">
      <div className="rounded-xl border border-line bg-surface p-[clamp(18px,3.4vw,36px)]">
        {first && goal && <div className="mb-2 text-[0.85rem] font-semibold text-accent">{goal}</div>}
        <h2 className="mb-4 text-[clamp(1.35rem,2.6vw,1.85rem)] leading-tight font-semibold tracking-tight">{section.heading}</h2>
        <Markdown className="text-[1.05rem] leading-relaxed">{section.notes}</Markdown>
        {section.figure && !imgErr && (
          <figure className="mt-6">
            {img ? (
              <button onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-lg border border-line bg-white" title="Click to enlarge">
                <img src={img} alt={section.figure.caption} className="mx-auto max-h-[60vh] w-auto object-contain" />
              </button>
            ) : (
              <div className="skeleton aspect-[4/3] w-full" />
            )}
            {section.figure.caption && <figcaption className="mt-2 text-[0.9rem] text-muted">{section.figure.caption}</figcaption>}
          </figure>
        )}
      </div>
      <Button variant="primary" size="lg" className="self-start" onClick={onNext}>
        Got it <ArrowRight className="size-4" /> <Kbd className="ml-1 border-current/30">↩</Kbd>
      </Button>
      {zoom && img && (
        <Modal open onClose={() => setZoom(false)} full>
          <img src={img} alt={section.figure?.caption ?? ''} className="mx-auto max-h-full rounded-lg bg-white" />
        </Modal>
      )}
    </div>
  )
}

function RecallStep({ courseId, topicId, onNext }: { courseId: string; topicId: string; onNext: () => void }) {
  const [data, setData] = useState<{ card: Card; topicTitle: string } | null | undefined>(undefined)
  const [typed, setTyped] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.courses
      .recall({ courseId, excludeTopicId: topicId, exclude: [...shownCards] })
      .then((r) => {
        if (!r) return onNext() // nothing to recall yet
        shownCards.add(r.card.id)
        setData(r)
      })
      .catch(() => onNext())
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || document.querySelector('[data-modal]')) return
      const inField = (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (e.key === 'Enter' && !e.shiftKey && !shown) (e.preventDefault(), setShown(true))
      else if (shown && !inField && (e.key === '1' || e.key === '2')) rate(e.key === '2')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const rate = async (knew: boolean) => {
    if (!data || busy) return
    setBusy(true)
    await api.courses.recallReview({ cardId: data.card.id, knew }).catch(() => {})
    onNext()
  }
  if (data === undefined) return <div className="skeleton h-48" />
  if (!data) return null
  return (
    <div className="pop-in flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[0.85rem] font-semibold text-accent">
        <Shuffle className="size-4" /> Quick recall · from {data.topicTitle}
      </div>
      <div className="rounded-xl border border-line bg-surface p-[clamp(18px,3.4vw,36px)]">
        <Markdown className="text-[clamp(1.2rem,2.4vw,1.6rem)] leading-snug font-semibold">{data.card.front}</Markdown>
        {!shown ? (
          <div className="mt-5 flex flex-col gap-3">
            <Textarea rows={2} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type it if you like, or just think it…" autoFocus />
            <Button variant="primary" size="lg" className="self-start" onClick={() => setShown(true)}>
              Show answer <Kbd className="ml-1 border-current/30">↩</Kbd>
            </Button>
          </div>
        ) : (
          <div className="pop-in mt-5 flex flex-col gap-4">
            {typed.trim() && (
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="mb-1 text-[0.75rem] font-semibold text-muted">You wrote</div>
                <div className="whitespace-pre-wrap">{typed}</div>
              </div>
            )}
            <div className="rounded-lg bg-accent-soft p-4">
              <div className="mb-1 text-[0.75rem] font-semibold text-accent">Answer</div>
              <Markdown>{data.card.back}</Markdown>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="lg" loading={busy} onClick={() => rate(false)}>
                Didn’t know <Kbd className="ml-1">1</Kbd>
              </Button>
              <Button variant="primary" size="lg" loading={busy} onClick={() => rate(true)}>
                Knew it <Kbd className="ml-1 border-current/30">2</Kbd>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
/** Recall cards already shown this session, so the same one doesn't come back. */
const shownCards = new Set<string>()

function Summary({
  steps,
  slots,
  title,
  onCourse,
  onNext,
  nextTitle,
  onSaveNote
}: {
  steps: Step[]
  slots: Record<number, Slot>
  title: string
  onCourse: () => void
  onNext: (() => void) | null
  nextTitle?: string
  onSaveNote: () => void
}) {
  const tally = useMemo(() => {
    const out = { sections: { got: 0, of: 0 }, check: { got: 0, of: 0 } }
    steps.forEach((s, i) => {
      if (s.kind !== 'q') return
      const bucket = s.section === -1 ? out.check : out.sections
      bucket.of += 1
      bucket.got += credit(slots[i]?.mark ?? null)
    })
    return out
  }, [steps, slots])
  const pct = tally.check.of ? tally.check.got / tally.check.of : tally.sections.of ? tally.sections.got / tally.sections.of : 1
  return (
    <div className="pop-in mx-auto flex w-full max-w-lg flex-col items-center gap-5 pt-6 text-center">
      <Trophy className="size-8 text-accent" strokeWidth={1.6} />
      <div>
        <h2 className="text-[2rem] leading-tight font-semibold tracking-tight">{pct >= 0.8 ? 'Topic done. Nice.' : pct >= 0.5 ? 'Topic done.' : 'Topic done. Worth another go.'}</h2>
        <p className="text-muted">{title}</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5">
        {[
          ['As you went', tally.sections],
          ['Topic check', tally.check]
        ].map(([label, t]) => {
          const v = t as { got: number; of: number }
          return (
            <div key={label as string} className="rounded-xl bg-surface-2 p-4">
              <div className="text-3xl font-semibold">{v.of ? `${Math.round((v.got / v.of) * 100)}%` : '–'}</div>
              <div className="text-[0.82rem] font-semibold text-muted">
                {label as string} {v.of ? `· ${v.got}/${v.of}` : ''}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[0.9rem] text-muted">
        <Sparkles className="mr-1 inline size-4 text-accent" />
        This topic’s recall cards will pop up while you learn other topics, and in spaced review.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {onNext && (
          <Button variant="primary" onClick={onNext}>
            Next: {nextTitle} <ArrowRight className="size-4" />
          </Button>
        )}
        <Button variant={onNext ? 'outline' : 'primary'} onClick={onCourse}>
          Back to course
        </Button>
        <Button variant="ghost" onClick={onSaveNote}>
          <NotebookPen className="size-4" /> Save notes as a note
        </Button>
      </div>
    </div>
  )
}
