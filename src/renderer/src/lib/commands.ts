import { useEffect, useRef } from 'react'
import { COMMANDS, COMMAND_BY_ID, matchesKey } from '@shared/keymap'
import { onEvent } from './api'

// A stack of handlers per command id: the most recently mounted wins, so a
// page can override a global command while it's on screen.
type Handler = () => void
const stacks = new Map<string, Handler[]>()
const listeners = new Set<() => void>()

export function registerCommand(id: string, fn: Handler): () => void {
  const s = stacks.get(id) ?? []
  s.push(fn)
  stacks.set(id, s)
  listeners.forEach((l) => l())
  return () => {
    const cur = stacks.get(id) ?? []
    const i = cur.lastIndexOf(fn)
    if (i !== -1) cur.splice(i, 1)
    listeners.forEach((l) => l())
  }
}

export function runCommand(id: string): boolean {
  const s = stacks.get(id)
  const fn = s?.[s.length - 1]
  if (!fn) return false
  fn()
  return true
}

export function isAvailable(id: string): boolean {
  return (stacks.get(id)?.length ?? 0) > 0
}

export function onCommandsChanged(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Register a handler for a command while the component is mounted. */
export function useCommand(id: string, fn: (() => void) | null | false, deps: unknown[] = []): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!fn) return
    return registerCommand(id, () => ref.current && ref.current())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!fn, ...deps])
}

export function useCommands(map: Record<string, (() => void) | null | false>, deps: unknown[] = []): void {
  const ref = useRef(map)
  ref.current = map
  const keys = Object.keys(map).filter((k) => !!map[k])
  useEffect(() => {
    const offs = keys.map((k) => registerCommand(k, () => (ref.current[k] as () => void)?.()))
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(','), ...deps])
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest?.('.cm-editor')
}

let started = false
/** Keyboard + menu dispatch. Menu accelerators arrive from the main process. */
export function startCommandDispatch(): void {
  if (started) return
  started = true
  onEvent((ev) => {
    if (ev.type === 'menu') runCommand(ev.action)
  })

  let seq: string | null = null
  let seqTimer: ReturnType<typeof setTimeout> | null = null

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || e.defaultPrevented) return
      const typing = isTyping(e.target)
      const hasMod = e.metaKey || e.ctrlKey || e.altKey

      // Sequences like "g d"
      if (!typing && !hasMod && seq) {
        const combo = `${seq} ${e.key.toLowerCase()}`
        seq = null
        if (seqTimer) clearTimeout(seqTimer)
        const c = COMMANDS.find((x) => x.keys?.includes(combo))
        if (c && runCommand(c.id)) {
          e.preventDefault()
          return
        }
      }
      if (!typing && !hasMod && e.key.toLowerCase() === 'g' && COMMANDS.some((c) => c.keys?.some((k) => k.startsWith('g ')))) {
        seq = 'g'
        seqTimer = setTimeout(() => (seq = null), 1200)
        return
      }

      for (const c of COMMANDS) {
        const keys = [...(c.keys ?? [])]
        // Menu accelerators normally come through the menu; also match them
        // here so they work in tests and when a modal swallows the menu.
        if (c.accelerator && !c.menu) keys.push(c.accelerator)
        for (const k of keys) {
          if (k.includes(' ') && !k.includes('+')) continue
          const modKey = k.includes('+') && /CmdOrCtrl|Alt|Ctrl/.test(k)
          if (typing && !modKey && k !== 'Escape') continue
          // A modal owns plain keys (and Escape) while it's open.
          if (!modKey && document.querySelector('[data-modal]') && !(e.target as HTMLElement)?.closest?.('[data-modal-keys]')) continue
          if (!matchesKey(e, k)) continue
          if (runCommand(c.id)) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
        }
      }
    },
    true
  )
}

export function commandLabel(id: string): string {
  return COMMAND_BY_ID.get(id)?.label ?? id
}
