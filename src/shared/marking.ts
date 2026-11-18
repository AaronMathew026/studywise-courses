import type { LearnQuestion, LearnAnswer, Mark, Verdict } from './questions'
import type { Thresholds } from './types'
import { DEFAULT_THRESHOLDS } from './types'

export function verdictFor(score: number, t: Thresholds = DEFAULT_THRESHOLDS): Verdict {
  if (score >= t.correct) return 'correct'
  if (score >= t.partial) return 'partial'
  return 'wrong'
}

/** Lower-case, trim, drop punctuation and markdown, collapse spaces. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`~]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}.\s+-]/gu, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 3 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** Exact match after normalisation, allowing simple plurals. */
export function blankMatches(given: string, expected: string): boolean {
  const a = normalizeAnswer(given)
  const b = normalizeAnswer(expected)
  if (!a) return false
  if (a === b) return true
  const sa = a.split(' ').map(singular).join(' ')
  const sb = b.split(' ').map(singular).join(' ')
  return sa === sb
}

/**
 * Code marking for fill-in-the-blank. Returns a final mark when every blank
 * matches exactly, or when a blank is empty (always wrong). Otherwise returns
 * the per-blank result and `needsAi: true`.
 */
export function markFillBlankExact(values: string[], answers: string[]): { blanks: boolean[]; needsAi: boolean; mark: Mark | null } {
  const blanks = answers.map((exp, i) => blankMatches(values[i] ?? '', exp))
  if (blanks.every(Boolean)) return { blanks, needsAi: false, mark: { score: 10, verdict: 'correct', detail: { blanks }, by: 'code' } }
  if (answers.some((_, i) => !(values[i] ?? '').trim())) {
    return { blanks, needsAi: false, mark: { score: 0, verdict: 'wrong', detail: { blanks }, by: 'code' } }
  }
  return { blanks, needsAi: true, mark: null }
}

/** All-or-nothing: any wrong blank makes the whole answer wrong. */
export function fillBlankFromAi(blanks: boolean[]): Mark {
  const ok = blanks.length > 0 && blanks.every(Boolean)
  return { score: ok ? 10 : 0, verdict: ok ? 'correct' : 'wrong', detail: { blanks }, by: 'ai' }
}

function fraction(correct: number, total: number, t?: Thresholds): Mark {
  const score = total === 0 ? 0 : Math.round((correct / total) * 100) / 10
  // Collections are only "correct" when everything is right.
  const verdict: Verdict = correct === total ? 'correct' : verdictFor(score, t) === 'correct' ? 'partial' : verdictFor(score, t)
  return { score, verdict, by: 'code' }
}

/** Deterministic marking for the types marked in code. Returns null for types that need AI. */
export function markInCode(q: LearnQuestion, a: LearnAnswer, t?: Thresholds): Mark | null {
  if (q.type !== a.type) throw new Error(`Answer type ${a.type} does not match question type ${q.type}`)
  switch (q.type) {
    case 'read_understand':
      return { score: 10, verdict: 'correct', by: 'code' }
    case 'multiple_choice': {
      const ok = (a as { index: number }).index === q.payload.correct_index
      return { score: ok ? 10 : 0, verdict: ok ? 'correct' : 'wrong', by: 'code' }
    }
    case 'true_false': {
      const ok = (a as { value: boolean }).value === q.payload.is_true
      return { score: ok ? 10 : 0, verdict: ok ? 'correct' : 'wrong', by: 'code' }
    }
    case 'match_pairs': {
      const mapping = (a as { mapping: Record<number, number> }).mapping
      const wrongItems: number[] = []
      q.payload.pairs.forEach((_, i) => {
        if (mapping[i] !== i) wrongItems.push(i)
      })
      const m = fraction(q.payload.pairs.length - wrongItems.length, q.payload.pairs.length, t)
      return { ...m, detail: { wrongItems } }
    }
    case 'categorize': {
      const assignments = (a as { assignments: Record<number, string> }).assignments
      const wrongItems: number[] = []
      q.payload.items.forEach((item, i) => {
        if (normalizeAnswer(assignments[i] ?? '') !== normalizeAnswer(item.category)) wrongItems.push(i)
      })
      const m = fraction(q.payload.items.length - wrongItems.length, q.payload.items.length, t)
      return { ...m, detail: { wrongItems } }
    }
    case 'choice_blank': {
      const values = (a as { values: string[] }).values
      const blanks = q.payload.answers.map((exp, i) => normalizeAnswer(values[i] ?? '') === normalizeAnswer(exp))
      const ok = blanks.every(Boolean)
      return { score: ok ? 10 : 0, verdict: ok ? 'correct' : 'wrong', detail: { blanks }, by: 'code' }
    }
    case 'fill_blank': {
      const r = markFillBlankExact((a as { values: string[] }).values, q.payload.answers)
      return r.mark
    }
    case 'free_answer':
      return null
  }
}
