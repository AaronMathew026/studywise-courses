import type { ReactNode } from 'react'
import { cx } from './ui'

export function Shell({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cx('mx-auto w-full px-[clamp(16px,3.2vw,40px)] pt-8 pb-16', wide ? 'max-w-[1400px]' : 'max-w-[1120px]', className)}>{children}</div>
}

export function PageTitle({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[0.85rem] text-muted">{eyebrow}</div>}
        <h1 className="text-[clamp(1.45rem,2.4vw,1.85rem)] leading-tight font-semibold tracking-[-0.022em]">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'good' | 'warn' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[0.82rem] text-muted">{label}</div>
      <div className={cx('tabular mt-1 text-[1.6rem] leading-tight font-semibold tracking-tight', tone === 'accent' && 'text-accent', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-1.5 text-[0.85rem] text-muted">{sub}</div>}
    </div>
  )
}
