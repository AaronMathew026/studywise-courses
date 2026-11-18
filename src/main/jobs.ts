import { randomUUID } from 'node:crypto'
import type { JobInfo } from '@shared/types'

// Long AI jobs (note/card generation) run here in the main process, so they
// keep going when the window is closed. Cancelling aborts the signal, which
// kills the claude child process.

export interface JobContext {
  signal: AbortSignal
  progress: (msg: string) => void
  /** Streamed text for the renderer (e.g. notes appearing in the editor). */
  delta: (text: string) => void
  /** Small facts the UI needs early, e.g. the id of the note being written. */
  meta: (m: Record<string, unknown>) => void
}

type Listener = (ev: { type: 'update'; job: JobInfo } | { type: 'delta'; jobId: string; text: string }) => void

const jobs = new Map<string, JobInfo & { controller: AbortController }>()
const listeners = new Set<Listener>()

export function onJobEvent(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
const emit: Listener = (ev) => listeners.forEach((l) => l(ev))

const publicInfo = (j: JobInfo & { controller?: AbortController }): JobInfo => {
  const { controller: _c, ...rest } = j as JobInfo & { controller?: AbortController }
  return rest
}

export function startJob<T>(kind: JobInfo['kind'], title: string, run: (ctx: JobContext) => Promise<T>): JobInfo {
  const controller = new AbortController()
  const job: JobInfo & { controller: AbortController } = {
    id: randomUUID(),
    kind,
    title,
    status: 'running',
    progress: 'Starting…',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    result: null,
    meta: {},
    controller
  }
  jobs.set(job.id, job)
  emit({ type: 'update', job: publicInfo(job) })
  const ctx: JobContext = {
    signal: controller.signal,
    progress: (msg) => {
      job.progress = msg
      emit({ type: 'update', job: publicInfo(job) })
    },
    delta: (text) => emit({ type: 'delta', jobId: job.id, text }),
    meta: (m) => {
      job.meta = { ...job.meta, ...m }
      emit({ type: 'update', job: publicInfo(job) })
    }
  }
  run(ctx)
    .then((result) => {
      if (job.status === 'cancelled') return
      job.status = 'done'
      job.result = result
      job.progress = 'Done'
    })
    .catch((e: Error) => {
      if (controller.signal.aborted) {
        job.status = 'cancelled'
        job.progress = 'Cancelled'
      } else {
        job.status = 'error'
        job.error = e?.message ?? String(e)
        job.progress = 'Failed'
      }
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString()
      emit({ type: 'update', job: publicInfo(job) })
    })
  return publicInfo(job)
}

export function cancelJob(id: string): void {
  const j = jobs.get(id)
  if (!j || j.status !== 'running') return
  j.status = 'cancelled'
  j.progress = 'Cancelled'
  j.controller.abort()
  emit({ type: 'update', job: publicInfo(j) })
}

export function listJobs(): JobInfo[] {
  return [...jobs.values()].map(publicInfo).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getJob(id: string): JobInfo | null {
  const j = jobs.get(id)
  return j ? publicInfo(j) : null
}

export function clearFinishedJobs(): void {
  for (const [id, j] of jobs) if (j.status !== 'running') jobs.delete(id)
}

export function runningJobCount(): number {
  return [...jobs.values()].filter((j) => j.status === 'running').length
}
