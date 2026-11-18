import { useEffect, useState } from 'react'
import { Plus, Trash2, Eye, Pencil } from 'lucide-react'
import type { Card, CardFormat, CardKind, McOption } from '@shared/types'
import { countBlanks, bulletItems, parseRequiredPoints } from '@shared/ssText'
import { api, errorText } from '../lib/api'
import { toast } from '../lib/store'
import { Button, Field, Input, Modal, Segmented, Textarea, Pill, cx } from './ui'
import { Markdown } from './Markdown'

export interface CardDraft {
  id?: string
  deck_id: string
  format: CardFormat
  kind: CardKind
  front: string
  back: string
  language: string | null
  options: McOption[]
  cloze_answers: string[]
  tags: string[]
  hints: string[]
  explanation: string
}

export const emptyDraft = (deckId: string, format: CardFormat = 'term_definition'): CardDraft => ({
  deck_id: deckId,
  format,
  kind: 'regular',
  front: '',
  back: '',
  language: null,
  options: [],
  cloze_answers: [],
  tags: [],
  hints: [],
  explanation: ''
})

const FRONT_LABEL: Record<CardFormat, string> = { term_definition: 'Term', question_answer: 'Question', vocabulary: 'Word' }
const BACK_LABEL: Record<CardFormat, string> = { term_definition: 'Definition', question_answer: 'Answer', vocabulary: 'Translation' }

function MdField({ label, value, onChange, rows, autoFocus, hint }: { label: string; value: string; onChange: (v: string) => void; rows: number; autoFocus?: boolean; hint?: React.ReactNode }) {
  const [preview, setPreview] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[0.8rem] font-semibold text-muted">{label}</span>
        <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 text-[0.8rem] text-muted hover:text-ink">
          {preview ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />} {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[5rem] rounded-lg border border-line bg-surface p-3.5">
          <Markdown>{value || '_empty_'}</Markdown>
        </div>
      ) : (
        <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} className="font-[450]" />
      )}
      {hint}
    </div>
  )
}

export function CardEditor({ draft, onClose, onSaved }: { draft: CardDraft | null; onClose: () => void; onSaved: (c: Card) => void }) {
  const [d, setD] = useState<CardDraft | null>(draft)
  const [saving, setSaving] = useState(false)
  useEffect(() => setD(draft), [draft])
  if (!d) return null
  const set = (p: Partial<CardDraft>) => setD({ ...d, ...p })

  const blanks = countBlanks(d.front)
  const points = parseRequiredPoints(d.front)
  const bullets = bulletItems(d.back).length

  const save = async () => {
    if (!d.front.trim()) return toast('The front can’t be empty', 'bad')
    let next = d
    if (d.kind === 'multiple_choice') {
      const opts = d.options.filter((o) => o.text.trim())
      if (opts.length < 2 || !opts.some((o) => o.correct)) return toast('Multiple choice needs at least 2 options and one correct answer', 'bad')
      next = { ...d, options: opts, back: d.back.trim() || opts.filter((o) => o.correct).map((o) => o.text).join('\n') }
    }
    if (d.kind === 'cloze' && d.cloze_answers.length === 0) {
      const b = bulletItems(d.back)
      next = { ...next, cloze_answers: b.length ? b : d.back.trim() ? [d.back.trim()] : [] }
    }
    setSaving(true)
    try {
      const { id, ...rest } = next
      const saved = id ? await api.cards.update({ id, patch: rest }) : (await api.cards.create({ cards: [rest] }))[0]
      onSaved(saved)
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={d.id ? 'Edit card' : 'New card'}
      footer={
        <>
          <span className="mr-auto text-[0.8rem] text-muted">⌘↩ to save</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {d.id ? 'Save' : 'Add card'}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
      >
        <div className="flex flex-wrap gap-3">
          <Segmented
            value={d.format}
            onChange={(format) => set({ format })}
            options={[
              { value: 'term_definition', label: 'Term & definition' },
              { value: 'question_answer', label: 'Q & A' },
              { value: 'vocabulary', label: 'Vocabulary' }
            ]}
          />
          <Segmented
            value={d.kind}
            onChange={(kind) => set({ kind, options: kind === 'multiple_choice' && d.options.length === 0 ? [{ text: d.back, correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] : d.options })}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'multiple_choice', label: 'Multiple choice' },
              { value: 'cloze', label: 'Cloze' }
            ]}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <MdField
            label={d.kind === 'cloze' ? 'Sentence with ___ blanks' : FRONT_LABEL[d.format]}
            value={d.front}
            onChange={(front) => set({ front })}
            rows={4}
            autoFocus
            hint={
              <div className="flex flex-wrap gap-1.5">
                {blanks > 0 && <Pill tone="accent">{blanks} blank{blanks === 1 ? '' : 's'}</Pill>}
                {points !== null && blanks === 0 && <Pill tone={points === bullets ? 'good' : 'warn'}>({points}) required points · {bullets} bullets</Pill>}
              </div>
            }
          />
          {d.kind !== 'multiple_choice' ? (
            <MdField
              label={d.kind === 'cloze' ? 'Answers (one “- ” bullet per blank)' : BACK_LABEL[d.format]}
              value={d.back}
              onChange={(back) => set({ back, cloze_answers: d.kind === 'cloze' ? (bulletItems(back).length ? bulletItems(back) : back.trim() ? [back.trim()] : []) : d.cloze_answers })}
              rows={6}
              hint={d.kind !== 'cloze' && <span className="text-[0.8rem] text-muted">Tip: **bold** words become blanks in Learn mode.</span>}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.8rem] font-semibold text-muted">Options</span>
              {d.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => set({ options: d.options.map((x, j) => (j === i ? { ...x, correct: !x.correct } : x)) })}
                    className={cx('grid size-8 shrink-0 place-items-center rounded-full border text-[0.8rem] font-semibold transition-colors', o.correct ? 'border-good bg-good text-white' : 'border-line')}
                    title="Mark correct"
                  >
                    {String.fromCharCode(65 + i)}
                  </button>
                  <Input value={o.text} onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder={`Option ${String.fromCharCode(65 + i)}`} />
                  <Button variant="ghost" size="icon" onClick={() => set({ options: d.options.filter((_, j) => j !== i) })} aria-label="Remove option">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {d.options.length < 6 && (
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set({ options: [...d.options, { text: '', correct: false }] })} className="self-start">
                  Add option
                </Button>
              )}
            </div>
          )}
        </div>

        <details className="group rounded-lg border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer font-semibold">More: tags, hints, explanation{d.format === 'vocabulary' ? ', language' : ''}</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Field label="Tags" hint="Comma separated">
              <Input value={d.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
            </Field>
            {d.format === 'vocabulary' && (
              <Field label="Language">
                <Input value={d.language ?? ''} onChange={(e) => set({ language: e.target.value || null })} placeholder="e.g. Spanish" />
              </Field>
            )}
            <Field label="Hints" hint="One per line · shown before AI hints" className="md:col-span-2">
              <Textarea rows={2} value={d.hints.join('\n')} onChange={(e) => set({ hints: e.target.value.split('\n').filter((x) => x.trim()) })} />
            </Field>
            <Field label="Explanation" className="md:col-span-2">
              <Textarea rows={3} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} />
            </Field>
          </div>
        </details>
      </div>
    </Modal>
  )
}
