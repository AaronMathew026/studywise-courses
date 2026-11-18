import { useEffect, useState } from 'react'
import { Sparkles, NotebookPen, Plus, Brain, Layers, FileText, ArrowRight, Keyboard } from 'lucide-react'
import type { Deck } from '@shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { runCommand } from '../lib/commands'
import { Shell, PageTitle, Stat } from '../components/Shell'
import { Button, Card, Pill, ProgressBar, Kbd } from '../components/ui'

type DeckRow = Deck & { card_count: number; due_count: number }

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Late night study' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Home() {
  const go = useStore((s) => s.go)
  const version = useStore((s) => s.version)
  const jobs = useStore((s) => s.jobs)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [notes, setNotes] = useState<{ id: string; title: string; module: string; updated_at: string }[]>([])

  useEffect(() => {
    void api.decks.list().then(setDecks)
    void api.notes.list().then(setNotes)
  }, [version])

  const due = decks.reduce((n, d) => n + d.due_count, 0)
  const total = decks.reduce((n, d) => n + d.card_count, 0)
  const running = jobs.filter((j) => j.status === 'running')
  const dueDecks = [...decks].filter((d) => d.due_count > 0).sort((a, b) => b.due_count - a.due_count)

  return (
    <Shell>
      <PageTitle eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} title={greeting()}>
        {due > 0 ? `${due} card${due === 1 ? '' : 's'} due today across ${dueDecks.length} deck${dueDecks.length === 1 ? '' : 's'}.` : total ? 'Nothing due. A good moment for a Learn session.' : 'Drop a PDF anywhere to get started.'}
      </PageTitle>

      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['Generate flashcards', 'From PDFs, notes, text or a topic', Sparkles, 'gen.cards', '⌘G'],
            ['Generate notes', 'Structured notes in your style', NotebookPen, 'gen.notes', '⇧⌘G'],
            ['New deck', 'Start from scratch or import', Plus, 'deck.new', '⌥⌘N'],
            ['Start Learn', 'AI questions from your cards', Brain, 'study.learn', '⌘L']
          ] as const
        ).map(([title, sub, Icon, cmd, k]) => (
          <button
            key={cmd}
            onClick={() => runCommand(cmd)}
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors duration-200 hover:border-accent/60"
          >
            <Icon className="mt-0.5 size-[18px] shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{title}</span>
                <Kbd className="text-muted opacity-0 transition-opacity group-hover:opacity-100">{k}</Kbd>
              </span>
              <span className="block text-[0.85rem] text-muted">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Due today" value={due} tone="accent" />
        <Stat label="Cards" value={total} />
        <Stat label="Decks" value={decks.length} />
        <Stat label="Notes" value={notes.length} />
      </div>

      {running.length > 0 && (
        <Card className="mt-6 flex flex-wrap items-center gap-3" onClick={() => go({ name: 'jobs' })}>
          <span className="pulse-dot size-2.5 rounded-full bg-accent" />
          <span className="font-semibold">{running.length} AI job{running.length === 1 ? '' : 's'} running</span>
          <span className="min-w-0 flex-1 truncate text-muted">{running[0].title} · {running[0].progress}</span>
          <ArrowRight className="size-4 text-muted" />
        </Card>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Due for review</h2>
            <Button size="sm" variant="ghost" onClick={() => go({ name: 'decks' })}>
              All decks
            </Button>
          </div>
          {dueDecks.length === 0 ? (
            <Card className="text-muted">You’re all caught up.</Card>
          ) : (
            <div className="stagger flex flex-col gap-2.5">
              {dueDecks.slice(0, 6).map((d) => (
                <Card key={d.id} className="flex items-center gap-4 !p-4" onClick={() => go({ name: 'deck', id: d.id })}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{d.name}</span>
                    <ProgressBar value={1 - d.due_count / Math.max(1, d.card_count)} className="mt-1.5 h-1.5" />
                  </span>
                  <Pill tone="accent">{d.due_count} due</Pill>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      go({ name: 'flashcards', deckId: d.id, mode: 'due' })
                    }}
                  >
                    Review
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent notes</h2>
            <Button size="sm" variant="ghost" onClick={() => go({ name: 'notes' })}>
              All notes
            </Button>
          </div>
          {notes.length === 0 ? (
            <Card className="text-muted">No notes yet. Press ⇧⌘G to generate some from a PDF.</Card>
          ) : (
            <div className="stagger flex flex-col gap-2">
              {notes.slice(0, 6).map((n) => (
                <Card key={n.id} className="flex items-center gap-3 !p-3.5" onClick={() => go({ name: 'notes', id: n.id })}>
                  <FileText className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                  {n.module && <Pill>{n.module}</Pill>}
                </Card>
              ))}
            </div>
          )}
          <button onClick={() => runCommand('shortcuts')} className="mt-4 flex items-center gap-2 text-[0.88rem] text-muted hover:text-ink">
            <Keyboard className="size-4" /> Press <Kbd>?</Kbd> for all keyboard shortcuts
          </button>
        </section>
      </div>
    </Shell>
  )
}
