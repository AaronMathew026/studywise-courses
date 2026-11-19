import { getDb, uid, now, json } from '../db'
import * as repo from '../db/repo'
import { runAI } from '../ai'
import { getAction } from '../ai/presets'
import { renderTemplate } from '@shared/template'
import { lastAnswerFor } from './learn'
import type { GeneratedCard } from '@shared/questions'
import { fromGenerated, type PreviewCard } from './generate'

export interface ExplainContext {
  cardId?: string | null
  noteId?: string | null
  selection?: string | null
  question?: string | null
  userAnswer?: string | null
  expectedAnswer?: string | null
  deckId?: string | null
}

export const EXPLAIN_MODES: Record<string, string> = {
  explain: 'Explain this card clearly.',
  simpler: 'Explain it again, simpler: short sentences, everyday words, one analogy.',
  deeper: 'Go deeper: the underlying reasons, edge cases and how it links to related ideas.',
  example: 'Give one or two concrete worked examples.',
  diagram: 'Show a diagram: one ```mermaid block that captures the idea, with a one-line caption and a short walkthrough.',
  why_wrong: 'Explain specifically why my last answer was wrong or incomplete, and what the right answer is.'
}

function contextVars(ctx: ExplainContext) {
  const card = ctx.cardId ? repo.getCard(ctx.cardId) : null
  const deckId = ctx.deckId ?? card?.deck_id ?? null
  let source = ''
  if (card?.source?.type === 'note' && card.source.noteId) source = repo.noteSection(card.source.noteId, card.source.section)
  else if (ctx.noteId) source = ctx.selection ? repo.noteSection(ctx.noteId) : repo.noteSection(ctx.noteId)
  else if (deckId && card) {
    const notes = repo.notesForDeck(deckId)
    if (notes[0]) source = notes[0].content.slice(0, 4000)
  }
  const userAnswer = ctx.userAnswer ?? (card ? lastAnswerFor(card.id) : null)
  const deck = deckId ? repo.getDeck(deckId) : null
  return {
    deckId,
    vars: {
      front: card?.front ?? (ctx.selection ? `Explain this part of my notes:\n${ctx.selection}` : ''),
      back: card?.back ?? '',
      required_points: card?.required_points ?? '',
      question: ctx.question ? `The question I was asked: ${ctx.question}` : '',
      expected_answer: ctx.expectedAnswer ?? card?.back ?? '',
      user_answer: userAnswer || '(none yet)',
      source_text: source || '(no linked note)',
      deck_name: deck?.name ?? '',
      language: card?.language ?? ''
    }
  }
}

export async function explain(ctx: ExplainContext, mode: string, explanationId: string | null, onDelta: (t: string) => void): Promise<{ explanationId: string; text: string }> {
  const { deckId, vars } = contextVars(ctx)
  let id = explanationId
  if (!id) {
    id = uid()
    getDb().prepare('INSERT INTO explanations (id, card_id, note_id, context, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ctx.cardId ?? null, ctx.noteId ?? null, JSON.stringify(ctx), now())
  }
  const known = mode in EXPLAIN_MODES
  const request = known ? EXPLAIN_MODES[mode] : mode.slice(0, 2000)
  if (!known) addMessage(id, 'user', request, null)
  const r = await runAI<string>({ task: 'explain', deckId, vars: { ...vars, mode: request }, onDelta })
  addMessage(id, 'assistant', r.text, known ? mode : null)
  return { explanationId: id, text: r.text }
}

export async function chat(explanationId: string, message: string, onDelta: (t: string) => void): Promise<{ text: string }> {
  const row = getDb().prepare('SELECT context FROM explanations WHERE id = ?').get(explanationId) as { context: string } | undefined
  if (!row) throw new Error('Explanation not found')
  const ctx = json<ExplainContext>(row.context, {})
  const { deckId, vars } = contextVars(ctx)
  addMessage(explanationId, 'user', message, null)
  const history = messages(explanationId)
    .map((m) => `${m.role === 'user' ? 'Me' : 'Tutor'}: ${m.content}`)
    .join('\n\n')
  const r = await runAI<string>({ task: 'explain_chat', deckId, vars: { ...vars, history }, onDelta })
  addMessage(explanationId, 'assistant', r.text, null)
  return { text: r.text }
}

function addMessage(explanationId: string, role: 'user' | 'assistant', content: string, label: string | null) {
  getDb().prepare('INSERT INTO explain_messages (explanation_id, role, label, content, created_at) VALUES (?, ?, ?, ?, ?)').run(explanationId, role, label, content, now())
}

export function messages(explanationId: string): { role: string; label: string | null; content: string; created_at: string }[] {
  return getDb().prepare('SELECT role, label, content, created_at FROM explain_messages WHERE explanation_id = ? ORDER BY id').all(explanationId) as never
}

export function historyForCard(cardId: string): { id: string; created_at: string; messages: ReturnType<typeof messages> }[] {
  const rows = getDb().prepare('SELECT id, created_at FROM explanations WHERE card_id = ? ORDER BY created_at DESC LIMIT 10').all(cardId) as { id: string; created_at: string }[]
  return rows.map((r) => ({ ...r, messages: messages(r.id) }))
}

// ---------- custom actions ----------
export async function runAction(
  actionId: string,
  ctx: ExplainContext,
  onDelta: (t: string) => void
): Promise<{ kind: 'markdown'; text: string } | { kind: 'cards'; cards: PreviewCard[] }> {
  const action = getAction(actionId)
  const { deckId, vars } = contextVars(ctx)
  const fullVars = { ...vars, source_text: ctx.selection ? ctx.selection : vars.source_text === '(no linked note)' ? '' : vars.source_text }
  const actionPrompt = renderTemplate(action.prompt, fullVars)
  if (action.output === 'cards') {
    const r = await runAI<{ cards: GeneratedCard[] }>({
      task: 'custom_action',
      deckId,
      vars: { ...fullVars, action_prompt: `${actionPrompt}\n\nReturn the result as flashcards.` },
      model: { model: action.model, effort: null },
      outputMode: 'json'
    })
    return { kind: 'cards', cards: r.data.cards.map((g) => fromGenerated(g, 'question_answer', { type: 'explain', ref: action.name })) }
  }
  const r = await runAI<string>({ task: 'custom_action', deckId, vars: { ...fullVars, action_prompt: actionPrompt }, model: { model: action.model, effort: null }, outputMode: 'markdown', onDelta })
  return { kind: 'markdown', text: r.text }
}

// ---------- note quick actions ----------
const NOTE_TASKS = { simplify: 'note_simplify', shorten: 'note_shorten', fix_formatting: 'note_fix_formatting', expand: 'note_expand' } as const
export async function noteAction(kind: keyof typeof NOTE_TASKS, text: string, noteId: string | null, onDelta: (t: string) => void): Promise<string> {
  const title = noteId ? repo.getNote(noteId).title : ''
  const r = await runAI<string>({ task: NOTE_TASKS[kind], vars: { source_text: text, title, instructions: '' }, onDelta })
  return r.text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1')
}
