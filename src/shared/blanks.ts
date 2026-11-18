// Two sources of blanks:
//  1. Runs of ___ in a cloze card's question, with the answers as ordered bullets.
//  2. **bold** words in a card's back.

export interface BlankSegment {
  type: 'text' | 'blank'
  value: string // text, or the expected answer for a blank
}

export interface BlankItem {
  /** Sentence split into text + blank segments */
  segments: BlankSegment[]
  answers: string[]
  source: 'cloze' | 'bold'
}

const BLANK_RUN = /_{3,}/g
const BOLD = /\*\*([^*\n]+?)\*\*/g

export function clozeBlanks(front: string, answers: string[]): BlankItem | null {
  const parts = front.split(BLANK_RUN)
  if (parts.length < 2) return null
  const segments: BlankSegment[] = []
  parts.forEach((p, i) => {
    if (p) segments.push({ type: 'text', value: p })
    if (i < parts.length - 1) segments.push({ type: 'blank', value: answers[i] ?? '' })
  })
  return { segments, answers: answers.slice(0, parts.length - 1), source: 'cloze' }
}

export function boldBlanks(back: string): BlankItem | null {
  const matches = [...back.matchAll(BOLD)]
  if (matches.length === 0) return null
  const segments: BlankSegment[] = []
  let last = 0
  for (const m of matches) {
    const start = m.index ?? 0
    if (start > last) segments.push({ type: 'text', value: back.slice(last, start) })
    segments.push({ type: 'blank', value: m[1].trim() })
    last = start + m[0].length
  }
  if (last < back.length) segments.push({ type: 'text', value: back.slice(last) })
  return { segments, answers: matches.map((m) => m[1].trim()), source: 'bold' }
}

export function cardBlanks(card: { front: string; back: string; kind: string; cloze_answers: string[] }): BlankItem | null {
  if (card.kind === 'cloze') {
    const c = clozeBlanks(card.front, card.cloze_answers)
    if (c && c.answers.length > 0 && c.answers.every((a) => a.trim())) return c
  }
  return boldBlanks(card.back)
}

export function hasBlanks(card: { front: string; back: string; kind: string; cloze_answers: string[] }): boolean {
  return cardBlanks(card) !== null
}
