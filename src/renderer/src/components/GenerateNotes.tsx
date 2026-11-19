import { useEffect, useState } from 'react'
import { NotebookPen } from 'lucide-react'
import type { Preset } from '@shared/types'
import { NOTE_TYPES } from '@shared/types'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { useCommands } from '../lib/commands'
import { Button, Field, Input, Modal, Segmented, Select, Textarea } from './ui'
import { SourcePicker, sourceFor, hasSource, initialTab, type SourceValue, type SourceTab } from './SourcePicker'

/** Jobs whose note should open as soon as it exists. */
export const followNoteJobs = new Set<string>()

export function GenerateNotesModal() {
  const prefill = useStore((s) => s.genNotes)
  const close = () => useStore.getState().openGenNotes(null)
  const [src, setSrc] = useState<SourceValue>({ files: [], topic: '', text: '', noteIds: [] })
  const [tab, setTab] = useState<SourceTab>('files')
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState('')
  const [title, setTitle] = useState('')
  const [module, setModule] = useState('')
  const [type, setType] = useState('')
  const [week, setWeek] = useState('')
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [level, setLevel] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!prefill) return
    const v = { files: prefill.files ?? [], topic: prefill.topic ?? '', text: prefill.text ?? '', noteIds: prefill.noteIds ?? [] }
    setSrc(v)
    setTab(initialTab(v))
    setTitle('')
    void api.presets.list({ task: 'generate_notes' }).then((p) => {
      setPresets(p)
      setPresetId('')
    })
  }, [prefill])

  const multi = src.files.length + src.noteIds.length > 1
  const autoPreset = multi ? presets.find((p) => p.name === 'Linking texts') : presets.find((p) => p.is_default)

  const submit = async () => {
    const sources = sourceFor(tab, src)
    if (!hasSource(sources)) return toast('Add a source first', 'bad')
    setBusy(true)
    try {
      const job = await api.gen.notes({ sources, presetId: presetId || undefined, title, module, type, week, length, level, instructions, deckId: prefill?.deckId ?? null })
      followNoteJobs.add(job.id)
      toast('Writing your notes…', 'info')
      close()
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  useCommands(prefill ? { 'gen.submit': submit } : {}, [prefill, src, tab, presetId, title, module, type, week, length, level, instructions])

  return (
    <Modal
      open={!!prefill}
      onClose={close}
      wide
      title={
        <span className="flex items-center gap-2">
          <NotebookPen className="size-5 text-accent" /> Generate notes with AI
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[0.82rem] text-muted">Notes stream into the editor as they’re written</span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} kbd="gen.submit">
            Write notes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SourcePicker value={src} onChange={setSrc} tab={tab} setTab={setTab} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preset" hint={!presetId && autoPreset ? `Auto: ${autoPreset.name}${multi ? ' (several sources)' : ''}` : undefined}>
            <Select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">Auto</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From the file name if empty" />
          </Field>
          <Field label="Module">
            <Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="e.g. HCI" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">—</option>
                {NOTE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Week">
              <Input value={week} onChange={(e) => setWeek(e.target.value)} placeholder="3" />
            </Field>
          </div>
          <Field label="Length">
            <Segmented
              value={length}
              onChange={setLength}
              options={[
                { value: 'short', label: 'Short' },
                { value: 'medium', label: 'Medium' },
                { value: 'long', label: 'Detailed' }
              ]}
            />
          </Field>
          <Field label="Level">
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. first-year undergrad" />
          </Field>
        </div>
        <Field label="Instructions">
          <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. focus on the experiments, add a table comparing the models" />
        </Field>
      </div>
    </Modal>
  )
}
