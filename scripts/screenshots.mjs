// node scripts/screenshots.mjs [outDir] [--dark]
// Seeds a demo library (AI_MOCK) and captures each screen for the README.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'docs/screenshots'
const dark = process.argv.includes('--dark')
mkdirSync(out, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'sw-shots-'))
const env = { ...process.env, AI_MOCK: '1', STUDYWISE_DATA_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
await win.waitForTimeout(800)
await win.evaluate(() => window.studywise.settings.set({ key: 'onboarding.done', value: true }))
await win.reload()
const [vw, vh] = (process.env.VIEWPORT || '1360x860').split('x').map(Number)
await win.setViewportSize({ width: vw, height: vh })
win.on('pageerror', (e) => console.error('pageerror', e.message))
await win.waitForTimeout(1200)

const NOTE = `What is the photoelectric effect?
light shining on a metal can knock electrons out of it, but only if the light's frequency is high enough

## The 3 important terms:
**Threshold frequency:**
- the lowest frequency of light that can release electrons from a metal

**Work function ($\\phi$):**
- the minimum energy needed to remove an electron from the surface of a metal

**Photoelectron:**
- an electron released from the surface by light

## Why does brightness not matter?
- one photon gives all its energy to one electron
  - a brighter light just means more photons, not more energetic ones
- so below the threshold frequency, no electrons come out, however bright

Think of it like a vending machine that only takes £1 coins: a pile of 50p coins never buys anything

## The equation:
$$hf = \\phi + E_{k(max)}$$

| Symbol | Simple meaning |
|---|---|
| $h$ | Planck constant, $6.63 \\times 10^{-34}$ J s |
| $f$ | frequency of the light (Hz) |
| $\\phi$ | work function (J) |
| $E_{k(max)}$ | max kinetic energy of the photoelectron |

## What happens step by step:
\`\`\`mermaid
flowchart LR
  A[Photon hits metal] --> B{hf ≥ φ?}
  B -- yes --> C[Electron escapes]
  B -- no --> D[Nothing happens]
\`\`\`

## Wrong idea vs correct idea:
| Wrong idea | Correct idea |
|---|---|
| brighter light gives faster electrons | brighter light gives more electrons |
| any light works if you wait long enough | below threshold, it never works |
`

const CARDS = [
  ['What is the work function?', 'the **minimum energy** needed to remove an electron from the surface of a metal'],
  ['Explain why a threshold frequency exists (2)', '- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron'],
  ['Each electron can only absorb _________', 'one photon of energy'],
  ['What is the equation for the energy of a photon?', '$E = hf$'],
  ['What does $\\phi$ stand for in $hf = \\phi + E_{k(max)}$?', 'the **work function**'],
  ['State 3 observations of the photoelectric effect (3)', '- no electrons are emitted below the threshold frequency\n\n- emission is instantaneous\n\n- max kinetic energy depends on frequency, not intensity'],
  ['What happens when light intensity increases above the threshold?', 'more **photoelectrons** are emitted per second'],
  ['What are the units of Planck’s constant?', '**J s** (joule seconds)'],
  ['The ________ of a photon depends only on its ________', '- energy\n\n- frequency'],
  ['Why does brightness not affect electron speed?', 'each electron absorbs **one photon**, so only photon energy (frequency) matters'],
  ['Define a photoelectron', 'an **electron** emitted from a metal surface by light'],
  ['What is the value of the electronvolt in joules?', '$1.6 \\times 10^{-19}$ J']
]

const seed = await win.evaluate(
  async ({ NOTE, CARDS, dark }) => {
    const sw = window.studywise
    const folder = await sw.folders.create({ name: 'Physics', kind: 'deck' })
    const deck = await sw.decks.create({ name: 'Quantum physics', folder_id: folder.id, description: 'Photoelectric effect, photons and energy levels' })
    await sw.decks.create({ name: 'Electricity', folder_id: folder.id })
    const hci = await sw.decks.create({ name: 'HCI: Information foraging' })
    await sw.decks.create({ name: 'Spanish vocab' })
    const cards = await sw.cards.create({ cards: CARDS.map(([front, back]) => ({ deck_id: deck.id, front, back, format: 'question_answer', tags: ['photoelectric'] })) })
    await sw.cards.create({ cards: [{ deck_id: hci.id, front: 'What is information scent?', back: 'how useful a link **looks** to the forager' }, { deck_id: hci.id, front: 'Name the 3 choices a forager makes (3)', back: '- process\n\n- move\n\n- enrich' }] })
    // Some study history
    const ratings = [3, 3, 1, 2, 3, 4, 3, 1, 3]
    for (let i = 0; i < ratings.length; i++) await sw.cards.review({ cardId: cards[i].id, rating: ratings[i] })
    await sw.cards.review({ cardId: cards[2].id, rating: 1 })
    await sw.cards.review({ cardId: cards[7].id, rating: 1 })
    const note = await sw.notes.create({ title: 'The photoelectric effect', module: 'PHYS201', type: 'Lecture', week: '4', content: NOTE })
    await sw.notes.linkDeck({ noteId: note.id, deckId: deck.id, linked: true })
    await sw.notes.create({ title: 'Information foraging theory', module: 'HCI', type: 'Reading', week: '3', content: '## What is IFT?\npeople look for information like animals look for food' })
    await sw.notes.create({ title: 'Linking all week 3 texts', module: 'HCI', type: 'Reading', week: '3', content: '- T1: foraging\n- T2: scent' })
    if (dark) await sw.settings.set({ key: 'ui.theme', value: 'dark' })
    return { deckId: deck.id, noteId: note.id }
  },
  { NOTE, CARDS, dark }
)

const shot = async (name, wait = 700) => {
  await win.waitForTimeout(wait)
  await win.screenshot({ path: join(out, `${name}${dark ? '-dark' : ''}.png`) })
  console.log('saved', name)
}
const press = (k) => win.keyboard.press(k)
const nav = async (label) => {
  await win.locator('header').getByRole('button', { name: label, exact: true }).first().click()
}

// reload so theme applies
await win.reload()
await win.waitForTimeout(1200)
await nav('Home')
await shot('home')
await nav('Decks')
await shot('decks')
await win.getByText('Quantum physics').first().click()
await shot('deck')
await win.getByRole('button', { name: /^Flashcards/ }).first().click()
await win.waitForTimeout(600)
await press('Space')
await shot('flashcards', 1000)
await press('Escape')
await win.waitForTimeout(500)
await win.getByRole('button', { name: /^Learn/ }).first().click()
await win.waitForTimeout(1200)
// Answer until a question with feedback shows
for (let i = 0; i < 12; i++) {
  const label = (await win.locator('main .pop-in span').first().textContent())?.trim() ?? ''
  if (label.startsWith('Multiple choice') && i > 0) {
    await shot('learn-question')
    await win.locator('main button:has(span.grid)').nth(1).click()
    await win.getByRole('button', { name: /^Get feedback$/ }).click()
    await win.getByText('Key takeaways').waitFor({ timeout: 8000 })
    await shot('learn-feedback')
    break
  }
  await win.getByRole('button', { name: /^Skip/ }).click().catch(() => {})
  await win.waitForTimeout(400)
}
await press('Escape')
await win.waitForTimeout(500)
await nav('Notes')
await win.getByText('The photoelectric effect').first().click()
await shot('notes', 1600)
await nav('Decks')
await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })))
await win.locator('header').getByRole('button', { name: /Search/ }).click()
await win.keyboard.type('photo')
await shot('palette')
await press('Escape')
await win.locator('header').getByRole('button', { name: /Generate/ }).click()
await shot('generate')
await win.locator('[data-modal]').getByRole('button', { name: 'Paste text' }).click()
await win.locator('[data-modal] textarea').first().fill('The photoelectric effect: light above a threshold frequency ejects electrons from a metal.')
await win.locator('[data-modal]').getByRole('button', { name: /^Generate/ }).click()
await win.getByText(/Review \d+ cards/).waitFor({ timeout: 10000 })
await shot('preview')
await press('Escape')
await nav('Settings')
await win.getByRole('button', { name: 'Prompts' }).click()
await shot('settings-prompts', 1200)
await win.getByRole('button', { name: 'Models' }).click()
await shot('settings-models')
await win.locator('body').press('Shift+?')
await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true })))
await shot('shortcuts')
await app.close()
