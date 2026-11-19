import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { diffLines } from 'diff'
import {
  Terminal,
  RefreshCw,
  FolderOpen,
  CheckCircle2,
  XCircle,
  Play,
  Copy,
  Star,
  RotateCcw,
  History,
  Trash2,
  Upload,
  Download,
  Plus,
  Save,
  Sparkles,
  Cpu,
  Settings as Gear,
  Activity,
  Wand2,
  Info,
  Archive
} from 'lucide-react'
import type { Preset, PresetVersion, CustomAction, ModelChoice, AiCall, Thresholds } from '@shared/types'
import { ACTION_PLACEMENTS, DEFAULT_THRESHOLDS } from '@shared/types'
import { TASK_INFO, TASKS, MODEL_ALIASES, EFFORT_LEVELS, type TaskId } from '@shared/tasks'
import { useStore, toast } from '../lib/store'
import { api, streamCall, errorText } from '../lib/api'
import { useCommands } from '../lib/commands'
import { confirmDialog, askText } from '../lib/dialogs'
import { Shell, PageTitle } from '../components/Shell'
import { Button, Card, Field, Input, Modal, Pill, Segmented, Select, Textarea, Toggle, cx, Kbd } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { UsageBars } from '../components/UsageMeter'

const TABS = [
  { id: 'general', label: 'General', icon: Gear },
  { id: 'claude', label: 'Claude Code', icon: Terminal },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'prompts', label: 'Prompts', icon: Sparkles },
  { id: 'actions', label: 'Custom actions', icon: Wand2 },
  { id: 'usage', label: 'AI usage', icon: Activity }
] as const

export function Settings({ tab = 'general' }: { tab?: string }) {
  const go = useStore((s) => s.go)
  const cur = TABS.find((t) => t.id === tab) ? tab : 'general'
  useCommands({
    'go.nextDeck': () => {
      const i = TABS.findIndex((t) => t.id === cur)
      go({ name: 'settings', tab: TABS[(i + 1) % TABS.length].id })
    },
    'go.prevDeck': () => {
      const i = TABS.findIndex((t) => t.id === cur)
      go({ name: 'settings', tab: TABS[(i - 1 + TABS.length) % TABS.length].id })
    }
  }, [cur])
  return (
    <Shell wide>
      <PageTitle eyebrow="Studywise" title="Settings" />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go({ name: 'settings', tab: t.id })}
            className={cx(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.92rem] font-semibold transition-[background,color,transform] duration-300 active:scale-95',
              cur === t.id ? 'bg-ink text-bg' : 'bg-surface-2 text-muted hover:text-ink'
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>
      <div key={cur} className="page-in">
        {cur === 'general' && <General />}
        {cur === 'claude' && <ClaudeTab />}
        {cur === 'models' && <ModelsTab />}
        {cur === 'prompts' && <PromptsTab />}
        {cur === 'actions' && <ActionsTab />}
        {cur === 'usage' && <UsageTab />}
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function General() {
  const [s, setS] = useState<Record<string, unknown>>({})
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.app.info>> | null>(null)
  useEffect(() => {
    void api.settings.all().then(setS)
    void api.app.info().then(setInfo)
  }, [])
  const set = async (key: string, value: unknown) => {
    setS((cur) => ({ ...cur, [key]: value }))
    await api.settings.set({ key, value })
  }
  const th = (s.thresholds as Thresholds) ?? DEFAULT_THRESHOLDS
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Appearance</h3>
        <Field label="Theme">
          <Segmented
            value={(s['ui.theme'] as string) ?? 'system'}
            onChange={(v) => {
              void set('ui.theme', v)
              document.documentElement.dataset.theme = v
              document.documentElement.classList.toggle('dark', v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches))
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </Field>
        <p className="text-[0.85rem] text-muted">
          Text size: <Kbd>⌘=</Kbd> <Kbd>⌘-</Kbd> <Kbd>⌘0</Kbd>. Cycle theme: <Kbd>⇧⌘L</Kbd>.
        </p>
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">AI jobs</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Parallel calls">
            <Input type="number" min={1} max={8} value={Number(s['ai.concurrency'] ?? 3)} onChange={(e) => set('ai.concurrency', Math.max(1, Math.min(8, Number(e.target.value) || 3)))} />
          </Field>
          <Field label="Timeout (s)">
            <Input type="number" min={30} max={900} value={Number(s['ai.timeoutSec'] ?? 120)} onChange={(e) => set('ai.timeoutSec', Math.max(30, Number(e.target.value) || 120))} />
          </Field>
          <Field label="Long jobs (s)">
            <Input type="number" min={120} max={7200} value={Number(s['ai.longTimeoutSec'] ?? 900)} onChange={(e) => set('ai.longTimeoutSec', Math.max(120, Number(e.target.value) || 900))} />
          </Field>
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Spaced repetition</h3>
        <Segmented
          value={(s['review.scheduler'] as string) ?? 'adaptive'}
          onChange={(v) => set('review.scheduler', v)}
          options={[
            { value: 'adaptive', label: 'Difficulty-based' },
            { value: 'sm2', label: 'SM-2' }
          ]}
        />
        <p className="text-[0.88rem] text-muted">
          {((s['review.scheduler'] as string) ?? 'adaptive') === 'adaptive'
            ? 'Cards start at difficulty 0.60 with three 1-day steps, then intervals grow fast (≈3, 8, 20, 115, 280+ days). A card comes back after interval × (0.694 − 0.187 × difficulty), so harder cards return sooner.'
            : 'Classic SuperMemo-2: ease factor starts at 2.5, intervals go 1 → 6 → interval × ease. Again resets the card.'}
        </p>
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Free-answer marking</h3>
        <p className="text-[0.9rem] text-muted">Scores are out of 10. Decks can override these.</p>
        <Field label={`Correct at ${th.correct} or more`}>
          <input type="range" min={1} max={10} value={th.correct} onChange={(e) => set('thresholds', { ...th, correct: Number(e.target.value), partial: Math.min(th.partial, Number(e.target.value) - 1) })} className="accent-[var(--accent)]" />
        </Field>
        <Field label={`Partial at ${th.partial} or more (below is wrong)`}>
          <input type="range" min={0} max={9} value={th.partial} onChange={(e) => set('thresholds', { ...th, partial: Math.min(Number(e.target.value), th.correct - 1) })} className="accent-[var(--accent)]" />
        </Field>
      </Card>
      <Card className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Archive className="size-5" /> Your library
        </h3>
        <p className="text-[0.9rem] text-muted break-all">
          Everything lives in <code className="font-mono text-[0.85em]">{info?.userData}</code>: the database, attachments, cache and logs.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => api.app.showDataFolder()}>
            Show data folder in Finder
          </Button>
          <Button onClick={async () => (await api.app.backup()) && toast('Backup saved', 'good')}>
            Back up (.zip)
          </Button>
          <Button onClick={() => api.app.restore().catch((e) => toast(errorText(e), 'bad'))}>
            Restore…
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Info className="size-5" /> About
        </h3>
        <p className="text-[0.92rem] text-muted">
          Studywise {info?.version} · Electron {info?.electron} {info?.mock && <Pill tone="warn">AI_MOCK on</Pill>}
        </p>
        <p className="text-[0.92rem] text-muted">
          Every AI feature runs through the Claude Code CLI on this Mac, using your own Claude subscription. Studywise never sees or stores your login. Use is subject to Anthropic’s terms.
        </p>
      </Card>
    </div>
  )
}

function ClaudeTab() {
  const claude = useStore((s) => s.claude)
  const setClaude = useStore((s) => s.setClaude)
  const [busy, setBusy] = useState(false)
  const recheck = async () => {
    setBusy(true)
    setClaude(await api.claude.recheck())
    setBusy(false)
  }
  const ok = !!claude?.path && claude.loggedIn
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className={cx('grid size-12 place-items-center rounded-full', ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad')}>{ok ? <CheckCircle2 className="size-6" /> : <XCircle className="size-6" />}</span>
          <div>
            <div className="text-lg font-semibold">{ok ? 'Claude Code is ready' : claude?.path ? 'Not logged in' : 'Claude Code not found'}</div>
            <div className="text-[0.9rem] text-muted">{claude?.authMethod ? `Signed in via ${claude.authMethod}` : claude?.error}</div>
          </div>
        </div>
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[0.92rem]">
          <dt className="text-muted">Path</dt>
          <dd className="font-mono text-[0.85rem] break-all">{claude?.path ?? '—'}</dd>
          <dt className="text-muted">Version</dt>
          <dd>{claude?.version ?? '—'}</dd>
          <dt className="text-muted">Override</dt>
          <dd className="font-mono text-[0.85rem] break-all">{claude?.overridePath ?? 'none (auto-detect)'}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} onClick={recheck}>
            Re-check
          </Button>
          <Button onClick={async () => setClaude(await api.claude.choose())}>
            Choose…
          </Button>
          {claude?.overridePath && (
            <Button variant="ghost" onClick={async () => setClaude(await api.claude.clearOverride())}>
              Use auto-detect
            </Button>
          )}
        </div>
      </Card>
      <Card className="flex flex-col gap-3 text-[0.92rem]">
        <h3 className="text-lg font-semibold">How it works</h3>
        <p className="text-muted">Studywise runs the official <code className="font-mono">claude</code> CLI in print mode for every AI feature, with no tools except read-only access to a PDF you give it. API keys are removed from its environment, so it always uses your Claude login.</p>
        <p className="text-muted">Apps opened from Finder don’t see your shell’s PATH, so Studywise asks your login shell for it once, then also checks ~/.claude/local, ~/.local/bin, Homebrew, /usr/local/bin and npm’s global bin.</p>
        <div className="rounded-lg bg-surface-2 p-3 font-mono text-[0.82rem]">
          npm install -g @anthropic-ai/claude-code
          <br />
          claude   # sign in once
        </div>
      </Card>
    </div>
  )
}

function ModelsTab() {
  const [models, setModels] = useState<Record<string, ModelChoice> | null>(null)
  const [tests, setTests] = useState<Record<string, { ok: boolean; reply: string; ms: number } | 'running'>>({})
  useEffect(() => void api.models.get().then(setModels), [])
  if (!models) return <div className="skeleton h-80" />
  const set = async (task: TaskId, choice: ModelChoice) => {
    setModels({ ...models, [task]: choice })
    await api.models.set({ task, choice })
  }
  const test = async (task: TaskId) => {
    setTests((t) => ({ ...t, [task]: 'running' }))
    const r = await api.models.test({ model: models[task].model, effort: models[task].effort })
    setTests((t) => ({ ...t, [task]: r }))
  }
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold">Model per task</h3>
          <p className="text-[0.9rem] text-muted">Aliases always point at the newest model. Type a full model name for a specific one. Decks can override any row.</p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            await api.models.reset()
            setModels(await api.models.get())
          }}
        >
          Reset defaults
        </Button>
      </div>
      <div className="grid grid-cols-[1.3fr_1.4fr_1fr_auto] items-center gap-x-3 border-b border-line bg-surface-2/60 px-5 py-2 text-[0.75rem] font-semibold text-muted max-md:hidden">
        <span>Task</span>
        <span>Model</span>
        <span>Thinking / effort</span>
        <span>Test</span>
      </div>
      {TASKS.map((t) => {
        const m = models[t]
        const isAlias = (MODEL_ALIASES as readonly string[]).includes(m.model)
        const r = tests[t]
        return (
          <div key={t} className="grid grid-cols-[1.3fr_1.4fr_1fr_auto] items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2.5 last:border-0 max-md:grid-cols-1">
            <div>
              <div className="font-semibold">{TASK_INFO[t].label}</div>
              <div className="font-mono text-[0.75rem] text-muted">{t}</div>
            </div>
            <div className="flex gap-2">
              <Select value={isAlias ? m.model : '__custom'} onChange={(e) => set(t, { ...m, model: e.target.value === '__custom' ? '' : e.target.value })} className="h-9 w-32 shrink-0">
                {MODEL_ALIASES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
                <option value="__custom">Full name…</option>
              </Select>
              {!isAlias && <Input value={m.model} onChange={(e) => setModels({ ...models, [t]: { ...m, model: e.target.value } })} onBlur={(e) => set(t, { ...m, model: e.target.value.trim() || TASK_INFO[t].defaultModel })} placeholder="claude-…" className="h-9 font-mono text-[0.85rem]" />}
            </div>
            <Select value={m.effort ?? ''} onChange={(e) => set(t, { ...m, effort: e.target.value || null })} className="h-9">
              <option value="">Default</option>
              {EFFORT_LEVELS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Button size="sm" loading={r === 'running'} onClick={() => test(t)}>
                Test
              </Button>
              {r && r !== 'running' && (
                <span title={r.reply} className={cx('max-w-40 truncate text-[0.8rem]', r.ok ? 'text-good' : 'text-bad')}>
                  {r.ok ? `✓ ${(r.ms / 1000).toFixed(1)}s` : `✗ ${r.reply}`}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </Card>
  )
}

// ---------------------------------------------------------------------------

const SAMPLE_VARS: Record<string, unknown> = {
  front: 'Explain why a threshold frequency exists (2)',
  back: '- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron',
  required_points: 2,
  question: 'Explain why a threshold frequency exists (2)',
  expected_answer: 'photons below the threshold have less energy than the work function, so cannot remove an electron',
  user_answer: 'because the light is not bright enough',
  source_text: 'The photoelectric effect: light above a threshold frequency ejects electrons from a metal. The work function is the minimum energy needed to remove an electron. Each electron absorbs one photon. E = hf.',
  instructions: '',
  deck_name: 'Quantum physics',
  title: 'The photoelectric effect',
  module: 'PHYS101',
  type: 'Lecture',
  week: '4',
  level: 'A-level',
  language: '',
  count: 5,
  format: 'question_answer',
  card_type: 'regular',
  mode: 'Explain this card clearly.',
  history: 'Me: why does brightness not matter?',
  previous_hints: '(none)',
  problem: 'Question says (3) but the answer has 2 bullets',
  cards: JSON.stringify([{ card_id: 'c1', type: 'multiple_choice', front: 'What is the work function?', back: 'the minimum energy needed to remove an electron from the surface of a metal' }], null, 1),
  action_prompt: 'Explain like I’m 12: what is the work function?'
}

const cmTheme = EditorView.theme({ '&': { color: 'var(--ink)', fontSize: '0.85rem' }, '.cm-scroller': { fontFamily: 'var(--font-mono)' }, '.cm-content': { padding: '10px 0' } })

function PromptsTab() {
  const [task, setTask] = useState<TaskId>('generate_cards')
  const [presets, setPresets] = useState<Preset[]>([])
  const [sel, setSel] = useState<string>('')
  const [draft, setDraft] = useState<{ name: string; system: string; user_template: string; output_mode: Preset['output_mode'] } | null>(null)
  const [varsText, setVarsText] = useState('')
  const [preview, setPreview] = useState<{ system: string; prompt: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState<{ ok: boolean; raw: string; parsed: unknown; error?: string; ms: number } | null>(null)
  const [streamRaw, setStreamRaw] = useState('')
  const [versions, setVersions] = useState<PresetVersion[] | null>(null)
  const [diffWith, setDiffWith] = useState<PresetVersion | null>(null)
  const editor = useRef<ReactCodeMirrorRef>(null)

  const loadPresets = async (keep?: string) => {
    const p = await api.presets.list({ task })
    setPresets(p)
    const pick = p.find((x) => x.id === keep) ?? p.find((x) => x.is_default) ?? p[0]
    setSel(pick?.id ?? '')
  }
  useEffect(() => {
    void loadPresets()
    const vars = Object.fromEntries(TASK_INFO[task].variables.concat(task === 'custom_action' ? ['action_prompt'] : []).map((v) => [v, SAMPLE_VARS[v] ?? '']))
    setVarsText(JSON.stringify(vars, null, 2))
    setTestOut(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])
  const preset = presets.find((p) => p.id === sel)
  useEffect(() => {
    if (preset) setDraft({ name: preset.name, system: preset.system, user_template: preset.user_template, output_mode: preset.output_mode })
    setVersions(null)
    setTestOut(null)
  }, [preset?.id, preset?.version])

  const dirty = !!preset && !!draft && (draft.system !== preset.system || draft.user_template !== preset.user_template || draft.name !== preset.name || draft.output_mode !== preset.output_mode)
  const vars = useMemo(() => {
    try {
      return JSON.parse(varsText) as Record<string, unknown>
    } catch {
      return null
    }
  }, [varsText])

  useEffect(() => {
    if (!preset || !draft || !vars) return
    const t = setTimeout(() => {
      void api.presets
        .preview({ id: preset.id, vars, override: { system: draft.system, user_template: draft.user_template, output_mode: draft.output_mode } })
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(t)
  }, [preset, draft, vars])

  const save = async () => {
    if (!preset || !draft) return
    await api.presets.update({ id: preset.id, patch: draft })
    toast(`Saved ${draft.name}`, 'good')
    await loadPresets(preset.id)
  }
  useCommands({ 'note.save': dirty ? save : null }, [dirty, draft])

  const insertVar = (v: string) => {
    const view = editor.current?.view
    if (!view) return
    view.dispatch(view.state.replaceSelection(`{{${v}}}`))
    view.focus()
  }
  const runTest = async () => {
    if (!preset || !draft || !vars) return
    setTesting(true)
    setTestOut(null)
    setStreamRaw('')
    try {
      const r = await streamCall((streamId) => api.presets.testRun({ id: preset.id, vars, override: { system: draft.system, user_template: draft.user_template, output_mode: draft.output_mode }, streamId }), setStreamRaw)
      setTestOut(r as typeof testOut)
    } finally {
      setTesting(false)
    }
  }

  const groups: [string, TaskId[]][] = [
    ['Generation', ['generate_notes', 'generate_cards', 'fix_cards']],
    ['Learn', ['make_questions', 'make_categorize', 'mark_free_answer', 'mark_fill_blank', 'feedback_wrong', 'feedback_right', 'hint']],
    ['Explain', ['explain', 'explain_chat', 'custom_action']],
    ['Notes', ['note_simplify', 'note_shorten', 'note_fix_formatting', 'note_expand']]
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => (await api.presets.exportFile()) && toast('Exported presets & actions', 'good')}>
            Export
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              try {
                const r = await api.presets.importFile()
                if (r) {
                  toast(`Imported ${r.presets} presets, ${r.actions} actions`, 'good')
                  await loadPresets(sel)
                }
              } catch (e) {
                toast(errorText(e), 'bad')
              }
            }}
          >
            Import
          </Button>
        </div>
        {groups.map(([g, ts]) => (
          <div key={g}>
            <div className="mb-1 px-2 text-[0.72rem] font-semibold text-muted">{g}</div>
            {ts.map((t) => (
              <button key={t} onClick={() => setTask(t)} className={cx('block w-full rounded-full px-3 py-1.5 text-left text-[0.9rem] transition-colors', task === t ? 'bg-accent-soft font-semibold' : 'hover:bg-surface-2')}>
                {TASK_INFO[t].label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {preset && draft && (
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={sel} onChange={(e) => setSel(e.target.value)} className="w-auto min-w-56">
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.is_default ? '★' : ''} · v{p.version}
                  </option>
                ))}
              </Select>
              {preset.is_default ? (
                <Pill tone="accent">
                  <Star className="size-3" /> Default
                </Pill>
              ) : (
                <Button size="sm" variant="soft" onClick={async () => (await api.presets.setDefault({ id: preset.id }), loadPresets(preset.id))}>
                  Make default
                </Button>
              )}
              {preset.builtin_key && <Pill>Built-in</Pill>}
              <span className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const name = await askText('Duplicate preset', { initial: `${preset.name} (copy)` })
                  if (name) {
                    const p = await api.presets.duplicate({ id: preset.id, name })
                    await loadPresets(p.id)
                  }
                }}
              >
                Duplicate
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => setVersions(await api.presets.versions({ id: preset.id }))}>
                History
              </Button>
              {preset.builtin_key ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (await confirmDialog('Reset to the built-in version?', 'Your edits stay in the history.')) {
                      await api.presets.reset({ id: preset.id })
                      await loadPresets(preset.id)
                    }
                  }}
                >
                  Reset
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (await confirmDialog(`Delete “${preset.name}”?`, undefined, { danger: true })) {
                      await api.presets.delete({ id: preset.id })
                      await loadPresets()
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>
                Save
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Name">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Output">
                <Select value={draft.output_mode} onChange={(e) => setDraft({ ...draft, output_mode: e.target.value as Preset['output_mode'] })} disabled={TASK_INFO[task].modes.length === 1}>
                  {TASK_INFO[task].modes.map((m) => (
                    <option key={m} value={m}>
                      {m === 'studysmarter_text' ? 'StudySmarter text' : m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {draft.output_mode === 'json' && (
              <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-4 py-2.5 text-[0.88rem]">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                The JSON output schema is added by the app and can’t be edited, so a custom prompt can change what Claude says but never breaks parsing.
              </div>
            )}
            {draft.output_mode === 'studysmarter_text' && (
              <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-4 py-2.5 text-[0.88rem]">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                Output is parsed as <code className="font-mono">question/#*#/answer</code> cards separated by lines with just <code className="font-mono">#</code>. Long outputs auto-continue in the same session.
              </div>
            )}
            <Field label="System prompt">
              <div className="rounded-lg border border-line bg-surface-2/50 px-3">
                <CodeMirror value={draft.system} onChange={(v) => setDraft({ ...draft, system: v })} extensions={[EditorView.lineWrapping, cmTheme]} basicSetup={{ lineNumbers: false, foldGutter: false }} theme="none" maxHeight="160px" />
              </div>
            </Field>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[0.8rem] font-semibold text-muted">User template</span>
                {TASK_INFO[task].variables.concat(task === 'custom_action' ? ['action_prompt'] : []).map((v) => (
                  <button key={v} onClick={() => insertVar(v)} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[0.75rem] transition-colors hover:bg-accent-soft" title="Insert">
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-line bg-surface-2/50 px-3">
                <CodeMirror ref={editor} value={draft.user_template} onChange={(v) => setDraft({ ...draft, user_template: v })} extensions={[markdown(), EditorView.lineWrapping, cmTheme]} basicSetup={{ lineNumbers: true, foldGutter: false }} theme="none" maxHeight="420px" />
              </div>
            </div>
          </Card>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Card className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">Sample variables</h3>
              <Textarea rows={8} value={varsText} onChange={(e) => setVarsText(e.target.value)} className={cx('font-mono text-[0.8rem]', !vars && 'border-bad')} />
              <h3 className="font-semibold">Live preview (what Claude receives)</h3>
              <pre className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[0.75rem] whitespace-pre-wrap">{preview ? `── system ──\n${preview.system}\n\n── prompt ──\n${preview.prompt}` : 'Fix the sample JSON to see a preview.'}</pre>
            </Card>
            <Card className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Test run</h3>
                <Button variant="primary" size="sm" loading={testing} onClick={runTest} disabled={!vars}>
                  Run with Claude
                </Button>
              </div>
              {(testing || testOut) && (
                <>
                  <div className="text-[0.8rem] font-semibold text-muted">Raw output {testOut && `· ${(testOut.ms / 1000).toFixed(1)}s`}</div>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[0.75rem] whitespace-pre-wrap">{testOut?.raw || streamRaw || (testing ? '…' : '')}</pre>
                  {testOut && (
                    <>
                      <div className="text-[0.8rem] font-semibold text-muted">Parsed</div>
                      {testOut.ok ? (
                        typeof testOut.parsed === 'string' ? (
                          <div className="max-h-80 overflow-auto rounded-lg border border-line p-3">
                            <Markdown>{testOut.parsed}</Markdown>
                          </div>
                        ) : (
                          <pre className="max-h-80 overflow-auto rounded-lg bg-good-soft p-3 font-mono text-[0.75rem] whitespace-pre-wrap">{JSON.stringify(testOut.parsed, null, 2)}</pre>
                        )
                      ) : (
                        <div className="rounded-lg bg-bad-soft p-3 text-[0.9rem] text-bad">{testOut.error}</div>
                      )}
                    </>
                  )}
                </>
              )}
              {!testing && !testOut && <p className="text-[0.9rem] text-muted">Runs this (unsaved) prompt against the sample variables and shows the raw reply and what the app parsed from it.</p>}
            </Card>
          </div>
        </div>
      )}

      <Modal open={!!versions} onClose={() => (setVersions(null), setDiffWith(null))} title="Version history" wide>
        {versions && versions.length === 0 && <p className="text-muted">No earlier versions yet. Saving an edit keeps the previous version here.</p>}
        <div className="flex flex-col gap-2">
          {versions?.map((v) => (
            <div key={v.version} className="flex items-center gap-3 rounded-lg border border-line px-4 py-2.5">
              <span className="font-semibold">v{v.version}</span>
              <span className="flex-1 text-[0.85rem] text-muted">{new Date(v.created_at).toLocaleString()}</span>
              <Button size="sm" variant="ghost" onClick={() => setDiffWith(diffWith?.version === v.version ? null : v)}>
                {diffWith?.version === v.version ? 'Hide diff' : 'Diff with current'}
              </Button>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  if (draft) setDraft({ ...draft, system: v.system, user_template: v.user_template })
                  setVersions(null)
                  toast(`Loaded v${v.version} into the editor. Save to keep it.`, 'info')
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
        {diffWith && draft && (
          <pre className="mt-4 max-h-[50vh] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[0.75rem] whitespace-pre-wrap">
            {diffLines(`${diffWith.system}\n\n${diffWith.user_template}`, `${draft.system}\n\n${draft.user_template}`).map((part, i) => (
              <span key={i} className={part.added ? 'bg-good-soft text-good' : part.removed ? 'bg-bad-soft text-bad line-through' : 'text-muted'}>
                {part.value}
              </span>
            ))}
          </pre>
        )}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------

const PLACEMENT_LABEL: Record<string, string> = { card: 'On cards', note_selection: 'Note selection', learn_question: 'Learn question', after_answer: 'After answering' }

function ActionsTab() {
  const [actions, setActions] = useState<CustomAction[]>([])
  const [edit, setEdit] = useState<Partial<CustomAction> | null>(null)
  const load = () => void api.actions.list().then(setActions)
  useEffect(load, [])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-muted">Your own AI buttons. Each one renders its prompt with the card or selection and either shows Markdown in the Explain panel or makes new cards.</p>
        <Button variant="primary" onClick={() => setEdit({ name: '', prompt: 'Q: {{front}}\nA: {{back}}\n{{source_text}}\n\n', model: 'sonnet', output: 'markdown', placements: ['card'], icon: 'sparkles' })}>
          New action
        </Button>
      </div>
      <div className="stagger grid gap-3 md:grid-cols-2">
        {actions.map((a) => (
          <Card key={a.id} className="flex flex-col gap-2" onClick={() => setEdit(a)}>
            <div className="flex items-center gap-2">
              <span className="text-accent">
                <Sparkles className="size-4" />
              </span>
              <span className="flex-1 font-semibold">{a.name}</span>
              <Pill>{a.model}</Pill>
              <Pill tone="accent">{a.output === 'cards' ? 'New cards' : 'Markdown'}</Pill>
            </div>
            <p className="line-clamp-2 font-mono text-[0.78rem] text-muted">{a.prompt}</p>
            <div className="flex flex-wrap gap-1">
              {a.placements.map((p) => (
                <Pill key={p}>{PLACEMENT_LABEL[p]}</Pill>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          wide
          title={edit.id ? 'Edit action' : 'New action'}
          footer={
            <>
              {edit.id && (
                <Button
                  variant="danger"
                  className="mr-auto"
                  onClick={async () => {
                    if (await confirmDialog(`Delete “${edit.name}”?`, undefined, { danger: true })) {
                      await api.actions.delete({ id: edit.id! })
                      setEdit(null)
                      load()
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!edit.name?.trim() || !edit.prompt?.trim()) return toast('Name and prompt are required', 'bad')
                  await api.actions.save({ ...edit, name: edit.name, prompt: edit.prompt })
                  setEdit(null)
                  load()
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" className="sm:col-span-1">
                <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
              </Field>
              <Field label="Model">
                <Input value={edit.model ?? 'sonnet'} onChange={(e) => setEdit({ ...edit, model: e.target.value })} list="model-aliases" />
                <datalist id="model-aliases">
                  {MODEL_ALIASES.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label="Output">
                <Segmented
                  value={edit.output ?? 'markdown'}
                  onChange={(v) => setEdit({ ...edit, output: v })}
                  options={[
                    { value: 'markdown', label: 'Markdown' },
                    { value: 'cards', label: 'New cards' }
                  ]}
                />
              </Field>
            </div>
            <Field label="Prompt" hint="Variables: {{front}} {{back}} {{question}} {{user_answer}} {{expected_answer}} {{source_text}} {{deck_name}} {{required_points}}">
              <Textarea rows={8} value={edit.prompt ?? ''} onChange={(e) => setEdit({ ...edit, prompt: e.target.value })} className="font-mono text-[0.85rem]" />
            </Field>
            <Field label="Show it on">
              <div className="flex flex-wrap gap-4">
                {ACTION_PLACEMENTS.map((p) => (
                  <Toggle
                    key={p}
                    checked={!!edit.placements?.includes(p)}
                    onChange={(v) => setEdit({ ...edit, placements: v ? [...(edit.placements ?? []), p] : (edit.placements ?? []).filter((x) => x !== p) })}
                    label={PLACEMENT_LABEL[p]}
                  />
                ))}
              </div>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

function UsageTab() {
  const [calls, setCalls] = useState<AiCall[]>([])
  const [summary, setSummary] = useState<{ task: string; model: string; calls: number; ok: number; avg_ms: number; input_tokens: number; output_tokens: number }[]>([])
  const load = () => {
    void api.ai.calls({ limit: 300 }).then(setCalls)
    void api.ai.summary().then((s) => setSummary(s as typeof summary))
  }
  useEffect(load, [])
  const totalIn = summary.reduce((n, s) => n + s.input_tokens, 0)
  const totalOut = summary.reduce((n, s) => n + s.output_tokens, 0)
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="mb-3 font-semibold">Claude plan usage</h3>
        <UsageBars />
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-[0.75rem] font-semibold text-muted">Calls</div>
          <div className="text-3xl font-semibold">{summary.reduce((n, s) => n + s.calls, 0)}</div>
        </Card>
        <Card>
          <div className="text-[0.75rem] font-semibold text-muted">Input tokens</div>
          <div className="text-3xl font-semibold">{totalIn.toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-[0.75rem] font-semibold text-muted">Output tokens</div>
          <div className="text-3xl font-semibold">{totalOut.toLocaleString()}</div>
        </Card>
      </div>
      <Card className="!p-0 overflow-x-auto">
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="font-semibold">By task</h3>
          <Button size="sm" variant="ghost" onClick={load}>
            Refresh
          </Button>
        </div>
        <table className="w-full text-[0.88rem]">
          <thead className="bg-surface-2/60 text-left text-[0.75rem] text-muted">
            <tr>
              {['Task', 'Model', 'Calls', 'OK', 'Avg time', 'Tokens in / out'].map((h) => (
                <th key={h} className="px-5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((s, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-5 py-2 font-semibold">{TASK_INFO[s.task as TaskId]?.label ?? s.task}</td>
                <td className="px-5 py-2 font-mono text-[0.8rem]">{s.model}</td>
                <td className="px-5 py-2">{s.calls}</td>
                <td className="px-5 py-2">{s.ok}</td>
                <td className="px-5 py-2">{(s.avg_ms / 1000).toFixed(1)}s</td>
                <td className="px-5 py-2">
                  {s.input_tokens.toLocaleString()} / {s.output_tokens.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="!p-0 overflow-x-auto">
        <h3 className="px-5 py-3 font-semibold">Recent calls</h3>
        <table className="w-full text-[0.85rem]">
          <thead className="bg-surface-2/60 text-left text-[0.75rem] text-muted">
            <tr>
              {['When', 'Task', 'Preset', 'Model', 'Time', 'Tokens', 'Result'].map((h) => (
                <th key={h} className="px-4 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="border-t border-line align-top">
                <td className="px-4 py-2 whitespace-nowrap text-muted">{new Date(c.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{c.task}</td>
                <td className="px-4 py-2">
                  {c.preset_name} {c.preset_version != null && <span className="text-muted">v{c.preset_version}</span>}
                </td>
                <td className="px-4 py-2 font-mono text-[0.78rem]">{c.model}</td>
                <td className="px-4 py-2">{(c.duration_ms / 1000).toFixed(1)}s</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.input_tokens != null ? `${c.input_tokens} / ${c.output_tokens}` : '—'}</td>
                <td className="px-4 py-2">{c.ok ? <span className="text-good">ok</span> : <span className="text-bad" title={c.error ?? ''}>{(c.error ?? 'error').slice(0, 60)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
