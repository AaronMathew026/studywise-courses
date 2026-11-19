import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Launch → create deck → add cards → run a full Learn session, with AI_MOCK=1.

let app: ElectronApplication
let win: Page
let dir: string

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sw-e2e-'))
  const env = { ...process.env, AI_MOCK: '1', STUDYWISE_DATA_DIR: dir } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.'], env })
  win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 860 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dir, { recursive: true, force: true })
})

async function addCard(front: string, back: string) {
  await win.getByRole('button', { name: /^Add card/ }).first().click()
  const areas = win.locator('[data-modal] textarea')
  await areas.nth(0).fill(front)
  await areas.nth(1).fill(back)
  await win.locator('[data-modal]').getByRole('button', { name: 'Add card' }).click()
  await expect(win.locator('[data-modal]')).toHaveCount(0)
}

test('create a deck, add cards, and finish a Learn session', async () => {
  // First launch shows onboarding; walk through it.
  await expect(win.getByRole('heading', { name: 'Welcome to Studywise.' })).toBeVisible()
  for (let i = 0; i < 4; i++) await win.getByRole('button', { name: /^(Continue|Skip for now)$/ }).click()
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('heading', { level: 1 })).toContainText(/No decks|due/)

  // New deck
  await win.getByRole('button', { name: /New deck/ }).first().click()
  await win.locator('[data-modal] input').fill('Physics')
  await win.locator('[data-modal]').getByRole('button', { name: 'Create' }).click()
  await expect(win.getByRole('heading', { level: 1 })).toHaveText('Physics')

  // Cards
  await addCard('What is the work function?', 'the **minimum energy** needed to remove an electron from a metal')
  await addCard('State 2 facts about photons (2)', '- they carry energy E = hf\n\n- they have no mass')
  await addCard('Each electron can only absorb ______', 'one photon')
  await addCard('Unit of frequency?', 'hertz')
  await expect(win.getByText('(2) points')).toBeVisible()
  await expect(win.getByText('Cloze', { exact: true })).toBeVisible()

  // Learn
  await win.getByRole('button', { name: /^Learn/ }).first().click()
  await expect(win.getByText(/\d+ \/ \d+/).first()).toBeVisible()

  let feedbackSeen = 0
  for (let i = 0; i < 40; i++) {
    if (await win.getByText(/Great session|Nice work|Good practice/).isVisible()) break
    // Wait for a question or the result.
    await win.getByText('Writing questions').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    if (await win.getByText(/Great session|Nice work|Good practice/).isVisible()) break
    const label = (await win.locator('main .pop-in span').first().textContent())?.trim() ?? ''
    const cont = win.getByRole('button', { name: /^Continue/ })
    if (await cont.isVisible()) {
      await cont.click()
      continue
    }
    if (label.startsWith('Read & understand')) {
      await win.getByRole('button', { name: /^Got it/ }).click({ timeout: 3000 }).catch(() => {})
      await win.waitForTimeout(300)
      continue
    } else if (label.startsWith('Multiple choice')) await win.locator('main button:has(span.grid)').first().click()
    else if (label.startsWith('True or false')) await win.getByRole('button', { name: /^True/ }).click()
    else if (label.startsWith('Free answer')) {
      await win.locator('main textarea').fill('energy to remove an electron')
      await win.getByRole('button', { name: 'Check answer' }).click()
    } else if (label.startsWith('Fill in the blank')) {
      const inputs = win.locator('main input')
      const n = await inputs.count()
      for (let j = 0; j < n; j++) await inputs.nth(j).fill('one photon')
      await win.getByRole('button', { name: /^Check/ }).click()
    } else if (label.startsWith('Choice blank')) {
      const selects = win.locator('main select')
      const n = await selects.count()
      for (let j = 0; j < n; j++) await selects.nth(j).selectOption({ index: 1 })
      await win.getByRole('button', { name: /^Check/ }).click()
    } else {
      // Match pairs / Categorize: just skip in the smoke test.
      await win.getByRole('button', { name: /^Skip/ }).click({ timeout: 3000 }).catch(() => {})
      continue
    }
    // Marked: feedback should load, then continue.
    const next = win.getByRole('button', { name: /^Continue/ })
    await next.waitFor({ state: 'visible', timeout: 10000 })
    await expect(win.getByText(/Key takeaways/)).toBeVisible({ timeout: 8000 })
    feedbackSeen++
    await next.click()
  }
  await expect(win.getByText(/Great session|Nice work|Good practice/)).toBeVisible()
  await expect(win.getByText('Correct', { exact: true })).toBeVisible()
  expect(feedbackSeen).toBeGreaterThan(0)
})
