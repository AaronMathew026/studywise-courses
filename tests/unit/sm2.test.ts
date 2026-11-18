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

import { schedule, newState, dueFraction, START_DIFFICULTY, type SchedState } from '@shared/scheduler'

describe('difficulty-based scheduler', () => {
  const run = (ratings: (1 | 2 | 3 | 4)[], start = newState(t0)) => {
    let s: SchedState = start
    const out: SchedState[] = []
    for (const r of ratings) {
      s = schedule('adaptive', s, r, t0)
      out.push(s)
    }
    return out
  }
  it('starts at 0.60 and keeps it through the fixed 1-day early steps', () => {
    const steps = run([3, 3, 3])
    expect(newState().difficulty).toBe(START_DIFFICULTY)
    for (const s of steps) {
      expect(s.interval).toBe(1)
      expect(s.difficulty).toBe(0.6)
      expect(days(s.due, t0)).toBe(1)
    }
  })
  it('is learned after two Good ratings', () => {
    const [a, b] = run([3, 3])
    expect(a.sr_state).toBe(0)
    expect(b.sr_state).toBe(1)
  })
  it('grows intervals fast and lowers difficulty on success', () => {
    const s = run([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])
    const intervals = s.map((x) => x.interval)
    expect(intervals.slice(3)).toEqual([...intervals.slice(3)].sort((a, b) => a - b))
    expect(intervals[6]).toBeGreaterThan(80) // review 7 ≈ 115 days
    expect(intervals[9]).toBeGreaterThan(400) // review 10 ≈ 600 days
    expect(s[9].difficulty).toBeLessThan(0.45)
    expect(s[9].sr_state).toBe(2)
  })
  it('due date is interval × (0.694 − 0.187 × difficulty), in whole days', () => {
    expect(dueFraction(0.3)).toBeCloseTo(0.638, 2)
    expect(dueFraction(0.5)).toBeCloseTo(0.6005, 3)
    expect(dueFraction(0.8)).toBeCloseTo(0.544, 2)
    const s = run([3, 3, 3, 3, 3, 3, 3]).at(-1)!
    expect(days(s.due, t0)).toBe(Math.round(s.interval * dueFraction(s.difficulty)))
    expect(days(s.due, t0)).toBeLessThan(s.interval)
  })
  it('harder cards come back sooner', () => {
    const easy = schedule('adaptive', { ...newState(t0), repetitions: 6, interval: 20, difficulty: 0.3, sr_state: 1, good_count: 6 }, 3, t0)
    const hard = schedule('adaptive', { ...newState(t0), repetitions: 6, interval: 20, difficulty: 0.8, sr_state: 1, good_count: 6 }, 3, t0)
    expect(days(hard.due, t0)).toBeLessThan(days(easy.due, t0))
  })
  it('forgetting moves the card to relearning with a short interval and higher difficulty', () => {
    const before = run([3, 3, 3, 3, 3, 3, 3]).at(-1)!
    const after = schedule('adaptive', before, 1, t0)
    expect(after.sr_state).toBe(-1)
    expect(after.difficulty).toBeGreaterThan(before.difficulty)
    expect(after.interval).toBeLessThan(before.interval)
    expect(days(after.due, t0)).toBe(1)
    expect(after.lapses).toBe(before.lapses + 1)
  })
  it('sm2 mode still works through schedule()', () => {
    const s = schedule('sm2', newState(t0), 3, t0)
    expect(s.interval).toBe(1)
    expect(s.ease).toBeCloseTo(2.5)
  })
})
