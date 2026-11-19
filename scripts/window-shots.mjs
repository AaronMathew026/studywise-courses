// Captures the real window (no viewport emulation) at default size and in fullscreen.
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = process.argv[2]
mkdirSync(out, { recursive: true })
const env = { ...process.env, AI_MOCK: '1', STUDYWISE_DATA_DIR: mkdtempSync(join(tmpdir(), 'sw-win-')) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
await win.waitForTimeout(800)
await win.evaluate(() => window.studywise.settings.set({ key: 'onboarding.done', value: true }))
await win.reload()
await win.waitForTimeout(1500)
await win.evaluate(async () => {
  const d = await window.studywise.decks.create({ name: 'Quantum physics' })
  await window.studywise.cards.create({ cards: [{ deck_id: d.id, front: 'What is the work function?', back: 'the **minimum energy** to remove an electron' }] })
})
const grab = async (name) => {
  await win.waitForTimeout(900)
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const img = await w.webContents.capturePage()
    const [cw, ch] = w.getContentSize()
    return { png: img.toPNG().toString('base64'), size: `${cw}x${ch}`, full: w.isFullScreen(), bounds: w.getBounds() }
  })
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.png, 'base64'))
  console.log(name, r.size, 'fullscreen=' + r.full, JSON.stringify(r.bounds))
}
await grab('default-home')
await win.locator('header').getByRole('button', { name: 'Decks', exact: true }).click()
await grab('default-decks')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true))
await win.waitForTimeout(1500)
await grab('full-decks')
await win.locator('header').getByRole('button', { name: 'Home', exact: true }).click()
await grab('full-home')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false))
await win.waitForTimeout(1500)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))
await grab('small-home')
await app.close()
