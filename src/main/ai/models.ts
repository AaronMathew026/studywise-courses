import { TASK_INFO, TASKS, type TaskId } from '@shared/tasks'
import type { ModelChoice } from '@shared/types'
import { getSetting, setSetting, getDeck } from '../db/repo'

export function globalModels(): Record<TaskId, ModelChoice> {
  const saved = getSetting<Record<string, ModelChoice>>('models', {})
  const out = {} as Record<TaskId, ModelChoice>
  for (const t of TASKS) out[t] = { model: saved[t]?.model || TASK_INFO[t].defaultModel, effort: saved[t]?.effort ?? null }
  return out
}

export function setGlobalModel(task: TaskId, choice: ModelChoice): void {
  const saved = getSetting<Record<string, ModelChoice>>('models', {})
  saved[task] = choice
  setSetting('models', saved)
}

export function resetGlobalModels(): void {
  setSetting('models', {})
}

/** Deck override wins over the global table. Note quick actions share one row. */
export function modelFor(task: TaskId, deckId?: string | null): ModelChoice {
  const base = globalModels()[task]
  if (deckId) {
    try {
      const o = getDeck(deckId).model_overrides[task]
      if (o?.model) return { model: o.model, effort: o.effort ?? base.effort }
    } catch {
      /* deck gone */
    }
  }
  return base
}
