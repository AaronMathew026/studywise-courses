// npm run ai:course-check [-- --model=sonnet]
// One real course run: plan a week from the 12-page test PDF, write its first
// topic, and mark one explain answer. Checks everything parses and prints a
// summary. Writes the outline and topic to ./real-check-out/.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { JobContext } from '../src/main/jobs'

const model = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'sonnet'
const outDir = resolve('real-check-out')
mkdirSync(outDir, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'studywise-course-real-'))
process.env.STUDYWISE_DATA_DIR = dir

const ctx = (label: string): JobContext => ({
  signal: new AbortController().signal,
  progress: (m) => process.stdout.write(`\r  ${label}: ${m.padEnd(70)}`),
  delta: () => {},
  meta: () => {}
})

async function main() {
  const { openDb, closeDb } = await import('../src/main/db')
  const repo = await import('../src/main/db/repo')
  const { seedPresets } = await import('../src/main/ai/presets')
  const { detectClaude } = await import('../src/main/ai/claudePath')
  const course = await import('../src/main/services/course')
  openDb(join(dir, 'real.db'))
  seedPresets()
  repo.setSetting('models', { course_outline: { model, effort: null }, course_topic: { model, effort: null }, course_mark: { model, effort: null } })
  const st = await detectClaude()
  console.log(`claude ${st.version} at ${st.path} (${st.loggedIn ? 'logged in' : 'NOT logged in'}), model ${model}`)
  if (!st.loggedIn) process.exit(1)

  const c = course.createCourse({ name: 'Quantum Physics 1', level: 'first-year physics undergraduate' })
  const w = course.addWeek(c.id)
  await course.addFiles(w.id, [resolve('tests/fixtures/photoelectric-lecture.pdf')])

  let t = Date.now()
  const planned = await course.planWeek(w.id, ctx('plan'))
  const topics = course.listTopics(c.id)
  console.log(`\n✓ planned ${planned.topics} topics in ${((Date.now() - t) / 1000).toFixed(0)}s`)
  for (const x of topics) console.log(`  ${x.key} ${x.plan.title} · ${x.plan.sections.length} sections · ${x.plan.sources.map((s) => `${s.file} ${s.where}`).join('; ')}`)
  writeFileSync(join(outDir, 'course-outline.json'), JSON.stringify(topics.map((x) => x.plan), null, 2))

  t = Date.now()
  const r = await course.writeTopic(topics[0].id, ctx('topic'))
  const topic = course.getTopic(topics[0].id)
  const content = topic.content!
  const qs = content.sections.flatMap((s) => s.questions)
  console.log(`\n✓ wrote "${content.title}" in ${((Date.now() - t) / 1000).toFixed(0)}s: ${r.sections} sections, ${qs.length} section questions, ${content.check.length} check, ${r.cards} cards`)
  const byType: Record<string, number> = {}
  for (const q of [...qs, ...content.check]) byType[q.type] = (byType[q.type] ?? 0) + 1
  console.log(`  types: ${JSON.stringify(byType)}`)
  const figs = content.sections.filter((s) => s.figure)
  console.log(`  figures: ${figs.map((s) => `p${s.figure!.page} "${s.figure!.caption}"`).join(', ') || 'none'}`)
  for (const s of figs) console.log(`  rendered ${await course.figureUrl(s.figure!.fileId, s.figure!.page)}`)
  writeFileSync(join(outDir, 'course-topic.json'), JSON.stringify(content, null, 2))

  const ex = [...qs, ...content.check].find((q) => q.type === 'explain')
  if (ex && ex.type === 'explain') {
    const m = await course.markExplain(c.id, ex, 'Not sure, something about photons having energy.')
    console.log(`✓ marked explain: ${m.mark.score}/10 ${m.mark.verdict}: ${m.mark.detail?.short_feedback}`)
  }
  closeDb()
  rmSync(dir, { recursive: true, force: true })
}

main().catch((e) => {
  console.error('\n✗', e?.message ?? e)
  process.exit(1)
})
