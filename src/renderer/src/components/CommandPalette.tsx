import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Layers, FileText, CornerDownLeft, Zap } from 'lucide-react'
import { COMMANDS, prettyKey } from '@shared/keymap'
import { isAvailable, runCommand, onCommandsChanged } from '../lib/commands'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { cx, Kbd } from './ui'

type Item =
  | { kind: 'cmd'; id: string; label: string; group: string; key?: string }
  | { kind: 'deck'; id: string; label: string; sub: string }
  | { kind: 'note'; id: string; label: string; sub: string }
  | { kind: 'card'; id: string; deckId: string; label: string; sub: string }

function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  // subsequence
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 1 : 0
}

export function CommandPalette() {
  const open = useStore((s) => s.palette)
  const setOpen = useStore((s) => s.setPalette)
  const go = useStore((s) => s.go)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [, force] = useState(0)
  const [decks, setDecks] = useState<{ id: string; name: string; card_count: number }[]>([])
  const [notes, setNotes] = useState<{ id: string; title: string; module: string }[]>([])
  const [cards, setCards] = useState<{ id: string; deck_id: string; front: string; deck_name: string }[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => onCommandsChanged(() => force((n) => n + 1)), [])
  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    void api.decks.list().then(setDecks)
    void api.notes.list().then(setNotes)
    setTimeout(() => input.current?.focus(), 20)
  }, [open])
  useEffect(() => {
    if (!open || q.trim().length < 2) return setCards([])
    const t = setTimeout(() => void api.cards.search({ q: q.trim() }).then((r) => setCards(r.slice(0, 12))), 120)
    return () => clearTimeout(t)
  }, [q, open])

  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase()
    const cmds: Item[] = COMMANDS.filter((c) => c.id !== 'palette' && isAvailable(c.id)).map((c) => ({
      kind: 'cmd',
      id: c.id,
      label: c.label,
      group: c.group,
      key: c.accelerator ?? c.keys?.[0]
    }))
    const all: Item[] = [
      ...decks.map((d) => ({ kind: 'deck' as const, id: d.id, label: d.name, sub: `${d.card_count} card${d.card_count === 1 ? "" : "s"}` })),
      ...notes.map((n) => ({ kind: 'note' as const, id: n.id, label: n.title, sub: n.module || 'Note' })),
      ...cmds
    ]
    const ranked = all
      .map((it) => ({ it, s: score(it.label, ql) + (it.kind === 'cmd' && !ql ? 0.5 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it)
    const cardItems: Item[] = cards.map((c) => ({ kind: 'card', id: c.id, deckId: c.deck_id, label: c.front.split('\n')[0].slice(0, 90), sub: c.deck_name }))
    return [...ranked.slice(0, 40), ...cardItems]
  }, [q, decks, notes, cards])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null
  const pick = (it: Item) => {
    setOpen(false)
    setTimeout(() => {
      if (it.kind === 'cmd') runCommand(it.id)
      else if (it.kind === 'deck') go({ name: 'deck', id: it.id })
      else if (it.kind === 'note') go({ name: 'notes', id: it.id })
      else go({ name: 'deck', id: it.deckId, cardId: it.id })
    }, 10)
  }

  return createPortal(
    <div data-modal className="fade-in fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pop-in w-full max-w-[640px] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-5 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
                e.preventDefault()
                setSel((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (items[sel]) pick(items[sel])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            placeholder="Search decks, notes, cards, or type a command…"
            className="h-14 flex-1 bg-transparent text-[1.05rem] outline-none placeholder:text-muted"
          />
          <Kbd className="text-muted">esc</Kbd>
        </div>
        <div ref={list} className="max-h-[56vh] overflow-y-auto p-2">
          {items.length === 0 && <div className="px-4 py-10 text-center text-muted">Nothing matches “{q}”.</div>}
          {items.map((it, i) => (
            <button
              key={`${it.kind}:${it.id}`}
              data-i={i}
              onMouseMove={() => setSel(i)}
              onClick={() => pick(it)}
              className={cx('flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left transition-colors duration-150', i === sel ? 'bg-accent-soft' : 'hover:bg-surface-2')}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                {it.kind === 'cmd' ? <Zap className="size-4" /> : it.kind === 'note' ? <FileText className="size-4" /> : <Layers className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{it.label}</span>
                <span className="block truncate text-[0.8rem] text-muted">{it.kind === 'cmd' ? it.group : it.kind === 'card' ? `Card · ${it.sub}` : it.sub}</span>
              </span>
              {it.kind === 'cmd' && it.key && <Kbd className="text-muted">{prettyKey(it.key)}</Kbd>}
              {i === sel && <CornerDownLeft className="size-4 text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
