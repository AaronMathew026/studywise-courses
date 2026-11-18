import { describe, it, expect } from 'vitest'
import { newSm2State, review, isDue, masteryOf, ratingForVerdict } from '@shared/sm2'

const t0 = new Date('2026-01-01T10:00:00Z')
const days = (a: string, b: Date) => Math.round((new Date(a).getTime() - b.getTime()) / 86400000)

describe('SM-2', () => {
  it('Good grows 1 → 6 → interval × ease', () => {
    let s = review(newSm2State(t0), 3, t0)
    expect(s.interval).toBe(1)
    expect(days(s.due, t0)).toBe(1)
    s = review(s, 3, t0)
    expect(s.interval).toBe(6)
    const before = s
    s = review(s, 3, t0)
    expect(s.interval).toBe(Math.round(6 * before.ease))
    expect(s.repetitions).toBe(3)
  })
  it('Again resets and counts a lapse, due in 10 minutes', () => {
    let s = review(review(newSm2State(t0), 3, t0), 3, t0)
    s = review(s, 1, t0)
    expect(s.repetitions).toBe(0)
    expect(s.lapses).toBe(1)
    expect(s.interval).toBe(0)
    expect(new Date(s.due).getTime() - t0.getTime()).toBe(10 * 60 * 1000)
  })
  it('ease changes with quality and never drops below 1.3', () => {
    const easy = review(newSm2State(t0), 4, t0)
    expect(easy.ease).toBeCloseTo(2.6)
    const hard = review(newSm2State(t0), 2, t0)
    expect(hard.ease).toBeCloseTo(2.36)
    let s = newSm2State(t0)
    for (let i = 0; i < 20; i++) s = review(s, 1, t0)
    expect(s.ease).toBe(1.3)
  })
  it('Easy jumps further than Good, Hard less', () => {
    const base = review(review(newSm2State(t0), 3, t0), 3, t0)
    expect(review(base, 4, t0).interval).toBeGreaterThan(review(base, 3, t0).interval)
    expect(review(base, 2, t0).interval).toBeLessThan(review(base, 3, t0).interval)
    expect(review(newSm2State(t0), 4, t0).interval).toBe(4)
  })
  it('due today / mastery / verdict mapping', () => {
    expect(isDue(null)).toBe(true)
    expect(isDue({ due: new Date(Date.now() + 3 * 86400000).toISOString() })).toBe(false)
    expect(masteryOf({ interval: 21, repetitions: 4 })).toBe(1)
    expect(masteryOf({ interval: 0, repetitions: 0 })).toBe(0)
    expect(ratingForVerdict('correct')).toBe(3)
    expect(ratingForVerdict('partial')).toBe(2)
    expect(ratingForVerdict('wrong')).toBe(1)
  })
})
