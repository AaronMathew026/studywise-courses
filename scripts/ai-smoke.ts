// npm run ai:smoke: proves the Claude Code bridge works end to end.
// Runs a JSON task, a streamed Markdown task and a StudySmarter-text task
// against a throwaway database. Uses real Claude unless AI_MOCK=1.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, closeDb } from '../src/main/db'
import { seedPresets } from '../src/main/ai/presets'
import { detectClaude } from '../src/main/ai/claudePath'
import { runAI, friendlyError } from '../src/main/ai'
import { listAiCalls } from '../src/main/db/repo'
import { parseStudySmarterText } from '../src/shared/ssText'

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'studywise-smoke-'))
  openDb(join(dir, 'smoke.db'))
  seedPresets()
  const status = await detectClaude()
  console.log('claude:', status.path ?? '(not found)', status.version ?? '', status.loggedIn ? 'logged in' : 'NOT logged in', process.env.AI_MOCK === '1' ? '[MOCK]' : '')
  if (process.env.AI_MOCK !== '1' && (!status.path || !status.loggedIn)) {
    console.error(status.error)
    process.exit(1)
  }
  let failed = 0
  const step = async (name: string, fn: () => Promise<string>) => {
    const t = Date.now()
    try {
      const out = await fn()
      console.log(`✓ ${name} (${Date.now() - t}ms)\n  ${out.replace(/\n/g, '\n  ').slice(0, 400)}`)
    } catch (e) {
      failed++
      console.error(`✗ ${name}: ${friendlyError(e)}`)
    }
  }

  await step('json: hint (haiku)', async () => {
    const r = await runAI<{ hint: string }>({
      task: 'hint',
      vars: { front: 'What is the work function?', back: 'the minimum energy needed to remove an electron from the surface of a metal', question: 'What is the work function?', type: 'free_answer', previous_hints: '(none)' }
    })
    return JSON.stringify(r.data)
  })

  await step('markdown stream: explain', async () => {
    let chunks = 0
    const r = await runAI<string>({
      task: 'explain',
      vars: { front: 'E = hf', back: 'photon energy equals Planck constant times frequency', mode: 'Explain this card clearly in under 80 words.', user_answer: '(none yet)', source_text: '(no linked note)' },
      onDelta: () => chunks++
    })
    return `${chunks} streamed chunks\n${r.text}`
  })

  await step('studysmarter_text: generate_cards', async () => {
    const r = await runAI<string>({
      task: 'generate_cards',
      vars: {
        source_text:
          'The photoelectric effect: light above a threshold frequency ejects electrons from a metal surface. The work function is the minimum energy needed to remove an electron. Each electron absorbs one photon. E = hf.',
        instructions: 'Make about 4 cards.'
      }
    })
    const parsed = parseStudySmarterText(r.text, { detectTruncation: true })
    if (parsed.cards.length === 0) throw new Error(`No cards parsed from:\n${r.text}`)
    return `${parsed.cards.length} cards, session ${r.sessionId}\n` + parsed.cards.map((c) => `${c.front} → ${c.back.split('\n')[0]}`).join('\n')
  })

  const calls = listAiCalls(10)
  console.log(`\nai_calls logged: ${calls.length} (${calls.filter((c) => c.ok).length} ok)`)
  closeDb()
  rmSync(dir, { recursive: true, force: true })
  if (failed) {
    console.error(`${failed} step(s) failed`)
    process.exit(1)
  }
  console.log('AI bridge OK')
}

void main()
