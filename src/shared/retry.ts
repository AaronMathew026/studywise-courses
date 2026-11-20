// Getting something wrong in a session brings it back a little later in the
// same session, and again each time it's missed, until it's right. Flashcards,
// Learn and course topics all use this.

/** How many other items come between a miss and its retry (fewer near the end). */
export const RETRY_GAP = 3

/** Where a missed item goes back in: a few places on, never past `end` (default: the end). */
export function retryPosition(current: number, length: number, end = length, gap = RETRY_GAP): number {
  return Math.max(current + 1, Math.min(current + 1 + gap, end, length))
}

/** A copy of the list with `item` inserted at its retry position. */
export function insertRetry<T>(list: T[], current: number, item: T, end = list.length, gap = RETRY_GAP): { list: T[]; at: number } {
  const at = retryPosition(current, list.length, end, gap)
  return { list: [...list.slice(0, at), item, ...list.slice(at)], at }
}
