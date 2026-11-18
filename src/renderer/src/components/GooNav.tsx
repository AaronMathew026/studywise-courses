import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Search, Plus } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { cx, Kbd } from './ui'
import { runCommand } from '../lib/commands'

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
      if (window.innerWidth >= 820) setOpen(false)
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
      <nav className="relative flex h-[var(--nav-h)] items-center gap-3 pr-3 pl-[86px] sm:pr-4">
        <button onClick={() => navTo({ name: 'home' })} className="no-drag flex items-center gap-2 pr-2">
          <Logo />
          <span className="hidden text-[0.95rem] font-semibold tracking-[-0.01em] min-[1000px]:inline">Studywise</span>
        </button>

        <div className="hidden flex-1 justify-center min-[820px]:flex">
          <div ref={linksRef} className="goo-links no-drag" onMouseLeave={() => setHovering(false)}>
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
        <div className="flex-1 min-[820px]:hidden" />

        <button
          onClick={() => runCommand('palette')}
          className="no-drag hidden h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[0.85rem] text-muted transition-colors hover:text-ink sm:flex"
        >
          <Search className="size-3.5" />
          <span className="hidden lg:inline">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button
          onClick={() => runCommand('gen.cards')}
          className="no-drag inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.85rem] font-medium text-accent-ink transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.98]"
          title="Generate flashcards with AI (⌘G)"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Generate</span>
        </button>
        <button className="menu-btn no-drag min-[820px]:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="menu-bar menu-bar-1" />
          <span className="menu-bar menu-bar-2" />
        </button>
      </nav>
      <div className="menu-panel no-drag min-[820px]:hidden">
        {LINKS.map((l) => (
          <button key={l.label} onClick={() => navTo(l.route)}>
            {l.label}
            <Kbd className="text-muted">{l.key}</Kbd>
          </button>
        ))}
        <button onClick={() => (setOpen(false), runCommand('palette'))}>
          Commands
          <Kbd className="text-muted">⌘K</Kbd>
        </button>
      </div>
    </header>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent)" />
      <path d="M7.5 12.4l3 3 6-6.4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
