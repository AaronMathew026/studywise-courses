import { describe, it, expect } from 'vitest'
import { clozeBlanks, boldBlanks, cardBlanks } from '@shared/blanks'
import { markInCode, markFillBlankExact, blankMatches, verdictFor, fillBlankFromAi } from '@shared/marking'
import type { LearnQuestion } from '@shared/questions'

describe('blanks', () => {
  it('cloze: ___ runs with ordered answers', () => {
    const b = clozeBlanks('The ____ of a ________ is fixed', ['mass', 'proton'])!
    expect(b.answers).toEqual(['mass', 'proton'])
    expect(b.segments.filter((s) => s.type === 'blank').map((s) => s.value)).toEqual(['mass', 'proton'])
    expect(b.segments[0]).toEqual({ type: 'text', value: 'The ' })
  })
  it('bold words in the back', () => {
    const b = boldBlanks('the **minimum energy** to remove an **electron**')!
    expect(b.answers).toEqual(['minimum energy', 'electron'])
    expect(b.source).toBe('bold')
  })
  it('cardBlanks prefers cloze, falls back to bold, else null', () => {
    expect(cardBlanks({ kind: 'cloze', front: 'A ___', back: 'x', cloze_answers: ['x'] })?.source).toBe('cloze')
    expect(cardBlanks({ kind: 'regular', front: 'Q', back: 'a **b**', cloze_answers: [] })?.source).toBe('bold')
    expect(cardBlanks({ kind: 'regular', front: 'Q', back: 'plain', cloze_answers: [] })).toBeNull()
  })
})

const q = <T extends LearnQuestion['type']>(type: T, payload: unknown) => ({ id: 'q', type, card_id: 'c', card_ids: ['c'], payload, cached: false }) as LearnQuestion

describe('deterministic marking', () => {
  it('multiple choice and true/false', () => {
    const mc = q('multiple_choice', { question: 'x', options: ['a', 'b', 'c', 'd'], correct_index: 2 })
    expect(markInCode(mc, { type: 'multiple_choice', index: 2 })?.verdict).toBe('correct')
    expect(markInCode(mc, { type: 'multiple_choice', index: 0 })?.verdict).toBe('wrong')
    const tf = q('true_false', { statement: 's', is_true: false, correction: '' })
    expect(markInCode(tf, { type: 'true_false', value: false })?.score).toBe(10)
    expect(markInCode(tf, { type: 'true_false', value: true })?.score).toBe(0)
  })
  it('match pairs: all right is correct, some wrong is partial/wrong', () => {
    const mp = q('match_pairs', { pairs: [0, 1, 2, 3].map((i) => ({ left: `l${i}`, right: `r${i}`, card_id: `c${i}` })) })
    expect(markInCode(mp, { type: 'match_pairs', mapping: { 0: 0, 1: 1, 2: 2, 3: 3 } })?.verdict).toBe('correct')
    const half = markInCode(mp, { type: 'match_pairs', mapping: { 0: 0, 1: 1, 2: 3, 3: 2 } })!
    expect(half.verdict).toBe('partial')
    expect(half.detail?.wrongItems).toEqual([2, 3])
    expect(markInCode(mp, { type: 'match_pairs', mapping: { 0: 1, 1: 0, 2: 3, 3: 2 } })?.verdict).toBe('wrong')
  })
  it('categorize compares categories case-insensitively', () => {
    const cat = q('categorize', { categories: ['A', 'B'], items: [{ text: 'x', category: 'A' }, { text: 'y', category: 'B' }, { text: 'z', category: 'A' }, { text: 'w', category: 'B' }] })
    expect(markInCode(cat, { type: 'categorize', assignments: { 0: 'a', 1: 'B', 2: 'A', 3: 'B' } })?.verdict).toBe('correct')
    expect(markInCode(cat, { type: 'categorize', assignments: { 0: 'B', 1: 'B', 2: 'A', 3: 'B' } })?.detail?.wrongItems).toEqual([0])
  })
  it('choice blank: every blank must match', () => {
    const cb = q('choice_blank', { prompt: '', segments: [], answers: ['mass', 'proton'], choices: [['mass', 'x'], ['proton', 'y']] })
    expect(markInCode(cb, { type: 'choice_blank', values: ['mass', 'proton'] })?.verdict).toBe('correct')
    expect(markInCode(cb, { type: 'choice_blank', values: ['mass', 'y'] })?.verdict).toBe('wrong')
  })
  it('free answer needs AI (returns null); read & understand is always fine', () => {
    expect(markInCode(q('free_answer', { question: 'q', expected_answer: 'a' }), { type: 'free_answer', text: 'a' })).toBeNull()
    expect(markInCode(q('read_understand', { title: '', explanation: 'x' }), { type: 'read_understand' })?.verdict).toBe('correct')
  })
})

describe('fill in the blank', () => {
  it('exact match after normalising case, punctuation and plurals', () => {
    expect(blankMatches(' Photons. ', 'photon')).toBe(true)
    expect(blankMatches('**Energy**', 'energy')).toBe(true)
    expect(blankMatches('batteries', 'battery')).toBe(true)
    expect(blankMatches('electron', 'proton')).toBe(false)
  })
  it('all exact → correct without AI', () => {
    const r = markFillBlankExact(['mass', 'Protons'], ['mass', 'proton'])
    expect(r.needsAi).toBe(false)
    expect(r.mark?.verdict).toBe('correct')
  })
  it('an empty blank is wrong without AI', () => {
    const r = markFillBlankExact(['mass', ''], ['mass', 'proton'])
    expect(r.needsAi).toBe(false)
    expect(r.mark?.verdict).toBe('wrong')
  })
  it('a non-matching blank goes to AI, and any wrong blank fails the whole answer', () => {
    const r = markFillBlankExact(['mass', 'protn'], ['mass', 'proton'])
    expect(r.needsAi).toBe(true)
    expect(r.blanks).toEqual([true, false])
    expect(fillBlankFromAi([true, false]).verdict).toBe('wrong')
    expect(fillBlankFromAi([true, true]).verdict).toBe('correct')
  })
  it('thresholds: ≥8 correct, 4–7 partial, ≤3 wrong, and configurable', () => {
    expect(verdictFor(8)).toBe('correct')
    expect(verdictFor(7)).toBe('partial')
    expect(verdictFor(4)).toBe('partial')
    expect(verdictFor(3)).toBe('wrong')
    expect(verdictFor(7, { correct: 7, partial: 5 })).toBe('correct')
    expect(verdictFor(4, { correct: 7, partial: 5 })).toBe('wrong')
  })
})
