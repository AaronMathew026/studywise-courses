import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { paths } from './paths'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const DEFAULT: WindowState = { width: 1280, height: 820, maximized: false }

export function loadWindowState(): WindowState {
  try {
    const s = JSON.parse(readFileSync(paths.windowState, 'utf8')) as WindowState
    if (s.x !== undefined && s.y !== undefined) {
      // Only reuse the position if it's still on a connected display.
      const visible = screen.getAllDisplays().some((d) => intersects(d.workArea, { x: s.x!, y: s.y!, width: s.width, height: s.height }))
      if (!visible) return { ...DEFAULT, width: s.width, height: s.height }
    }
    return { ...DEFAULT, ...s }
  } catch {
    return DEFAULT
  }
}

function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function trackWindowState(win: BrowserWindow): void {
  let t: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed()) return
    const b = win.getNormalBounds()
    const s: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }
    try {
      writeFileSync(paths.windowState, JSON.stringify(s))
    } catch {
      /* ignore */
    }
  }
  const later = () => {
    if (t) clearTimeout(t)
    t = setTimeout(save, 400)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('close', save)
}
