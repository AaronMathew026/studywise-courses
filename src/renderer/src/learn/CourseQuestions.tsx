import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { asLearnQuestion, tokenIs, wordTokens, type CourseAnswer, type CourseQuestion } from '@shared/course'
import type { LearnAnswer, Mark } from '@shared/questions'
import { Markdown } from '../components/Markdown'
import { Button, Kbd, cx } from '../components/ui'
import { QuestionView, SUBMIT_EVENT } from './Questions'

interface Props<T extends CourseQuestion['type']> {
  q: Extract<CourseQuestion, { type: T }>
  qid: string
  mark: Mark | null
  answer: CourseAnswer | null
  onAnswer: (a: CourseAnswer) => void
  disabled: boolean
}

function useSubmit(fn: () => void, active: boolean) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const h = () => ref.current()
    window.addEventListener(SUBMIT_EVENT, h)
    return () => window.removeEventListener(SUBMIT_EVENT, h)
  }, [active])
}

function seeded(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export function WrongWord({ q, mark, answer, onAnswer, disabled }: Props<'wrong_word'>) {
  const tokens = useMemo(() => wordTokens(q.text), [q.text])
  const picked = answer?.type === 'wrong_word' ? answer.index : null
  const [sel, setSel] = useState<number | null>(picked)
  const realIdx = tokens.findIndex((t) => tokenIs(t, q.wrong))
  useSubmit(() => sel !== null && onAnswer({ type: 'wrong_word', index: sel }), !disabled)
  return (
    <div className="flex flex-col gap-5">
      <div className="text-[0.8rem] font-semibold text-muted">One word is wrong. Tap it.</div>
      <div className="text-[clamp(1.15rem,2.3vw,1.5rem)] leading-[2.1] font-medium">
        {tokens.map((t, i) => {
          const isReal = mark && i === realIdx
          const wrongPick = mark && picked === i && i !== realIdx
          return (
            <span key={i}>
              <button
                disabled={disabled}
                onClick={() => (setSel(i), onAnswer({ type: 'wrong_word', index: i }))}
                className={cx(
                  'rounded-lg px-1 transition-colors duration-200',
                  !mark && 'hover:bg-accent-soft',
                  !mark && sel === i && 'bg-accent-soft',
                  isReal && 'bg-bad-soft text-bad line-through decoration-2',
                  wrongPick && 'shake bg-surface-2'
                )}
              >
                {t}
              </button>
              {isReal && <span className="pop-in mx-1 rounded-lg bg-good-soft px-1.5 font-semibold text-good">{q.correct}</span>}{' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function Order({ q, qid, mark, answer, onAnswer, disabled }: Props<'order'>) {
  const initial = useMemo(() => {
    const rand = seeded(qid)
    const idx = q.items.map((_, i) => i)
    for (let tries = 0; tries < 5; tries++) {
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[idx[i], idx[j]] = [idx[j], idx[i]]
      }
      if (idx.some((v, i) => v !== i)) break
    }
    if (idx.every((v, i) => v === i)) idx.reverse()
    return idx
  }, [q.items, qid])
  const [order, setOrder] = useState<number[]>(answer?.type === 'order' ? answer.order : initial)
  const [drag, setDrag] = useState<number | null>(null)
  const wrong = new Set(mark?.detail?.wrongItems ?? [])
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    const next = [...order]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    setOrder(next)
  }
  useSubmit(() => onAnswer({ type: 'order', order }), !disabled)
  return (
    <div className="flex flex-col gap-4">
      <Markdown className="text-[clamp(1.15rem,2.3vw,1.5rem)] leading-snug font-semibold">{q.q}</Markdown>
      <ol className="flex flex-col gap-2">
        {order.map((orig, pos) => (
          <li
            key={orig}
            draggable={!disabled}
            onDragStart={() => setDrag(pos)}
            onDragOver={(e) => {
              e.preventDefault()
              if (drag !== null && drag !== pos) {
                move(drag, pos)
                setDrag(pos)
              }
            }}
            onDragEnd={() => setDrag(null)}
            className={cx(
              'flex items-center gap-3 rounded-xl border-2 bg-surface px-3 py-2.5 transition-[border-color,background,transform] duration-200',
              !mark && 'border-line',
              !mark && drag === pos && 'scale-[1.01] border-accent bg-accent-soft',
              mark && (wrong.has(pos) ? 'shake border-bad bg-bad-soft' : 'border-good bg-good-soft')
            )}
          >
            {!disabled && <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />}
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.8rem] font-semibold">{pos + 1}</span>
            <Markdown className="min-w-0 flex-1">{q.items[orig]}</Markdown>
            {mark && wrong.has(pos) && <span className="shrink-0 text-[0.8rem] font-semibold text-good">should be {orig + 1}</span>}
            {!disabled && (
              <span className="flex shrink-0 gap-0.5">
                <Button size="icon" variant="ghost" onClick={() => move(pos, pos - 1)} disabled={pos === 0} aria-label="Move up">
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => move(pos, pos + 1)} disabled={pos === order.length - 1} aria-label="Move down">
                  <ArrowDown className="size-4" />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!disabled && (
        <Button variant="primary" size="lg" className="self-start" onClick={() => onAnswer({ type: 'order', order })}>
          Check order <Kbd className="ml-1 border-current/30">↩</Kbd>
        </Button>
      )}
    </div>
  )
}

export function CourseQuestionView({ q, qid, mark, answer, onAnswer, disabled }: { q: CourseQuestion; qid: string; mark: Mark | null; answer: CourseAnswer | null; onAnswer: (a: CourseAnswer) => void; disabled: boolean }) {
  if (q.type === 'wrong_word') return <WrongWord q={q} qid={qid} mark={mark} answer={answer} onAnswer={onAnswer} disabled={disabled} />
  if (q.type === 'order') return <Order q={q} qid={qid} mark={mark} answer={answer} onAnswer={onAnswer} disabled={disabled} />
  const lq = asLearnQuestion(q, qid)!
  return (
    <div className="flex flex-col gap-4">
      {(q.type === 'match' || q.type === 'sort') && q.q && <Markdown className="text-[clamp(1.1rem,2.2vw,1.4rem)] leading-snug font-semibold">{q.q}</Markdown>}
      <QuestionView q={lq} mark={mark} answer={answer as LearnAnswer | null} onAnswer={(a) => onAnswer(a)} disabled={disabled} />
    </div>
  )
}
