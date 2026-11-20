import type { AiLiveEvent } from '../ai'
import type { JobContext } from '../jobs'
import type { JobLive } from '@shared/types'

// Turns Claude's live stream (file reads, thinking-token counts, the JSON it's
// writing) into a progress bar, a short activity log and a preview of the part
// being written right now.

type Live = NonNullable<JobContext['live']>

/** Unescape a JSON string body that may be cut off part-way. */
export function partialString(s: string): string {
  const body = s.replace(/\\$/, '')
  try {
    return JSON.parse(`"${body}"`) as string
  } catch {
    return body.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, ' ').replace(/\\\\/g, '\\')
  }
}

/** Every complete value of "key": "…" so far, plus the one still being written. */
export function stringValues(json: string, key: string): { done: string[]; open: string | null } {
  const done: string[] = []
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`, 'g')
  let open: string | null = null
  for (const m of json.matchAll(re)) {
    if (m[2] === '"') done.push(partialString(m[1]))
    else open = partialString(m[1])
  }
  return { done, open }
}

const keyAt = (json: string, key: string) => json.search(new RegExp(`"${key}"\\s*:`))

class Tracker {
  log: string[] = []
  out = ''
  tokens = 0
  constructor(
    protected live: Live,
    protected from: number,
    protected to: number
  ) {}
  /** Map 0–1 within this call onto the job's overall bar. */
  pct(x: number): number {
    return this.from + (this.to - this.from) * Math.max(0, Math.min(1, x))
  }
  step(line: string): void {
    if (this.log[this.log.length - 1] === line) return
    this.log = [...this.log.slice(-7), line]
  }
  base(e: AiLiveEvent): Partial<JobLive> | null {
    if (e.kind === 'read') {
      this.step(`Read ${e.file}${e.pages ? ` (pages ${e.pages})` : ''}`)
      return { stage: `Reading ${e.file}…`, log: this.log }
    }
    if (e.kind === 'thinking') {
      if (e.tokens) this.tokens = e.tokens
      if (!this.out) this.step('Thinking')
      return { thinking: true, thinkingTokens: this.tokens, log: this.log }
    }
    return null
  }
}

/** Writing one topic: sections, then the check, then the recall cards. */
export function topicTracker(live: Live, plannedSections: number, from = 0.1, to = 0.9): (e: AiLiveEvent) => void {
  const t = new Tracker(live, from, to)
  let reads = 0
  return (e) => {
    const b = t.base(e)
    if (e.kind === 'read') reads++
    if (b) {
      // Reading takes the first 15% of this call, thinking creeps up to 30%.
      const pre = e.kind === 'read' ? Math.min(0.15, reads * 0.05) : Math.min(0.3, 0.15 + t.tokens / 40_000)
      return live({ ...b, stage: b.stage ?? (t.out ? undefined : `Thinking… (~${(t.tokens / 1000).toFixed(1)}k tokens)`), percent: t.out ? undefined : t.pct(pre) })
    }
    if (e.kind !== 'output') return
    t.out += e.text
    const heads = stringValues(t.out, 'heading')
    const n = heads.done.length + (heads.open !== null ? 1 : 0)
    const total = Math.max(plannedSections, n, 1)
    const notes = stringValues(t.out, 'notes')
    const checkAt = keyAt(t.out, 'check')
    const cardsAt = keyAt(t.out, 'cards')
    let stage: string
    let x: number
    let preview: JobLive['preview'] = null
    if (cardsAt >= 0) {
      const cards = stringValues(t.out.slice(cardsAt), 'front').done.length
      stage = `Writing recall cards (${cards})`
      x = 0.92 + Math.min(0.08, cards * 0.006)
      t.step('Writing recall cards')
    } else if (checkAt >= 0) {
      const qs = (t.out.slice(checkAt).match(/"type"\s*:/g) ?? []).length
      stage = `Writing the topic check (${qs} question${qs === 1 ? '' : 's'})`
      x = 0.84 + Math.min(0.08, qs * 0.012)
      t.step('Writing the topic check')
    } else if (n > 0) {
      const heading = heads.open ?? heads.done[n - 1]
      const writingNotes = notes.open !== null || notes.done.length < n
      stage = `Writing section ${n} of ${total}: ${heading}`
      // Within a section, notes are roughly the first half and its questions the rest.
      x = 0.3 + 0.54 * ((n - 1 + (writingNotes ? 0.4 : 0.8)) / total)
      if (heads.done.length === n) t.step(`Section ${n}: ${heading}`)
      const text = notes.open ?? (notes.done.length >= n ? notes.done[n - 1] : '')
      preview = { heading, text: writingNotes ? text : `${text}\n\n_Writing questions…_` }
    } else {
      stage = 'Starting to write…'
      x = 0.3
    }
    live({ stage, log: t.log, percent: t.pct(x), preview, thinking: false })
  }
}

/** Planning a week: topics appear one by one, total unknown. */
export function planTracker(live: Live, from = 0.1, to = 0.95): (e: AiLiveEvent) => void {
  const t = new Tracker(live, from, to)
  return (e) => {
    const b = t.base(e)
    if (b) return live({ ...b, stage: b.stage ?? (t.out ? undefined : `Thinking… (~${(t.tokens / 1000).toFixed(1)}k tokens)`), percent: t.out ? undefined : t.pct(Math.min(0.35, 0.1 + t.tokens / 30_000)) })
    if (e.kind !== 'output') return
    t.out += e.text
    const titles = stringValues(t.out, 'title')
    const all = titles.open !== null ? [...titles.done, titles.open] : titles.done
    const current = all[all.length - 1]
    if (titles.done.length) t.step(`Topic: ${titles.done[titles.done.length - 1]}`)
    live({
      stage: all.length ? `Found ${all.length} topic${all.length === 1 ? '' : 's'}: ${current}` : 'Starting the plan…',
      log: t.log,
      percent: t.pct(0.35 + 0.6 * (1 - Math.exp(-titles.done.length / 6))),
      preview: all.length ? { heading: 'Topics so far', text: all.map((x, i) => `${i + 1}. ${x}`).join('\n') } : null,
      thinking: false
    })
  }
}

/** Anything else (notes, cards): thinking and output size, no stages. */
export function simpleTracker(live: Live, from: number, to: number, label: string): (e: AiLiveEvent) => void {
  const t = new Tracker(live, from, to)
  return (e) => {
    const b = t.base(e)
    if (b) return live({ ...b, percent: t.out ? undefined : t.pct(Math.min(0.3, t.tokens / 30_000)) })
    if (e.kind !== 'output') return
    t.out += e.text
    live({ stage: label, log: t.log, thinking: false, percent: t.pct(0.3 + 0.7 * (1 - Math.exp(-t.out.length / 12_000))) })
  }
}
