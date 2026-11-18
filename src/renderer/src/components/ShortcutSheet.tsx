import { useMemo, useState } from 'react'
import { COMMANDS, prettyKey } from '@shared/keymap'
import { useStore } from '../lib/store'
import { Input, Kbd, Modal } from './ui'

export function ShortcutSheet() {
  const open = useStore((s) => s.sheet)
  const setOpen = useStore((s) => s.setSheet)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const m = new Map<string, typeof COMMANDS>()
    for (const c of COMMANDS) {
      if (!c.accelerator && !c.keys?.length) continue
      if (q && !c.label.toLowerCase().includes(q.toLowerCase())) continue
      m.set(c.group, [...(m.get(c.group) ?? []), c])
    }
    return [...m.entries()]
  }, [q])
  const count = COMMANDS.filter((c) => c.accelerator || c.keys?.length).reduce((n, c) => n + (c.accelerator ? 1 : 0) + (c.keys?.length ?? 0), 0)
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={`Keyboard shortcuts · ${count}`} full>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter shortcuts…" className="mb-5" autoFocus />
      <div className="columns-1 gap-8 md:columns-2 xl:columns-3">
        {groups.map(([g, cmds]) => (
          <section key={g} className="mb-6 break-inside-avoid">
            <h3 className="mb-2 text-[0.75rem] font-semibold text-muted">{g}</h3>
            <ul className="flex flex-col">
              {cmds.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-[0.92rem]">
                  <span>{c.label}</span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {[c.accelerator, ...(c.keys ?? [])].filter(Boolean).map((k) => (
                      <Kbd key={k}>{prettyKey(k!)}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
