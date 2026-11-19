import { useEffect, useMemo, useState } from 'react'
import type { Deck, Card } from '@shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { runCommand, useCommands } from '../lib/commands'
import { Shell } from '../components/Shell'
import { Markdown } from '../components/Markdown'
import { Button, Kbd, cx } from '../components/ui'

type DeckRow = Deck & { card_count: number; due_count: number }
type Overview = { activity: { date: string; count: number }[]; streak: number; today: number; week: number; next: (Card & { deck_name: string }) | null }

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** A stable, pleasant hue per deck so the list has some colour. */
export function deckHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hues = [222, 262, 190, 152, 28, 340, 205, 48]
  return hues[h % hues.length]
}

export function Home() {
  const go = useStore((s) => s.go)
  const version = useStore((s) => s.version)
  const jobs = useStore((s) => s.jobs)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [notes, setNotes] = useState<{ id: string; title: string; module: string; updated_at: string }[]>([])
  const [ov, setOv] = useState<Overview | null>(null)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    void api.decks.list().then(setDecks)
    void api.notes.list().then(setNotes)
    void api.decks.overview().then((o) => setOv(o as Overview))
  }, [version])

  const due = decks.reduce((n, d) => n + d.due_count, 0)
  const running = jobs.filter((j) => j.status === 'running')
  const sorted = [...decks].sort((a, b) => b.due_count - a.due_count || a.name.localeCompare(b.name))
  const top = sorted.find((d) => d.due_count > 0)
  const next = ov?.next ?? null

  const startReview = () => (top ? go({ name: 'flashcards', deckId: top.id, mode: 'due' }) : runCommand('study.learn'))
  useCommands({ 'study.flip': next ? () => setFlipped((f) => !f) : null, 'learn.submit': top ? startReview : null }, [next, top])

  return (
    <Shell className="max-w-[1000px]">
      <section className="grid items-center gap-10 pt-2 pb-12 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-[0.95rem] text-muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          {decks.length === 0 ? (
            <>
              <h1 className="mt-2 text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em]">Let’s make your first deck.</h1>
              <p className="mt-3 max-w-md text-muted">Drop a lecture PDF anywhere on this window. Studywise will write the notes and the flashcards.</p>
            </>
          ) : (
            <>
              <h1 className="mt-1 flex items-baseline gap-3 tracking-[-0.04em]">
                <span key={due} className="pop-in text-[5.5rem] leading-none font-semibold text-accent tabular">
                  {due}
                </span>
                <span className="text-[1.6rem] font-semibold tracking-[-0.02em]">{due === 1 ? 'card due' : 'cards due'}</span>
              </h1>
              <p className="mt-3 text-muted">
                {due > 0 ? <>Biggest pile: <span className="text-ink">{top?.name}</span> with {top?.due_count}.</> : 'All caught up. A Learn session keeps it fresh.'}
                {ov && ov.streak > 0 && (
                  <>
                    {' '}
                    <span className="text-ink">{ov.streak}-day streak</span>
                    {ov.today === 0 ? ', keep it going today.' : '.'}
                  </>
                )}
              </p>
            </>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            {decks.length === 0 ? (
              <Button variant="primary" size="lg" onClick={() => runCommand('gen.cards')}>
                Generate flashcards
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={startReview}>
                {due > 0 ? 'Start reviewing' : 'Start Learn'} <Kbd className="ml-1 border-white/30 text-white/80">↩</Kbd>
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => runCommand('gen.notes')}>
              Generate notes
            </Button>
            <Button size="lg" variant="ghost" onClick={() => runCommand('deck.new')}>
              New deck
            </Button>
          </div>
        </div>

        {/* Next-up card stack */}
        <div className="relative mx-auto h-[250px] w-full max-w-[380px] select-none">
          <div className="absolute inset-0 translate-x-4 translate-y-3 rotate-[5deg] rounded-2xl border border-line bg-surface shadow-sm" />
          <div className="absolute inset-0 translate-x-2 translate-y-1.5 rotate-[2.5deg] rounded-2xl border border-line bg-surface shadow-sm" />
          {next ? (
            <button onClick={() => setFlipped((f) => !f)} className={cx('flip group absolute inset-0 text-left', flipped && 'is-flipped')} title="Flip (Space)">
              <div className="flip-inner h-full transition-transform duration-700 ease-out-soft group-hover:-rotate-1">
                <div className="flip-face flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-[0_18px_40px_-24px_rgba(20,40,120,0.35)]">
                  <div className="flex items-center gap-2 text-[0.8rem] text-muted">
                    <span className="size-2 rounded-full" style={{ background: `hsl(${deckHue(next.deck_name)} 70% 55%)` }} />
                    Next up · {next.deck_name}
                  </div>
                  <Markdown className="mt-4 line-clamp-5 text-[1.15rem] leading-snug font-medium">{next.front}</Markdown>
                  <span className="mt-auto text-[0.8rem] text-muted">Click or press Space to peek at the answer</span>
                </div>
                <div className="flip-face flip-back flex flex-col rounded-2xl border border-accent/40 bg-accent-soft p-6">
                  <div className="text-[0.8rem] text-accent">Answer</div>
                  <Markdown className="mt-4 line-clamp-6 text-[1.05rem] leading-snug">{next.back}</Markdown>
                  <span className="mt-auto text-[0.8rem] text-muted">Rate it properly in a review session</span>
                </div>
              </div>
            </button>
          ) : (
            <div className="absolute inset-0 flex flex-col justify-center rounded-2xl border border-line bg-surface p-6 shadow-[0_18px_40px_-24px_rgba(20,40,120,0.35)]">
              <div className="text-[1.15rem] font-medium">{decks.length ? 'Nothing waiting.' : 'Your cards land here.'}</div>
              <div className="mt-1 text-[0.9rem] text-muted">{decks.length ? 'The next due card will show up on this stack.' : 'Drop a PDF to get a stack going.'}</div>
            </div>
          )}
        </div>
      </section>

      {running.length > 0 && (
        <button onClick={() => go({ name: 'jobs' })} className="mb-10 flex w-full items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 text-left text-[0.92rem]">
          <span className="pulse-dot size-2 rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate">
            {running[0].title} <span className="text-muted">· {running[0].progress}</span>
          </span>
          {running.length > 1 && <span className="text-muted">+{running.length - 1} more</span>}
        </button>
      )}

      {ov && <Heatmap ov={ov} />}

      <div className="mt-12 grid gap-10 md:grid-cols-[1.4fr_1fr]">
        <Section title="Decks" action={decks.length > 0 ? { label: 'All decks', run: () => go({ name: 'decks' }) } : undefined}>
          {sorted.length === 0 ? (
            <EmptyRow>Your decks will show up here.</EmptyRow>
          ) : (
            sorted.slice(0, 8).map((d) => (
              <Row key={d.id} onClick={() => go({ name: 'deck', id: d.id })}>
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: `hsl(${deckHue(d.name)} 70% 55%)` }} />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="tabular text-[0.88rem] text-muted">{plural(d.card_count, 'card')}</span>
                <span className={cx('tabular w-14 text-right text-[0.88rem]', d.due_count ? 'font-medium text-accent' : 'text-muted/50')}>{d.due_count ? `${d.due_count} due` : '—'}</span>
              </Row>
            ))
          )}
        </Section>
        <Section title="Recent notes" action={notes.length > 0 ? { label: 'All notes', run: () => go({ name: 'notes' }) } : undefined}>
          {notes.length === 0 ? (
            <EmptyRow>Notes you write or generate show up here.</EmptyRow>
          ) : (
            notes.slice(0, 6).map((n) => (
              <Row key={n.id} onClick={() => go({ name: 'notes', id: n.id })}>
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                <span className="text-[0.85rem] text-muted">{n.module}</span>
              </Row>
            ))
          )}
        </Section>
      </div>

      <p className="mt-12 text-[0.85rem] text-muted">
        <Kbd>⌘K</Kbd> finds anything. <Kbd>?</Kbd> shows every shortcut.
      </p>
    </Shell>
  )
}

function Heatmap({ ov }: { ov: Overview }) {
  const max = Math.max(1, ...ov.activity.map((a) => a.count))
  // Columns are weeks (Mon–Sun), oldest on the left.
  const weeks = useMemo(() => {
    const first = new Date(ov.activity[0].date + 'T12:00')
    const pad = (first.getDay() + 6) % 7
    const cells: ({ date: string; count: number } | null)[] = [...Array(pad).fill(null), ...ov.activity]
    const cols: (typeof cells)[] = []
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))
    return cols
  }, [ov])
  const level = (c: number) => (c === 0 ? 0 : c / max < 0.25 ? 1 : c / max < 0.5 ? 2 : c / max < 0.75 ? 3 : 4)
  const shades = ['var(--surface-2)', 'color-mix(in oklab, var(--accent) 28%, var(--surface))', 'color-mix(in oklab, var(--accent) 50%, var(--surface))', 'color-mix(in oklab, var(--accent) 75%, var(--surface))', 'var(--accent)']
  const total = ov.activity.reduce((n, a) => n + a.count, 0)
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-5">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }).map((_, j) => {
              const c = col[j]
              return (
                <div
                  key={j}
                  title={c ? `${new Date(c.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${plural(c.count, 'review')}` : ''}
                  className="size-[13px] rounded-[3px] transition-transform duration-200 hover:scale-125"
                  style={{ background: c ? shades[level(c.count)] : 'transparent' }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <dl className="flex gap-8">
        {[
          ['streak', ov.streak, ov.streak === 1 ? 'day' : 'days'],
          ['this week', ov.week, 'reviews'],
          ['12 weeks', total, 'reviews']
        ].map(([label, n, unit]) => (
          <div key={label as string}>
            <dt className="text-[0.8rem] text-muted">{label as string}</dt>
            <dd className="tabular text-[1.5rem] leading-tight font-semibold tracking-tight">
              {n as number} <span className="text-[0.85rem] font-normal text-muted">{unit as string}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function Section({ title, action, children }: { title: string; action?: { label: string; run: () => void }; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[0.95rem] font-semibold">{title}</h2>
        {action && (
          <button onClick={action.run} className="text-[0.85rem] text-muted hover:text-ink">
            {action.label}
          </button>
        )}
      </div>
      <div className="border-t border-line">{children}</div>
    </section>
  )
}

export function Row({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={cx('-mx-3 flex cursor-pointer items-center gap-3 rounded-md border-b border-line px-3 py-2.5 text-[0.95rem] transition-colors hover:bg-surface-2/70', active && 'bg-accent-soft/60')}
    >
      {children}
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-[0.92rem] text-muted">{children}</div>
}
