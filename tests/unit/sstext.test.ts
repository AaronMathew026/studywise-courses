import { describe, it, expect } from 'vitest'
import { parseStudySmarterText, serializeStudySmarterText, parseRequiredPoints, validateCards, looksTruncated, dedupeCards } from '@shared/ssText'

const SAMPLE = `What is the work function?/#*#/the minimum energy needed to remove an electron from the surface of a metal
#
Explain why a threshold frequency exists (2)/#*#/- below the threshold frequency, photons have less energy than the work function

- so they do not have enough energy to remove an electron
#
Each electron can only absorb _________/#*#/one photon of energy`

describe('required points', () => {
  it('reads a trailing (n)', () => {
    expect(parseRequiredPoints('State the 4 benefits of IFT (4)')).toBe(4)
    expect(parseRequiredPoints('Describe how a GM tube works (4)  ')).toBe(4)
  })
  it('ignores missing or mid-sentence numbers', () => {
    expect(parseRequiredPoints('What is the work function?')).toBeNull()
    expect(parseRequiredPoints('What does (2) mean here?')).toBeNull()
  })
})

describe('parseStudySmarterText', () => {
  it('parses the example from the prompt', () => {
    const { cards } = parseStudySmarterText(SAMPLE)
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ front: 'What is the work function?', kind: 'regular', required_points: null })
    expect(cards[1].required_points).toBe(2)
    expect(cards[2]).toMatchObject({ kind: 'cloze', cloze_answers: ['one photon of energy'], required_points: null })
  })

  it('keeps "- " bullets and the blank lines between them', () => {
    const { cards } = parseStudySmarterText(SAMPLE)
    expect(cards[1].back).toBe('- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron')
  })

  it('handles a missing (n)', () => {
    const { cards } = parseStudySmarterText('Name the parts/#*#/- a\n\n- b')
    expect(cards[0].required_points).toBeNull()
    expect(validateCards(cards).map((w) => w.code)).toContain('points_mismatch')
  })

  it('does not split on a "#" inside a line', () => {
    const { cards } = parseStudySmarterText('What is C#?/#*#/a language # not a separator\n#\nQ2/#*#/A2')
    expect(cards).toHaveLength(2)
    expect(cards[0].back).toBe('a language # not a separator')
  })

  it('strips code fences', () => {
    const { cards } = parseStudySmarterText('```\nQ1/#*#/A1\n#\nQ2/#*#/A2\n```')
    expect(cards.map((c) => c.front)).toEqual(['Q1', 'Q2'])
    const lang = parseStudySmarterText('Here you go:\n```text\nQ1/#*#/A1\n```')
    expect(lang.cards.at(-1)?.front).toBe('Q1')
  })

  it('splits only on the first separator', () => {
    const { cards } = parseStudySmarterText('Q/#*#/A with /#*#/ inside')
    expect(cards[0].back).toBe('A with /#*#/ inside')
  })

  it('detects and drops a truncated last card', () => {
    const t1 = parseStudySmarterText('Q1/#*#/A1\n#\nQ2 that got cut', { detectTruncation: true })
    expect(t1.cards).toHaveLength(1)
    expect(t1.truncatedTail).toBe('Q2 that got cut')
    const t2 = parseStudySmarterText('Q1/#*#/A1\n#\nDescribe it (3)/#*#/- one\n\n- tw', { detectTruncation: true })
    expect(t2.cards).toHaveLength(1)
    expect(t2.truncatedTail).not.toBeNull()
    const ok = parseStudySmarterText(SAMPLE, { detectTruncation: true })
    expect(ok.truncatedTail).toBeNull()
    expect(looksTruncated('Q/#*#/')).toBe(true)
  })

  it('maps multi-blank cloze answers from bullets', () => {
    const { cards } = parseStudySmarterText('The ____ of a ____ is fixed/#*#/- mass\n\n- proton')
    expect(cards[0].cloze_answers).toEqual(['mass', 'proton'])
  })
})

describe('validation', () => {
  it('flags every rule', () => {
    const cards = [
      { front: 'Describe X (3)', back: '- a\n\n- b' },
      { front: 'The ___ and ___ (2)', back: '- one' },
      { front: '', back: 'x' },
      { front: 'Describe X (3)', back: '- a\n\n- b\n\n- c' },
      { front: 'No sep', back: '', missingSeparator: true }
    ]
    const codes = validateCards(cards).map((w) => `${w.index}:${w.code}`)
    expect(codes).toContain('0:points_mismatch')
    expect(codes).toContain('1:cloze_has_points')
    expect(codes).toContain('1:cloze_count')
    expect(codes).toContain('2:empty_side')
    expect(codes).toContain('3:duplicate')
    expect(codes).toContain('4:missing_separator')
  })
  it('passes good cards', () => {
    expect(validateCards(parseStudySmarterText(SAMPLE).cards)).toEqual([])
  })
})

describe('round trip', () => {
  it('serialize → parse is stable', () => {
    const first = parseStudySmarterText(SAMPLE).cards
    const text = serializeStudySmarterText(first)
    const again = parseStudySmarterText(text).cards
    expect(again.map((c) => [c.front, c.back])).toEqual(first.map((c) => [c.front, c.back]))
  })
  it('dedupes by normalised question', () => {
    const out = dedupeCards([{ front: 'What is X?' }], [{ front: 'what is x' }, { front: 'What is Y?' }])
    expect(out).toEqual([{ front: 'What is Y?' }])
  })
})
