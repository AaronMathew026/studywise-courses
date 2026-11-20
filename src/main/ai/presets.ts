import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getDb, uid, now, json } from '../db'
import { getSetting, setSetting } from '../db/repo'
import type { Preset, PresetVersion, CustomAction } from '@shared/types'
import { CustomAction as CustomActionSchema, OutputMode } from '@shared/types'
import { TASKS, TASK_INFO, type TaskId } from '@shared/tasks'
import { SEED_PRESETS, SEED_ACTIONS } from './prompts'

type PresetRow = Omit<Preset, 'is_default'> & { is_default: number }
const toPreset = (r: PresetRow): Preset => ({ ...r, is_default: !!r.is_default })

/** Settings key: builtin_key → hash of the prompt text the app last wrote, to tell untouched built-ins from edited ones. */
const SEEDED_KEY = 'presets.seeded'
const textHash = (p: { system: string; user_template: string }) => createHash('sha256').update(`${p.system}\u0000${p.user_template}`).digest('hex')

function markSeeded(key: string, p: { system: string; user_template: string }): void {
  setSetting(SEEDED_KEY, { ...getSetting<Record<string, string>>(SEEDED_KEY, {}), [key]: textHash(p) })
}

/**
 * Insert any built-in presets/actions that are missing, and bring built-in
 * prompts you haven't edited up to date with the app's. Never overwrites edits.
 */
export function seedPresets(): void {
  const d = getDb()
  const has = d.prepare('SELECT * FROM presets WHERE builtin_key = ?')
  const ins = d.prepare(
    `INSERT INTO presets (id, task, name, builtin_key, output_mode, system, user_template, version, is_default, updated_at)
     VALUES (@id, @task, @name, @builtin_key, @output_mode, @system, @user_template, 1, @is_default, @updated_at)`
  )
  const anyDefault = d.prepare('SELECT 1 FROM presets WHERE task = ? AND is_default = 1')
  d.transaction(() => {
    const seeded = getSetting<Record<string, string>>(SEEDED_KEY, {})
    for (const p of SEED_PRESETS) {
      const cur = has.get(p.builtin_key) as PresetRow | undefined
      if (!cur) {
        const isDefault = p.is_default && !anyDefault.get(p.task)
        ins.run({ ...p, id: uid(), is_default: isDefault ? 1 : 0, updated_at: now() })
        seeded[p.builtin_key] = textHash(p)
        continue
      }
      // Untouched: the text is what the app last wrote (or, before that was
      // tracked, it has never been edited).
      const untouched = seeded[p.builtin_key] ? seeded[p.builtin_key] === textHash(cur) : cur.version === 1
      if (!untouched) continue
      if (textHash(cur) !== textHash(p)) updatePreset(cur.id, { system: p.system, user_template: p.user_template })
      seeded[p.builtin_key] = textHash(p)
    }
    setSetting(SEEDED_KEY, seeded)
    const hasAction = d.prepare('SELECT id FROM custom_actions WHERE builtin_key = ?')
    const insAction = d.prepare(
      'INSERT INTO custom_actions (id, name, icon, prompt, model, output, placements, builtin_key, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    SEED_ACTIONS.forEach((a, i) => {
      if (hasAction.get(a.builtin_key)) return
      insAction.run(uid(), a.name, a.icon, a.prompt, a.model, a.output, JSON.stringify(a.placements), a.builtin_key, i)
    })
  })()
}

export function listPresets(task?: string): Preset[] {
  const rows = task
    ? getDb().prepare('SELECT * FROM presets WHERE task = ? ORDER BY is_default DESC, name').all(task)
    : getDb().prepare('SELECT * FROM presets ORDER BY task, is_default DESC, name').all()
  return (rows as PresetRow[]).map(toPreset)
}

export function getPreset(id: string): Preset {
  const r = getDb().prepare('SELECT * FROM presets WHERE id = ?').get(id) as PresetRow | undefined
  if (!r) throw new Error('Preset not found')
  return toPreset(r)
}

export function getPresetByKey(key: string): Preset | null {
  const r = getDb().prepare('SELECT * FROM presets WHERE builtin_key = ?').get(key) as PresetRow | undefined
  return r ? toPreset(r) : null
}

export function defaultPreset(task: TaskId): Preset {
  const r = getDb().prepare('SELECT * FROM presets WHERE task = ? ORDER BY is_default DESC, updated_at LIMIT 1').get(task) as PresetRow | undefined
  if (!r) throw new Error(`No preset for task ${task}`)
  return toPreset(r)
}

export function updatePreset(id: string, patch: { name?: string; system?: string; user_template?: string; output_mode?: Preset['output_mode'] }): Preset {
  const cur = getPreset(id)
  const changedText = (patch.system !== undefined && patch.system !== cur.system) || (patch.user_template !== undefined && patch.user_template !== cur.user_template)
  if (patch.output_mode && !TASK_INFO[cur.task as TaskId]?.modes.includes(patch.output_mode)) {
    throw new Error(`Output mode ${patch.output_mode} is not available for ${cur.task}`)
  }
  const d = getDb()
  d.transaction(() => {
    if (changedText) {
      d.prepare('INSERT OR REPLACE INTO preset_versions VALUES (?, ?, ?, ?, ?)').run(cur.id, cur.version, cur.system, cur.user_template, cur.updated_at)
    }
    d.prepare('UPDATE presets SET name=?, system=?, user_template=?, output_mode=?, version=?, updated_at=? WHERE id=?').run(
      patch.name ?? cur.name,
      patch.system ?? cur.system,
      patch.user_template ?? cur.user_template,
      patch.output_mode ?? cur.output_mode,
      changedText ? cur.version + 1 : cur.version,
      now(),
      id
    )
  })()
  return getPreset(id)
}

export function duplicatePreset(id: string, name?: string): Preset {
  const cur = getPreset(id)
  const nid = uid()
  getDb()
    .prepare(
      `INSERT INTO presets (id, task, name, builtin_key, output_mode, system, user_template, version, is_default, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 1, 0, ?)`
    )
    .run(nid, cur.task, name ?? `${cur.name} (copy)`, cur.output_mode, cur.system, cur.user_template, now())
  return getPreset(nid)
}

export function setDefaultPreset(id: string): void {
  const p = getPreset(id)
  const d = getDb()
  d.transaction(() => {
    d.prepare('UPDATE presets SET is_default = 0 WHERE task = ?').run(p.task)
    d.prepare('UPDATE presets SET is_default = 1 WHERE id = ?').run(id)
  })()
}

export function deletePreset(id: string): void {
  const p = getPreset(id)
  if (p.builtin_key) throw new Error('Built-in presets can be reset but not deleted')
  getDb().prepare('DELETE FROM presets WHERE id = ?').run(id)
  if (p.is_default) {
    const first = listPresets(p.task)[0]
    if (first) setDefaultPreset(first.id)
  }
}

export function resetPreset(id: string): Preset {
  const p = getPreset(id)
  const seed = SEED_PRESETS.find((s) => s.builtin_key === p.builtin_key)
  if (!seed) throw new Error('Only built-in presets can be reset')
  const out = updatePreset(id, { name: seed.name, system: seed.system, user_template: seed.user_template, output_mode: seed.output_mode })
  // A reset prompt follows the app's built-in text again on later updates.
  markSeeded(seed.builtin_key, seed)
  return out
}

export function presetVersions(id: string): PresetVersion[] {
  return getDb().prepare('SELECT * FROM preset_versions WHERE preset_id = ? ORDER BY version DESC').all(id) as PresetVersion[]
}

// ---------- custom actions ----------
type ActionRow = Omit<CustomAction, 'placements'> & { placements: string }
const toAction = (r: ActionRow): CustomAction => ({ ...r, placements: json(r.placements, ['card']) })

export function listActions(): CustomAction[] {
  return (getDb().prepare('SELECT * FROM custom_actions ORDER BY position, name').all() as ActionRow[]).map(toAction)
}
export function getAction(id: string): CustomAction {
  const r = getDb().prepare('SELECT * FROM custom_actions WHERE id = ?').get(id) as ActionRow | undefined
  if (!r) throw new Error('Action not found')
  return toAction(r)
}
export function saveAction(input: Partial<CustomAction> & { name: string; prompt: string }): CustomAction {
  const a = CustomActionSchema.parse({ id: input.id ?? uid(), ...input })
  getDb()
    .prepare(
      `INSERT INTO custom_actions (id, name, icon, prompt, model, output, placements, builtin_key, position) VALUES (@id, @name, @icon, @prompt, @model, @output, @placements, @builtin_key, @position)
       ON CONFLICT(id) DO UPDATE SET name=@name, icon=@icon, prompt=@prompt, model=@model, output=@output, placements=@placements, position=@position`
    )
    .run({ ...a, placements: JSON.stringify(a.placements) })
  return getAction(a.id)
}
export function deleteAction(id: string): void {
  getDb().prepare('DELETE FROM custom_actions WHERE id = ?').run(id)
}

// ---------- import / export ----------
export const PresetBundle = z.object({
  app: z.literal('studywise'),
  kind: z.literal('presets'),
  version: z.number(),
  presets: z.array(
    z.object({
      task: z.enum(TASKS),
      name: z.string(),
      builtin_key: z.string().nullable().optional(),
      output_mode: OutputMode,
      system: z.string(),
      user_template: z.string(),
      is_default: z.boolean().optional()
    })
  ),
  actions: z.array(CustomActionSchema.omit({ id: true }).partial({ builtin_key: true, position: true })).default([])
})
export type PresetBundle = z.infer<typeof PresetBundle>

export function exportPresets(): PresetBundle {
  return {
    app: 'studywise',
    kind: 'presets',
    version: 1,
    presets: listPresets().map((p) => ({
      task: p.task as TaskId,
      name: p.name,
      builtin_key: p.builtin_key,
      output_mode: p.output_mode,
      system: p.system,
      user_template: p.user_template,
      is_default: p.is_default
    })),
    actions: listActions().map(({ id: _id, ...a }) => a)
  }
}

export function importPresets(raw: unknown): { presets: number; actions: number } {
  const b = PresetBundle.parse(raw)
  let presets = 0
  let actions = 0
  getDb().transaction(() => {
    for (const p of b.presets) {
      if (!TASK_INFO[p.task].modes.includes(p.output_mode)) continue
      const existing = p.builtin_key ? getPresetByKey(p.builtin_key) : null
      if (existing) {
        updatePreset(existing.id, { name: p.name, system: p.system, user_template: p.user_template, output_mode: p.output_mode })
        if (p.is_default) setDefaultPreset(existing.id)
      } else {
        const sameName = listPresets(p.task).find((x) => x.name === p.name && !x.builtin_key)
        if (sameName) {
          updatePreset(sameName.id, { system: p.system, user_template: p.user_template, output_mode: p.output_mode })
          if (p.is_default) setDefaultPreset(sameName.id)
        } else {
          const id = uid()
          getDb()
            .prepare(
              `INSERT INTO presets (id, task, name, builtin_key, output_mode, system, user_template, version, is_default, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 1, 0, ?)`
            )
            .run(id, p.task, p.name, p.output_mode, p.system, p.user_template, now())
          if (p.is_default) setDefaultPreset(id)
        }
      }
      presets++
    }
    for (const a of b.actions) {
      const existing = listActions().find((x) => (a.builtin_key && x.builtin_key === a.builtin_key) || x.name === a.name)
      saveAction({ ...a, id: existing?.id, builtin_key: existing?.builtin_key ?? null })
      actions++
    }
  })()
  return { presets, actions }
}
