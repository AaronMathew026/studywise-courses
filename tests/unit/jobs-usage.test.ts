import { describe, it, expect, afterEach } from 'vitest'
import { startJob, getJob, setUsageProbe } from '../../src/main/jobs'

// A fake plan: readings are pushed by the "AI calls", and refresh() returns the next value.
function fakePlan(afterValue: number | null) {
  const listeners = new Set<(v: number) => void>()
  return {
    reading: (v: number) => listeners.forEach((l) => l(v)),
    probe: {
      enabled: () => true,
      onReading: (fn: (v: number) => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      refresh: async () => afterValue
    }
  }
}
const settle = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => setUsageProbe(null))

describe('job plan usage', () => {
  it('measures the 5-hour share from the first reading to a fresh one afterwards', async () => {
    const plan = fakePlan(0.46)
    setUsageProbe(plan.probe)
    const job = startJob('course_topic', 'Topic: A', async () => {
      plan.reading(0.42) // first AI call: before
      plan.reading(0.44) // a later call in the same job
      return 1
    })
    await settle()
    const pu = getJob(job.id)!.planUsage!
    expect(pu).toMatchObject({ before: 0.42, used: 0.04, shared: false, measuring: false })
  })

  it('marks overlapping jobs as shared, and gives up if the window reset', async () => {
    const plan = fakePlan(0.1)
    setUsageProbe(plan.probe)
    let release!: () => void
    const a = startJob('course_topic', 'Topic: A', async () => {
      plan.reading(0.5)
      await new Promise<void>((r) => (release = r))
    })
    const b = startJob('course_topic', 'Topic: B', async () => {})
    release()
    await settle()
    // After (0.1) is lower than before (0.5): the window reset, so it's unknown.
    expect(getJob(a.id)!.planUsage).toMatchObject({ shared: true, used: null, measuring: false })
    expect(getJob(b.id)!.planUsage!.shared).toBe(true)
  })

  it('measures nothing without a probe', async () => {
    const job = startJob('other', 'x', async () => 1)
    await settle()
    expect(getJob(job.id)!.planUsage).toBeUndefined()
  })
})
