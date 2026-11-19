import type { UsageLimits, UsageWindow } from '@shared/types'
import { onRateLimit } from './ai/cli'
import { getSetting, setSetting } from './db/repo'

// Plan usage as reported by Claude Code's rate_limit_event lines. Updated on
// every AI call; the last value is kept so the meter shows something at startup.

let current: UsageLimits | null = null
type Listener = (u: UsageLimits) => void
const listeners = new Set<Listener>()

function win(w: unknown): UsageWindow | null {
  if (!w || typeof w !== 'object') return null
  const o = w as Record<string, unknown>
  if (typeof o.utilization !== 'number') return null
  return { utilization: o.utilization, resetsAt: typeof o.resetsAt === 'number' ? o.resetsAt : null, status: String(o.status ?? 'allowed') }
}

export function parseRateLimit(info: Record<string, unknown>): UsageLimits {
  const windows = (info.unifiedWindows ?? {}) as Record<string, unknown>
  let fiveHour = win(windows.five_hour)
  const sevenDay = win(windows.seven_day)
  if (!fiveHour && info.rateLimitType === 'five_hour') fiveHour = win(info)
  return { fiveHour, sevenDay, status: String(info.status ?? 'allowed'), updatedAt: new Date().toISOString() }
}

export function setUsage(u: UsageLimits): void {
  current = u
  try {
    setSetting('usage.limits', u)
  } catch {
    /* db closed */
  }
  listeners.forEach((l) => l(u))
}

export function startUsageTracking(): void {
  current = getSetting<UsageLimits | null>('usage.limits', null)
  onRateLimit((info) => setUsage(parseRateLimit(info)))
}

/** Windows whose reset time has passed are back to 0%. */
function settle(u: UsageLimits | null): UsageLimits | null {
  if (!u) return u
  const now = Date.now() / 1000
  const fix = (w: UsageWindow | null) => (w && w.resetsAt && w.resetsAt < now ? { ...w, utilization: 0, status: 'allowed', resetsAt: null } : w)
  return { ...u, fiveHour: fix(u.fiveHour), sevenDay: fix(u.sevenDay) }
}

export function getUsage(): UsageLimits | null {
  return settle(current)
}

export function onUsage(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
