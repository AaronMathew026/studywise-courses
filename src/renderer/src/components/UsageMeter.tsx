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
    void api.ai.limits().then(setU)
    return onEvent((ev) => ev.type === 'usage' && setU(ev.usage))
  }, [])
  return u
}

export const tone = (x: number) => (x >= 0.9 ? 'bad' : x >= 0.75 ? 'warn' : 'ok')

/** Small Claude plan-usage readout for the nav: the 5-hour window, with the weekly one in the tooltip. */
export function UsageMeter() {
  const u = useUsage()
  const go = useStore((s) => s.go)
  const w = u?.fiveHour ?? u?.sevenDay
  if (!u || !w) return null
  const pct = Math.round(w.utilization * 100)
  const t = tone(w.utilization)
  const title = [
    u.fiveHour && `5-hour limit: ${Math.round(u.fiveHour.utilization * 100)}% used, ${resetText(u.fiveHour)}`,
    u.sevenDay && `Weekly limit: ${Math.round(u.sevenDay.utilization * 100)}% used, ${resetText(u.sevenDay)}`,
    `Updated ${new Date(u.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <button onClick={() => go({ name: 'settings', tab: 'usage' })} title={title} className="no-drag hidden h-8 items-center gap-2 rounded-lg px-2 text-[0.8rem] text-muted transition-colors hover:bg-surface-2 hover:text-ink md:flex">
      <span>Claude</span>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        <span className={cx('absolute inset-y-0 left-0 rounded-full', t === 'bad' ? 'bg-bad' : t === 'warn' ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
      <span className={cx('tabular', t === 'bad' && 'text-bad', t === 'warn' && 'text-warn')}>{pct}%</span>
    </button>
  )
}

export function UsageBars() {
  const u = useUsage()
  if (!u || (!u.fiveHour && !u.sevenDay)) return <p className="text-[0.9rem] text-muted">Plan usage appears here after the first AI call.</p>
  const rows: [string, UsageWindow | null][] = [
    ['5-hour window', u.fiveHour],
    ['Weekly', u.sevenDay]
  ]
  return (
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
  )
}
