// Launch the built app and screenshot it (dev helper).
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = process.env.STUDYWISE_DATA_DIR || mkdtempSync(join(tmpdir(), 'sw-peek-'))
const env = { ...process.env, AI_MOCK: process.env.AI_MOCK ?? '1', STUDYWISE_DATA_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
const logs = []
win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await win.setViewportSize({ width: 1280, height: 820 })
await win.waitForTimeout(2500)
await win.screenshot({ path: process.argv[2] || 'peek.png' })
console.log(logs.join('\n'))
await app.close()
