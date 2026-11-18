import type { StudywiseEvent } from '../../../preload/api'

export const api = window.studywise

type Listener = (ev: StudywiseEvent) => void
const listeners = new Set<Listener>()
api.on((ev) => listeners.forEach((l) => l(ev)))

export function onEvent(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

let seq = 0
/** Run an AI call that streams text; `onText` gets the full text so far. */
export async function streamCall<T>(call: (streamId: string) => Promise<T>, onText: (full: string) => void): Promise<T> {
  const streamId = `s${Date.now().toString(36)}${(seq++).toString(36)}`
  let full = ''
  const off = onEvent((ev) => {
    if (ev.type === 'ai:delta' && ev.streamId === streamId) {
      full += ev.text
      onText(full)
    }
  })
  try {
    return await call(streamId)
  } finally {
    off()
  }
}

export function errorText(e: unknown): string {
  const m = (e as Error)?.message ?? String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
