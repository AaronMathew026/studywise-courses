import { TASK_INFO, TASKS, ollamaKey, type TaskId } from '@shared/tasks'
import type { AiProvider, ModelChoice } from '@shared/types'
import { getSetting, setSetting, getDeck } from '../db/repo'

export function activeProvider(): AiProvider {
  return getSetting<string>('ai.provider', 'claude') === 'ollama' ? 'ollama' : 'claude'
}

export function setActiveProvider(p: AiProvider): void {
  setSetting('ai.provider', p)
}

const tableKey = (p: AiProvider) => (p === 'ollama' ? 'models.ollama' : 'models')

/**
 * The per-task table for a provider. Claude rows are filled with the task's
 * default alias. Ollama rows keep model '' to mean "use the default model".
 */
export function globalModels(provider: AiProvider = activeProvider()): Record<TaskId, ModelChoice> {
  const saved = getSetting<Record<string, ModelChoice>>(tableKey(provider), {})
  const out = {} as Record<TaskId, ModelChoice>
  for (const t of TASKS) {
    const model = saved[t]?.model || (provider === 'claude' ? TASK_INFO[t].defaultModel : '')
    out[t] = { model, effort: saved[t]?.effort ?? null }
  }
  return out
}

export function setGlobalModel(task: TaskId, choice: ModelChoice, provider: AiProvider = activeProvider()): void {
  const saved = getSetting<Record<string, ModelChoice>>(tableKey(provider), {})
  saved[task] = { model: choice.model, effort: choice.effort ?? null }
  setSetting(tableKey(provider), saved)
}

export function resetGlobalModels(provider: AiProvider = activeProvider()): void {
  setSetting(tableKey(provider), {})
}

export function ollamaDefaultModel(): string {
  return getSetting<string>('ollama.defaultModel', '')
}

/** True for Claude aliases and full Claude model names. */
export function isClaudeModel(name: string): boolean {
  return /^(haiku|sonnet|opus|default|best)$/i.test(name) || /^claude-/i.test(name)
}

/** Deck override wins over the global table. Note quick actions share one row. */
export function modelFor(task: TaskId, deckId?: string | null, provider: AiProvider = activeProvider()): ModelChoice {
  const base = globalModels(provider)[task]
  if (provider === 'ollama') {
    let choice: ModelChoice = { model: base.model || ollamaDefaultModel(), effort: base.effort }
    if (deckId) {
      try {
        const o = getDeck(deckId).model_overrides[ollamaKey(task)]
        if (o?.model) choice = { model: o.model, effort: o.effort ?? choice.effort }
      } catch {
        /* deck gone */
      }
    }
    return { ...choice, provider: 'ollama' }
  }
  if (deckId) {
    try {
      const o = getDeck(deckId).model_overrides[task]
      if (o?.model) return { model: o.model, effort: o.effort ?? base.effort, provider: 'claude' }
    } catch {
      /* deck gone */
    }
  }
  return { ...base, provider: 'claude' }
}

/**
 * The model a call actually uses. An explicit choice is kept when it belongs to
 * the active provider; Claude names (custom actions default to "sonnet", the
 * usage ping uses "haiku") fall back to the task's Ollama model.
 */
export function resolveModel(task: TaskId, deckId: string | null | undefined, explicit?: ModelChoice): ModelChoice {
  if (explicit?.provider) return explicit
  const provider = activeProvider()
  if (explicit?.model) {
    if (provider === 'claude') return { ...explicit, provider }
    if (!isClaudeModel(explicit.model)) return { ...explicit, provider }
  }
  return modelFor(task, deckId, provider)
}
