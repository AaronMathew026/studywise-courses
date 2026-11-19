import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { keyLabel } from '@shared/keymap'
import { Search, Plus } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { cx, Kbd } from './ui'
import { runCommand } from '../lib/commands'
import { UsageMeter } from './UsageMeter'

// Top navigation. Hovering a link sends three soft blobs after it at slightly
// different speeds; an SVG goo filter (in index.html) melts them together.

const LINKS: { label: string; route: Route; match: Route['name'][]; key: string }[] = [
  { label: 'Home', route: { name: 'home' }, match: ['home'], key: '⌘1' },
  { label: 'Decks', route: { name: 'decks' }, match: ['decks', 'deck', 'flashcards', 'learn'], key: '⌘2' },
  { label: 'Notes', route: { name: 'notes' }, match: ['notes'], key: '⌘3' },
  { label: 'Jobs', route: { name: 'jobs' }, match: ['jobs'], key: '⌘4' },
  { label: 'Settings', route: { name: 'settings' }, match: ['settings'], key: '⌘,' }
]

const P = 24

export function GooNav() {
  const route = useStore((s) => s.route)
  const go = useStore((s) => s.go)
  const jobs = useStore((s) => s.jobs)
  const running = jobs.filter((j) => j.status === 'running').length
  const linksRef = useRef<HTMLDivElement>(null)
  const blobs = useRef<(HTMLDivElement | null)[]>([])
  const [hovering, setHovering] = useState(false)
  const [open, setOpen] = useState(false)
  const activeIdx = LINKS.findIndex((l) => l.match.includes(route.name))

  const place = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const x = el.offsetLeft
    const y = el.offsetTop
    const w = el.offsetWidth
    const h = el.offsetHeight
    const set = (b: HTMLDivElement | null, bw: number, bh: number, top: number) => {
      if (!b) return
      b.style.left = `${P + x + (w - bw) / 2}px`
      b.style.top = `${top}px`
      b.style.width = `${bw}px`
      b.style.height = `${bh}px`
    }
    set(blobs.current[0], w, h, P + y)
    set(blobs.current[1], h, h, P + y)
    set(blobs.current[2], h * 0.8, h * 0.8, P + y + h * 0.1)
  }, [])

  useLayoutEffect(() => {
    if (hovering) return
    const el = linksRef.current?.querySelectorAll<HTMLElement>(':scope > button')[activeIdx]
    place(el ?? null)
  }, [activeIdx, hovering, place])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 900) setOpen(false)
      const el = linksRef.current?.querySelectorAll<HTMLElement>(':scope > button')[activeIdx]
      place(el ?? null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeIdx, place])

  const navTo = (r: Route) => {
    go(r)
    setOpen(false)
  }

  return (
    <header className={cx('drag relative z-30 shrink-0 border-b border-line bg-nav backdrop-blur-xl', open && 'is-open')}>
      <nav className="nav-inset relative flex h-[var(--nav-h)] items-center gap-3 pr-3 sm:pr-4">
        <button onClick={() => navTo({ name: 'home' })} className="no-drag flex items-center gap-2 pr-2">
          <Logo />
          <span className="hidden text-[0.95rem] font-semibold tracking-[-0.01em] sm:inline">Studywise</span>
        </button>

        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-center min-[900px]:flex">
          <div ref={linksRef} className="goo-links no-drag pointer-events-auto" onMouseLeave={() => setHovering(false)}>
            <div className="goo-layer" aria-hidden="true">
              {['a', 'b', 'c'].map((k, i) => (
                <div key={k} ref={(el) => void (blobs.current[i] = el)} className={cx('goo-blob', hovering ? 'is-on' : activeIdx >= 0 && 'is-rest')} data-blob={k} />
              ))}
            </div>
            {LINKS.map((l) => (
              <button
                key={l.label}
                onMouseEnter={(e) => {
                  setHovering(true)
                  place(e.currentTarget)
                }}
                onFocus={(e) => {
                  setHovering(true)
                  place(e.currentTarget)
                }}
                onBlur={() => setHovering(false)}
                onClick={() => navTo(l.route)}
                aria-current={l.match.includes(route.name) ? 'page' : undefined}
              >
                {l.label}
                {l.label === 'Jobs' && running > 0 && <span className="tabular ml-1.5 inline-grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.68rem] leading-4 text-accent-ink">{running}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />

        <UsageMeter />
        <button
          onClick={() => runCommand('palette')}
          className="no-drag hidden h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[0.85rem] text-muted transition-colors hover:text-ink sm:flex"
        >
          <Search className="size-3.5" />
          <span className="hidden xl:inline">Search</span>
          <Kbd>{keyLabel("⌘K")}</Kbd>
        </button>
        <button
          onClick={() => runCommand('gen.cards')}
          className="no-drag inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.85rem] font-medium text-accent-ink transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.98]"
          title={keyLabel("Generate flashcards with AI (⌘G)")}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Generate</span>
        </button>
        <button className="menu-btn no-drag min-[900px]:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="menu-bar menu-bar-1" />
          <span className="menu-bar menu-bar-2" />
        </button>
      </nav>
      <div className="menu-panel no-drag min-[900px]:hidden">
        {LINKS.map((l) => (
          <button key={l.label} onClick={() => navTo(l.route)}>
            {l.label}
            <Kbd className="text-muted">{l.key}</Kbd>
          </button>
        ))}
        <button onClick={() => (setOpen(false), runCommand('palette'))}>
          Commands
          <Kbd className="text-muted">{keyLabel("⌘K")}</Kbd>
        </button>
      </div>
    </header>
  )
}

export function Logo({ size = 24 }: { size?: number }) {
  // Same drawing as build/icon.svg, cropped to the squircle.
  return (
    <svg viewBox="100 100 824 824" width={size} height={size} aria-hidden="true">
      <rect x="100" y="100" width="824" height="824" rx="186" fill="#2f5bea" />
      <g transform="translate(27 12)">
        <rect x="372" y="272" width="280" height="384" rx="40" fill="#8eacff" transform="rotate(-20 512 760)" />
        <rect x="372" y="272" width="280" height="384" rx="40" fill="#c4d3ff" transform="rotate(-4 512 760)" />
        <rect x="372" y="272" width="280" height="384" rx="40" fill="#ffffff" transform="rotate(12 512 760)" />
      </g>
    </svg>
  )
}
