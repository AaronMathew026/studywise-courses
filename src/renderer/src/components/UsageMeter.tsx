import { useEffect, useState } from 'react'
import type { UsageLimits, UsageWindow } from '@shared/types'
import { api, onEvent } from '../lib/api'
import { useStore } from '../lib/store'
import { cx } from './ui'

function resetText(w: UsageWindow | null): string {
  if (!w?.resetsAt) return ''
  const d = new Date(w.resetsAt * 1000)
  const mins = Math.round((d.getTime() - Date.now()) / 60000)
  if (mins <= 0) return 'resets now'
  if (mins < 60) return `resets in ${mins}m`
  if (mins < 24 * 60) return `resets ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  return `resets ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export function useUsage(): UsageLimits | null {
  const [u, setU] = useState<UsageLimits | null>(null)
  useEffect(() => {
    const load = () => void api.ai.limits().then(setU)
    load()
    // Re-read every minute so a window that has reset drops back to 0%.
    const t = setInterval(load, 60_000)
    const off = onEvent((ev) => ev.type === 'usage' && load())
    return () => {
      clearInterval(t)
      off()
    }
  }, [])
  return u
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString()
}

export const tone = (x: number) => (x >= 0.9 ? 'bad' : x >= 0.75 ? 'warn' : 'ok')

/** Claude plan usage for the nav: the 5-hour window as a small bar with the
 * percentage inside. The weekly figure is in the tooltip and Settings. */
export function UsageMeter() {
  const u = useUsage()
  const go = useStore((s) => s.go)
  const w = u?.fiveHour
  if (!u || !w) return null
  const pct = Math.round(w.utilization * 100)
  const t = tone(w.utilization)
  const fill = t === 'bad' ? 'var(--bad)' : t === 'warn' ? 'var(--warn)' : 'var(--accent)'
  const title = [
    `Claude usage, 5-hour window: ${pct}%, ${resetText(w)}`,
    u.sevenDay && `Weekly: ${Math.round(u.sevenDay.utilization * 100)}%, ${resetText(u.sevenDay)}`,
    `As of ${ago(u.updatedAt)}`
  ]
    .filter(Boolean)
    .join('\n')
  const label = <span className="tabular text-[0.72rem] font-semibold">{pct}%</span>
  return (
    <button
      onClick={() => go({ name: 'settings', tab: 'usage' })}
      title={title}
      aria-label={`Claude usage ${pct}%`}
      className="no-drag relative hidden h-[18px] w-14 overflow-hidden rounded-[5px] bg-surface-2 ring-1 ring-line md:block"
    >
      <span className="absolute inset-0 grid place-items-center text-muted">{label}</span>
      {/* The filled part, with the label repeated in white and clipped to it. */}
      <span className="absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-700 ease-out-soft" style={{ width: `${pct}%`, background: fill }}>
        <span className="absolute inset-y-0 left-0 grid w-14 place-items-center text-white">{label}</span>
      </span>
    </button>
  )
}

export function UsageBars() {
  const fromHook = useUsage()
  const [fresh, setFresh] = useState<UsageLimits | null>(null)
  const [busy, setBusy] = useState(false)
  const u = fresh ?? fromHook
  const refresh = async () => {
    setBusy(true)
    try {
      setFresh(await api.ai.refreshLimits())
    } finally {
      setBusy(false)
    }
  }
  const refreshBtn = (
    <button onClick={refresh} disabled={busy} className="text-[0.85rem] text-accent hover:underline disabled:opacity-50">
      {busy ? 'Checking…' : 'Refresh'}
    </button>
  )
  if (!u || (!u.fiveHour && !u.sevenDay))
    return (
      <p className="text-[0.9rem] text-muted">
        Claude reports plan usage with each AI call, so it appears here after the first one. {refreshBtn}
      </p>
    )
  const rows: [string, UsageWindow | null][] = [
    ['5-hour window', u.fiveHour],
    ['Weekly', u.sevenDay]
  ]
  return (
    <div className="flex flex-col gap-3">
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map(([label, w]) =>
        w ? (
          <div key={label}>
            <div className="mb-1.5 flex items-baseline justify-between text-[0.88rem]">
              <span>{label}</span>
              <span className="tabular text-muted">
                {Math.round(w.utilization * 100)}% · {resetText(w)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={cx('h-full rounded-full', tone(w.utilization) === 'bad' ? 'bg-bad' : tone(w.utilization) === 'warn' ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.round(w.utilization * 100)}%` }} />
            </div>
          </div>
        ) : null
      )}
    </div>
    <p className="text-[0.82rem] text-muted">
      As of {ago(u.updatedAt)}. {refreshBtn} <span className="opacity-70">(makes one tiny Haiku call)</span>
    </p>
    </div>
  )
}
