import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { paths } from './paths'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
  v?: number
}

const VERSION = 3

/** First launch: most of the screen, centred. */
function defaultState(): WindowState {
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(area.width, Math.max(1180, Math.round(area.width * 0.75)))
  const height = Math.min(area.height, Math.max(780, Math.round(area.height * 0.82)))
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, maximized: false, v: VERSION }
}

export function loadWindowState(): WindowState {
  const DEFAULT = defaultState()
  try {
    const s = JSON.parse(readFileSync(paths.windowState, 'utf8')) as WindowState
    if (s.v !== VERSION) return DEFAULT
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
    const s: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized(), v: VERSION }
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
