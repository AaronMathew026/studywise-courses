import { useEffect, useState } from 'react'
import { Square, Eye, Trash2, Loader2, CheckCircle2, XCircle, Ban, FileText, Layers } from 'lucide-react'
import type { JobInfo } from '@shared/types'
import { useStore } from '../lib/store'
import { api, onEvent } from '../lib/api'
import { Shell, PageTitle } from '../components/Shell'
import { Button, Card, Empty, Pill, cx } from '../components/ui'
import { Markdown } from '../components/Markdown'

function elapsed(j: JobInfo): string {
  const end = j.finishedAt ? new Date(j.finishedAt).getTime() : Date.now()
  const s = Math.round((end - new Date(j.createdAt).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function Jobs() {
  const jobs = useStore((s) => s.jobs)
  const go = useStore((s) => s.go)
  const [, tick] = useState(0)
  const [live, setLive] = useState<Record<string, string>>({})

  useEffect(() => {
    void api.jobs.list().then((j) => useStore.getState().setJobs(j))
    const t = setInterval(() => tick((n) => n + 1), 1000)
    const off = onEvent((ev) => {
      if (ev.type === 'job:delta') setLive((cur) => ({ ...cur, [ev.jobId]: ((cur[ev.jobId] ?? '') + ev.text).slice(-1600) }))
    })
    return () => {
      clearInterval(t)
      off()
    }
  }, [])

  return (
    <Shell>
      <PageTitle
        eyebrow="Background"
        title="Jobs"
        actions={
          <Button icon={<Trash2 className="size-4" />} onClick={() => api.jobs.clear().then(() => api.jobs.list()).then((j) => useStore.getState().setJobs(j))}>
            Clear finished
          </Button>
        }
      >
        Long AI jobs keep running when you close the window. Studywise stays in the Dock and notifies you when they finish.
      </PageTitle>
      {jobs.length === 0 ? (
        <Empty icon={<Layers className="size-6" />} title="No jobs yet">
          Generate notes or flashcards and they’ll show up here with live progress.
        </Empty>
      ) : (
        <div className="stagger flex flex-col gap-3">
          {jobs.map((j) => (
            <Card key={j.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cx(
                    'grid size-10 place-items-center rounded-full',
                    j.status === 'running' ? 'bg-accent-soft text-accent' : j.status === 'done' ? 'bg-good-soft text-good' : j.status === 'error' ? 'bg-bad-soft text-bad' : 'bg-surface-2 text-muted'
                  )}
                >
                  {j.status === 'running' ? <Loader2 className="size-5 animate-spin" /> : j.status === 'done' ? <CheckCircle2 className="size-5" /> : j.status === 'error' ? <XCircle className="size-5" /> : <Ban className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{j.title}</div>
                  <div className="truncate text-[0.88rem] text-muted">{j.error ?? j.progress}</div>
                </div>
                <Pill>{elapsed(j)}</Pill>
                {j.status === 'running' && (
                  <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={() => api.jobs.cancel({ id: j.id })}>
                    Cancel
                  </Button>
                )}
                {j.status === 'done' && j.kind === 'generate_cards' && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Eye className="size-3.5" />}
                    onClick={() => {
                      const r = j.result as { cards: never[]; presetName: string }
                      useStore.getState().openPreview({ cards: r.cards, deckId: null, jobId: j.id, presetName: r.presetName })
                    }}
                  >
                    Review {(j.result as { cards: unknown[] }).cards.length} cards
                  </Button>
                )}
                {typeof j.meta?.noteId === 'string' && (
                  <Button size="sm" variant="soft" icon={<FileText className="size-3.5" />} onClick={() => go({ name: 'notes', id: j.meta.noteId as string })}>
                    Open note
                  </Button>
                )}
              </div>
              {j.status === 'running' && live[j.id] && (
                <div className="relative max-h-40 overflow-hidden rounded-lg bg-surface-2 p-3 text-[0.85rem]">
                  <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-surface-2 to-transparent" />
                  <Markdown streaming>{live[j.id]}</Markdown>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  )
}
