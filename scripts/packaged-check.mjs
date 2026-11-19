// Launch a packaged Studywise.app with a Finder-like environment (bare PATH,
// no SHELL) and a throwaway data folder, then run a real flashcard generation
// from the test PDF through the app's own API.
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

const appPath = process.argv[2] || 'release/mac-arm64/Studywise.app'
const exe = join(appPath, 'Contents/MacOS/Studywise')
const env = { HOME: process.env.HOME, USER: userInfo().username, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', STUDYWISE_DATA_DIR: mkdtempSync(join(tmpdir(), 'sw-pkg-')) }
const app = await electron.launch({ executablePath: exe, env, args: [] })
const win = await app.firstWindow()
await win.waitForTimeout(800)
await win.evaluate(() => window.studywise.settings.set({ key: 'onboarding.done', value: true }))
await win.reload()
await win.waitForTimeout(4000)
const status = await win.evaluate(() => window.studywise.claude.status())
console.log('claude:', status.path, status.version, status.loggedIn ? 'logged in' : 'NOT logged in', status.mock ? '(mock!)' : '')
const pdf = resolve('tests/fixtures/photoelectric-lecture.pdf')
const job = await win.evaluate((pdf) => window.studywise.gen.cards({ sources: { files: [pdf], topic: '', text: '', noteIds: [] }, format: 'question_answer', cardType: 'regular', language: '', instructions: 'Keep it to about 15 cards per part.', count: null }), pdf)
console.log('job started', job.id)
let j = job
const t0 = Date.now()
while (j.status === 'running' && Date.now() - t0 < 600000) {
  await win.waitForTimeout(3000)
  j = await win.evaluate((id) => window.studywise.jobs.get({ id }), job.id)
  process.stdout.write(`\r  ${j.progress.padEnd(60)}`)
}
console.log(`\njob ${j.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`, j.error ?? '')
if (j.status === 'done') {
  const r = j.result
  console.log(`${r.cards.length} cards, ${r.warnings.length} warnings, ${r.rounds} round(s). First 3:`)
  for (const c of r.cards.slice(0, 3)) console.log('  -', c.front, '→', c.back.split('\n')[0])
}
const calls = await win.evaluate(() => window.studywise.ai.calls({ limit: 10 }))
console.log('ai_calls:', calls.map((c) => `${c.task}/${c.model}/${c.ok ? 'ok' : c.error}`).join(', '))
await app.close()
