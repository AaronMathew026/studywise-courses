// SM-2 scheduling with four buttons.
// Again=1, Hard=2, Good=3, Easy=4 map to SM-2 quality 1, 3, 4, 5.

export interface Sm2State {
  ease: number
  interval: number // days
  repetitions: number
  lapses: number
  due: string // ISO date-time
  last_reviewed: string | null
}

export const QUALITY: Record<1 | 2 | 3 | 4, number> = { 1: 1, 2: 3, 3: 4, 4: 5 }

export function newSm2State(now = new Date()): Sm2State {
  return { ease: 2.5, interval: 0, repetitions: 0, lapses: 0, due: now.toISOString(), last_reviewed: null }
}

const DAY = 24 * 60 * 60 * 1000

export function review(state: Sm2State, rating: 1 | 2 | 3 | 4, now = new Date()): Sm2State {
  const q = QUALITY[rating]
  let { ease, interval, repetitions, lapses } = state
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))

  let due: Date
  if (q < 3) {
    repetitions = 0
    lapses += 1
    interval = 0
    due = new Date(now.getTime() + 10 * 60 * 1000) // again in 10 minutes
  } else {
    if (repetitions === 0) interval = rating === 4 ? 4 : 1
    else if (repetitions === 1) interval = rating === 2 ? 3 : 6
    else interval = Math.round(interval * ease * (rating === 2 ? 0.8 : rating === 4 ? 1.3 : 1))
    if (rating === 2) interval = Math.max(1, Math.round(interval))
    repetitions += 1
    due = new Date(now.getTime() + interval * DAY)
  }
  return { ease: Math.round(ease * 1000) / 1000, interval, repetitions, lapses, due: due.toISOString(), last_reviewed: now.toISOString() }
}

/** Learn-mode verdicts feed SM-2 too. */
export function ratingForVerdict(verdict: 'correct' | 'partial' | 'wrong'): 1 | 2 | 3 | 4 {
  return verdict === 'correct' ? 3 : verdict === 'partial' ? 2 : 1
}

export function isDue(state: Pick<Sm2State, 'due'> | null | undefined, now = new Date()): boolean {
  if (!state) return true
  return new Date(state.due).getTime() <= endOfDay(now).getTime()
}

export function endOfDay(d: Date): Date {
  const e = new Date(d)
  e.setHours(23, 59, 59, 999)
  return e
}

/** Mastered = reviewed successfully with an interval of 21+ days, partially
 * weighted by interval below that. Returns 0..1. */
export function masteryOf(state: Pick<Sm2State, 'interval' | 'repetitions'> | null | undefined): number {
  if (!state || state.repetitions === 0) return 0
  return Math.min(1, state.interval / 21)
}
