import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Trash2, RefreshCw, Wand2, AlertTriangle, Plus, Check } from 'lucide-react'
import { validateCards, type CardWarning } from '@shared/ssText'
import type { Preset, CardFormat, McOption, CardSource } from '@shared/types'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { useCommands } from '../lib/commands'
import { askText } from '../lib/dialogs'
import { Button, Field, Input, Modal, Pill, Segmented, Select, Textarea, Toggle, cx } from './ui'
import { SourcePicker, sourceFor, hasSource, initialTab, type SourceValue, type SourceTab } from './SourcePicker'
import { Markdown } from './Markdown'

export interface PreviewCardT {
  key?: string
  format: CardFormat
  kind: 'regular' | 'multiple_choice' | 'cloze'
  front: string
  back: string
  language?: string | null
  options: McOption[]
  cloze_answers: string[]
  tags: string[]
  hints: string[]
  explanation: string
  source?: CardSource | null
  required_points?: number | null
}

// Remember which deck a card job should save into.
export const jobDeck = new Map<string, string | null>()
// The "generating…" toast for a card job, cleared once the preview opens.
export const jobToast = new Map<string, number>()

export function GenerateCardsModal() {
  const prefill = useStore((s) => s.genCards)
  const close = () => useStore.getState().openGenCards(null)
  const [src, setSrc] = useState<SourceValue>({ files: [], topic: '', text: '', noteIds: [] })
  const [tab, setTab] = useState<SourceTab>('files')
  const [format, setFormat] = useState<CardFormat>('term_definition')
  const [cardType, setCardType] = useState<'regular' | 'multiple_choice'>('regular')
  const [language, setLanguage] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [auto, setAuto] = useState(true)
  const [count, setCount] = useState(20)
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([])
  const [deckId, setDeckId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!prefill) return
    const v = { files: prefill.files ?? [], topic: prefill.topic ?? '', text: prefill.text ?? '', noteIds: prefill.noteIds ?? [] }
    setSrc(v)
    setTab(initialTab(v))
    void api.presets.list({ task: 'generate_cards' }).then((p) => {
      setPresets(p)
      setPresetId(p.find((x) => x.is_default)?.id ?? p[0]?.id ?? '')
    })
    void api.decks.list().then((d) => {
      setDecks(d)
      setDeckId(prefill.deckId ?? '')
    })
  }, [prefill])

  const preset = presets.find((p) => p.id === presetId)
  const submit = async () => {
    const sources = sourceFor(tab, src)
    if (!hasSource(sources)) return toast('Add a source first', 'bad')
    setBusy(true)
    try {
      const job = await api.gen.cards({
        sources,
        deckId: deckId || null,
        presetId: presetId || undefined,
        format,
        cardType,
        language,
        instructions,
        count: auto ? null : count
      })
      jobDeck.set(job.id, deckId || null)
      jobToast.set(job.id, toast('Generating flashcards… the preview opens when they’re ready', 'info', { label: 'Jobs', run: () => useStore.getState().go({ name: 'jobs' }) }))
      close()
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  useCommands(prefill ? { 'gen.submit': submit } : {}, [prefill, src, tab, format, cardType, language, presetId, instructions, auto, count, deckId])

  return (
    <Modal
      open={!!prefill}
      onClose={close}
      wide
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" /> Generate flashcards with AI
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[0.82rem] text-muted">Runs in the background · you can keep working</span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} kbd="gen.submit">
            Generate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SourcePicker value={src} onChange={setSrc} tab={tab} setTab={setTab} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Format">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'term_definition', label: 'Term & definition' },
                { value: 'question_answer', label: 'Q & A' },
                { value: 'vocabulary', label: 'Vocabulary' }
              ]}
            />
          </Field>
          <Field label="Card type">
            <Segmented
              value={cardType}
              onChange={setCardType}
              options={[
                { value: 'regular', label: 'Regular' },
                { value: 'multiple_choice', label: 'Multiple choice' }
              ]}
            />
          </Field>
          {format === 'vocabulary' && (
            <Field label="Second language" className="sm:col-span-2">
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. Spanish" />
            </Field>
          )}
          <Field label="Prompt preset" hint={preset ? (preset.output_mode === 'studysmarter_text' ? 'StudySmarter text style · auto-continues long outputs' : 'Structured JSON cards') : undefined}>
            <Select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_default ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Save to deck">
            <Select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">Choose when saving…</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number of cards">
            <div className="flex items-center gap-3">
              <Toggle checked={auto} onChange={setAuto} label="Auto" />
              {!auto && <Input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} className="w-28" />}
            </div>
          </Field>
        </div>
        <Field label="Instructions">
          <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Anything extra, e.g. focus on chapter 3, include equations…" />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

export function CardPreviewModal() {
  const preview = useStore((s) => s.preview)
  const close = () => useStore.getState().openPreview(null)
  const [cards, setCards] = useState<PreviewCardT[]>([])
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([])
  const [deckId, setDeckId] = useState('')
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [onlyWarnings, setOnlyWarnings] = useState(false)

  useEffect(() => {
    if (!preview) return
    setCards(preview.cards.map((c, i) => ({ ...c, key: c.key ?? `k${i}${Date.now()}` })))
    void api.decks.list().then((d) => {
      setDecks(d)
      setDeckId(preview.deckId ?? d[0]?.id ?? '')
    })
  }, [preview])

  const warnings = useMemo(() => validateCards(cards), [cards])
  const byIndex = useMemo(() => {
    const m = new Map<number, CardWarning[]>()
    warnings.forEach((w) => m.set(w.index, [...(m.get(w.index) ?? []), w]))
    return m
  }, [warnings])

  const setBusy = (key: string, on: boolean) =>
    setBusyKeys((cur) => {
      const n = new Set(cur)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  const patch = (key: string, p: Partial<PreviewCardT>) => setCards((cur) => cur.map((c) => (c.key === key ? { ...c, ...p } : c)))

  const fix = async (c: PreviewCardT, regenerate = false) => {
    const idx = cards.findIndex((x) => x.key === c.key)
    const problem = (byIndex.get(idx) ?? []).map((w) => w.message).join('; ')
    setBusy(c.key!, true)
    try {
      const fixed = await api.gen.fixCard({ front: c.front, back: c.back, problem, deckId: deckId || null, regenerate, format: c.format })
      patch(c.key!, { front: fixed.front, back: fixed.back, kind: c.kind === 'multiple_choice' ? c.kind : fixed.kind, cloze_answers: fixed.cloze_answers ?? [], required_points: fixed.required_points ?? null })
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setBusy(c.key!, false)
    }
  }
  const fixAll = async () => {
    const idxs = [...new Set(warnings.map((w) => w.index))]
    await Promise.all(idxs.map((i) => cards[i] && fix(cards[i])))
  }

  const save = async () => {
    let target = deckId
    if (!target) {
      const name = await askText('Save to a new deck', { label: 'Deck name', confirmText: 'Create deck' })
      if (!name) return
      target = (await api.decks.create({ name })).id
    }
    setSaving(true)
    try {
      const keep = cards.filter((c) => c.front.trim() || c.back.trim())
      const n = await api.gen.save({ deckId: target, cards: keep.map((c) => ({ ...c, source: c.source ?? null, language: c.language ?? null })) })
      toast(`Saved ${n} cards`, 'good', { label: 'Open deck', run: () => useStore.getState().go({ name: 'deck', id: target }) })
      useStore.getState().bump()
      close()
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setSaving(false)
    }
  }
  useCommands(preview ? { 'gen.saveAll': save, 'gen.fixAll': fixAll } : {}, [preview, cards, deckId, warnings])

  const shown = cards.map((c, i) => ({ c, i })).filter(({ i }) => !onlyWarnings || byIndex.has(i))

  return (
    <Modal
      open={!!preview}
      onClose={close}
      full
      title={
        <span className="flex flex-wrap items-center gap-2">
          Review {cards.length} cards
          {preview?.presetName && <Pill tone="accent">{preview.presetName}</Pill>}
          {warnings.length > 0 ? (
            <Pill tone="warn">
              <AlertTriangle className="size-3.5" /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </Pill>
          ) : (
            <Pill tone="good">
              <Check className="size-3.5" /> All valid
            </Pill>
          )}
        </span>
      }
      footer={
        <>
          {warnings.length > 0 && (
            <>
              <Toggle checked={onlyWarnings} onChange={setOnlyWarnings} label="Only cards with warnings" />
              <Button variant="soft" onClick={fixAll} disabled={busyKeys.size > 0} kbd="gen.fixAll">
                Fix all with AI
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Select value={deckId} onChange={(e) => setDeckId(e.target.value)} className="w-auto min-w-48">
            <option value="">New deck…</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={save} loading={saving} disabled={cards.length === 0} kbd="gen.saveAll">
            Save {cards.length} cards
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {shown.map(({ c, i }) => {
          const w = byIndex.get(i) ?? []
          const busy = busyKeys.has(c.key!)
          return (
            <div key={c.key} className={cx('pop-in rounded-xl border bg-surface p-4 transition-colors', w.length ? 'border-warn/50' : 'border-line', busy && 'opacity-60')}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[0.78rem] text-muted">#{i + 1}</span>
                {c.kind !== 'regular' && <Pill tone="accent">{c.kind === 'cloze' ? 'Fill in the blank' : 'Multiple choice'}</Pill>}
                {c.source?.section && <Pill>§ {c.source.section}</Pill>}
                {w.map((x, j) => (
                  <Pill key={j} tone="warn">
                    {x.message}
                  </Pill>
                ))}
                <span className="flex-1" />
                {w.length > 0 && (
                  <Button size="sm" variant="soft" onClick={() => fix(c)} loading={busy}>
                    Fix with AI
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => fix(c, true)} disabled={busy}>
                  Regenerate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCards((cur) => cur.filter((x) => x.key !== c.key))}>
                  Delete
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Textarea value={c.front} onChange={(e) => patch(c.key!, { front: e.target.value })} rows={Math.min(8, Math.max(2, c.front.split('\n').length + 1))} className="font-semibold" />
                <Textarea value={c.back} onChange={(e) => patch(c.key!, { back: e.target.value })} rows={Math.min(12, Math.max(2, c.back.split('\n').length + 1))} />
              </div>
              {c.kind === 'multiple_choice' && c.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.options.map((o, j) => (
                    <Pill key={j} tone={o.correct ? 'good' : 'neutral'}>
                      {o.text}
                    </Pill>
                  ))}
                </div>
              )}
              {(c.back.includes('$') || c.back.includes('|')) && (
                <details className="mt-2 text-[0.85rem]">
                  <summary className="cursor-pointer text-muted">Preview rendering</summary>
                  <Markdown className="mt-2 rounded-lg bg-surface-2 p-3">{c.back}</Markdown>
                </details>
              )}
            </div>
          )
        })}
        <Button
          variant="ghost"
          onClick={() => setCards((cur) => [...cur, { key: `n${Date.now()}`, format: 'question_answer', kind: 'regular', front: '', back: '', options: [], cloze_answers: [], tags: [], hints: [], explanation: '' }])}
          className="self-start"
        >
          Add a card
        </Button>
      </div>
    </Modal>
  )
}
