import type { TaskId } from '@shared/tasks'

// Deterministic fake output for every task (AI_MOCK=1). Kept close to the real
// shapes so the UI and tests exercise the same parsing paths.

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

interface MockCard {
  card_id: string
  type: string
  front: string
  back: string
  blanks?: string[]
}

function parseCards(v: unknown): MockCard[] {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(arr) ? (arr as MockCard[]) : []
  } catch {
    return []
  }
}

const firstLine = (s: string) => String(s ?? '').split('\n').find((l) => l.trim())?.replace(/^[-*]\s*/, '').trim() ?? ''

export function mockResponse(task: TaskId, mode: string, vars: Record<string, unknown>, prompt: string): { text: string; structured: unknown } {
  const v = (k: string) => String(vars[k] ?? '')
  switch (task) {
    case 'generate_notes': {
      const title = v('title') || 'the topic'
      const src = v('source_text').slice(0, 200).replace(/\s+/g, ' ')
      const text = `## What is ${title}?\nbasically the main idea in one line\n\n## The 3 important terms:\n**Term one:**\n- a simple definition\n\n**Term two:**\n- another simple definition\n\n| Term | Simple meaning |\n|---|---|\n| $E = hf$ | energy of a photon |\n\n\`\`\`mermaid\nflowchart LR\n  A[Source] --> B[Notes]\n\`\`\`\n\nRemember: ${src ? 'the source starts with ' + src.slice(0, 60) : 'everything here is examinable'}\n`
      return { text, structured: null }
    }
    case 'generate_cards': {
      if (mode === 'json') {
        const n = Math.max(1, Math.min(20, Number(vars.count) || 3))
        const cards = Array.from({ length: n }, (_, i) => ({
          front: `Mock question ${i + 1}`,
          back: `the **answer** ${i + 1}`,
          options:
            v('card_type') === 'multiple_choice'
              ? [
                  { text: `answer ${i + 1}`, correct: true },
                  { text: 'wrong a', correct: false },
                  { text: 'wrong b', correct: false },
                  { text: 'wrong c', correct: false }
                ]
              : null,
          tags: ['mock'],
          hints: null,
          language: null
        }))
        return { text: JSON.stringify({ cards }), structured: { cards } }
      }
      if (prompt.trim() === 'continue') {
        return { text: '```\nWhat is mock continuation?/#*#/the second part\n#\nName the 2 mock things (2)/#*#/- first thing\n\n- second thing\n```', structured: null }
      }
      const text =
        '```\nWhat is the work function?/#*#/the minimum energy needed to remove an electron from the surface of a metal\n#\nExplain why a threshold frequency exists (2)/#*#/- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron\n#\nEach electron can only absorb _________/#*#/one photon of energy\n```'
      return { text, structured: null }
    }
    case 'fix_cards': {
      const front = v('front').replace(/\s*\(\d+\)\s*$/, '')
      const bullets = v('back')
        .split('\n')
        .filter((l) => /^\s*-\s+/.test(l))
      const fixedFront = bullets.length > 1 ? `${front} (${bullets.length})` : front
      const cards = [{ front: fixedFront || 'Fixed question', back: v('back') || 'fixed answer', options: null, tags: null, hints: null, language: null }]
      return { text: JSON.stringify({ cards }), structured: { cards } }
    }
    case 'make_questions': {
      const cards = parseCards(vars.cards)
      const questions = cards.map((c) => {
        const h = hash(c.card_id)
        const answer = firstLine(c.back) || 'the answer'
        const base = {
          card_id: c.card_id,
          type: c.type,
          title: null,
          explanation: null,
          question: null,
          options: null,
          correct_index: null,
          expected_answer: null,
          statement: null,
          is_true: null,
          correction: null,
          distractors: null
        }
        switch (c.type) {
          case 'read_understand':
            return { ...base, title: firstLine(c.front).slice(0, 60), explanation: `**${firstLine(c.front)}**\n\nThe key idea: ${answer}.` }
          case 'multiple_choice': {
            const idx = h % 4
            const opts = ['a decoy option', 'another decoy', 'a third decoy']
            opts.splice(idx, 0, answer)
            return { ...base, question: c.front, options: opts, correct_index: idx }
          }
          case 'free_answer':
            return { ...base, question: c.front, expected_answer: c.back }
          case 'true_false': {
            const isTrue = h % 2 === 0
            return { ...base, statement: isTrue ? `${firstLine(c.front)} → ${answer}` : `${firstLine(c.front)} → not ${answer}`, is_true: isTrue, correction: isTrue ? '' : answer }
          }
          case 'choice_blank':
            return { ...base, distractors: (c.blanks ?? []).map((b, i) => [`${b}x`, `option ${i + 1}a`, `option ${i + 1}b`]) }
          default:
            return base
        }
      })
      return { text: JSON.stringify({ questions }), structured: { questions } }
    }
    case 'make_categorize': {
      const cards = parseCards(vars.cards)
      const items = cards.slice(0, 9).map((c, i) => ({ text: firstLine(c.front).slice(0, 60) || `Item ${i + 1}`, category: i % 2 === 0 ? 'Group A' : 'Group B', card_id: c.card_id }))
      while (items.length < 6) items.push({ text: `Extra item ${items.length + 1}`, category: items.length % 2 === 0 ? 'Group A' : 'Group B', card_id: cards[0]?.card_id ?? '' })
      const out = { categories: ['Group A', 'Group B'], items }
      return { text: JSON.stringify(out), structured: out }
    }
    case 'mark_free_answer': {
      const exp = new Set(words(v('expected_answer') || v('back')))
      const got = words(v('user_answer'))
      const hit = got.filter((w) => exp.has(w))
      const ratio = exp.size ? new Set(hit).size / exp.size : 0
      const score = Math.round(Math.min(10, ratio * 10 * 1.4))
      const verdict = score >= 8 ? 'correct' : score >= 4 ? 'partial' : 'wrong'
      const out = {
        score,
        verdict,
        points_found: [...new Set(hit)].slice(0, 5),
        points_missing: [...exp].filter((w) => !hit.includes(w)).slice(0, 5),
        short_feedback: verdict === 'correct' ? 'You covered the key points.' : 'You missed some of the key points.'
      }
      return { text: JSON.stringify(out), structured: out }
    }
    case 'mark_fill_blank': {
      const exp = v('expected_answer').split(' | ')
      const got = v('user_answer').split(' | ')
      const blanks = exp.map((e, i) => ({ correct: (got[i] ?? '').trim().toLowerCase().slice(0, 3) === e.trim().toLowerCase().slice(0, 3) && !!got[i]?.trim() }))
      return { text: JSON.stringify({ blanks }), structured: { blanks } }
    }
    case 'feedback_wrong': {
      const out = {
        why_wrong: `Your answer "${v('user_answer').slice(0, 80)}" doesn't match the key idea.`,
        takeaways: ['Focus on the definition', 'Link it to an example'],
        how_to_remember: 'Picture it as a story with three steps.'
      }
      return { text: JSON.stringify(out), structured: out }
    }
    case 'feedback_right': {
      const out = { takeaways: ['You know the core idea', 'Keep linking it to examples'], pro_tip: 'Try explaining it out loud in one sentence.' }
      return { text: JSON.stringify(out), structured: out }
    }
    case 'hint': {
      const n = (v('previous_hints').match(/\n/g) ?? []).length
      const out = { hint: n === 0 ? 'Think about what the question is really asking.' : 'Think about the first step of the process.' }
      return { text: JSON.stringify(out), structured: out }
    }
    case 'custom_action': {
      if (mode === 'json') {
        const cards = [{ front: 'Mock action card', back: 'mock **answer**', options: null, tags: ['mock'], hints: null, language: null }]
        return { text: JSON.stringify({ cards }), structured: { cards } }
      }
      return { text: `### Mock action\n\nHere is a mock response about: ${firstLine(v('front')) || firstLine(v('source_text')) || 'this'}.`, structured: null }
    }
    case 'explain':
    case 'explain_chat':
      return {
        text: `**${firstLine(v('front')) || 'This concept'}** — explained.\n\n- the core idea: ${firstLine(v('back')) || 'see the card'}\n- an example makes it concrete\n\n$$E = hf$$\n\n${/diagram/i.test(v('mode')) ? '```mermaid\nflowchart LR\n  Q[Question] --> A[Answer]\n```\n' : ''}`,
        structured: null
      }
    case 'note_simplify':
    case 'note_shorten':
    case 'note_fix_formatting':
    case 'note_expand':
      return { text: `${v('source_text').trim()}\n\n- (${task.replace('note_', '')}d by mock)`, structured: null }
  }
}

export async function mockStream(text: string, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<void> {
  if (!onDelta) return
  const chunks = text.match(/[\s\S]{1,24}/g) ?? []
  for (const c of chunks) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { kind: 'cancelled' })
    onDelta(c)
    await new Promise((r) => setTimeout(r, 4))
  }
}
