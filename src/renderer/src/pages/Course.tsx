import { useEffect, useState } from 'react'
import { SlidersHorizontal, Sparkles, Play, RotateCcw, CheckCircle2, AlertTriangle, FileText, Layers, MoreHorizontal, Pencil, Trash2, Upload, NotebookPen, RefreshCw, Clock, Plus, X, ClipboardCheck } from 'lucide-react'
import type { CourseFull, Topic, WeekFull } from '@shared/course'
import { planUsageText, type JobInfo } from '@shared/types'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { askText, confirmDialog } from '../lib/dialogs'
import { Shell, PageTitle } from '../components/Shell'
import { Button, Dots, Field, Input, Menu, MenuItem, Modal, Pill, ProgressBar, Textarea, cx } from '../components/ui'
import { FileDrop } from './Courses'
import { JobLive } from '../components/JobLive'
import { DeckSettings } from './Deck'
import type { Deck } from '@shared/types'

const running = (jobs: JobInfo[], kind: JobInfo['kind'], key: string, value: string) => jobs.find((j) => j.kind === kind && j.status === 'running' && j.meta?.[key] === value)

export function CoursePage({ id }: { id: string }) {
  const go = useStore((s) => s.go)
  const version = useStore((s) => s.version)
  const [c, setC] = useState<CourseFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [aiDeck, setAiDeck] = useState<Deck | null>(null)
  const load = () =>
    api.courses
      .get({ id })
      .then(setC)
      .catch((e) => setError(errorText(e)))
  useEffect(() => void load(), [id, version])

  if (error)
    return (
      <Shell>
        <p className="text-muted">{error}</p>
      </Shell>
    )
  if (!c) return null

  const topics = c.weeks.flatMap((w) => w.topics)
  const write = async (topicIds: string[]) => {
    try {
      await api.courses.write({ topicIds })
      void load()
    } catch (e) {
      toast(errorText(e), 'bad')
    }
  }
  const rename = async () => {
    const name = await askText('Rename course', { initial: c.name, confirmText: 'Rename' })
    if (name) await api.courses.rename({ id, name }).then(load)
  }
  const del = async () => {
    if (!(await confirmDialog(`Delete ${c.name}?`, 'All weeks, topics, figures and copies of your files go. Its flashcard folder and week decks go too.', { confirmText: 'Delete', danger: true }))) return
    await api.courses.delete({ id, keepDeck: false })
    useStore.getState().bump()
    go({ name: 'courses' })
  }

  // Course-wide Models & instructions, shared by every week deck.
  const openAiSettings = async () => {
    const s = await api.courses.deckSettings({ courseId: c.id })
    const t = new Date().toISOString()
    setAiDeck({ id: '', folder_id: c.deck_folder_id, name: c.name, description: '', learn_settings: null, created_at: t, updated_at: t, ...s })
  }

  const unwritten = topics.filter((t) => t.status === 'planned' || t.status === 'error')
  const done = topics.filter((t) => t.progress.done).length
  const minutes = topics.reduce((n, t) => n + (t.plan.minutes || 0), 0)
  const next = topics.find((t) => t.status === 'ready' && !t.progress.done)

  return (
    <Shell>
      <PageTitle
        eyebrow={
          <button className="hover:text-ink" onClick={() => go({ name: 'courses' })}>
            Courses
          </button>
        }
        title={c.name}
        actions={
          <>
            {next && (
              <Button variant="primary" onClick={() => go({ name: 'topic', id: next.id })}>
                <Play className="size-4" /> {next.progress.section > 0 ? 'Continue' : 'Start'} {next.content?.title ?? next.plan.title}
              </Button>
            )}
            {unwritten.length > 0 && (
              <Button variant={next ? 'outline' : 'primary'} onClick={() => write(unwritten.map((t) => t.id))}>
                <Sparkles className="size-4" /> Write {unwritten.length} topic{unwritten.length === 1 ? '' : 's'}
              </Button>
            )}
            {topics.some((t) => t.card_count > 0) && (
              <Button variant="outline" onClick={() => go({ name: 'flashcards', deckId: '', mode: 'due', courseId: c.id })} title="Due cards from every week">
                <Layers className="size-4" /> Recall cards
              </Button>
            )}
            <Menu
              trigger={(open) => (
                <Button variant="ghost" size="icon" onClick={open} aria-label="More">
                  <MoreHorizontal className="size-5" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<Plus className="size-4" />} onClick={() => (close(), setAdding(true))}>
                    Add a week
                  </MenuItem>
                  <MenuItem icon={<SlidersHorizontal className="size-4" />} onClick={() => (close(), void openAiSettings())}>
                    Models &amp; instructions
                  </MenuItem>
                  <MenuItem icon={<Pencil className="size-4" />} onClick={() => (close(), void rename())}>
                    Rename course
                  </MenuItem>
                  {c.deck_folder_id && (
                    <MenuItem icon={<Layers className="size-4" />} onClick={() => (close(), go({ name: 'decks', folderId: c.deck_folder_id }))}>
                      Open flashcard folder
                    </MenuItem>
                  )}
                  <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => (close(), void del())}>
                    Delete course
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      >
        <span>
          {c.weeks.length} week{c.weeks.length === 1 ? '' : 's'}
          {topics.length > 0 && ` · ${topics.length} topics · about ${Math.round(minutes / 5) * 5 || minutes} minutes · ${done} done`}
        </span>
      </PageTitle>

      {topics.length > 0 && <ProgressBar value={done / topics.length} className="mb-8" />}

      <div className="flex flex-col gap-10">
        {c.weeks.map((w) => (
          <WeekSection key={w.id} week={w} reload={load} write={write} />
        ))}
      </div>

      <button
        onClick={() => setAdding(true)}
        className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-5 font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Plus className="size-5" /> Add {c.weeks.length ? 'next week' : 'the first week'}
      </button>

      {aiDeck && <DeckSettings deck={aiDeck} courseId={c.id} onClose={() => setAiDeck(null)} onSaved={() => setAiDeck(null)} />}

      {adding && (
        <AddWeekModal
          courseId={c.id}
          defaultLabel={`Week ${c.weeks.length + 1}`}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            void load()
          }}
        />
      )}
    </Shell>
  )
}

function WeekSection({ week: w, reload, write }: { week: WeekFull; reload: () => void; write: (ids: string[]) => void }) {
  const go = useStore((s) => s.go)
  const jobs = useStore((s) => s.jobs)
  const planJob = running(jobs, 'course_outline', 'weekId', w.id)
  const planning = w.status === 'planning' || !!planJob
  const unwritten = w.topics.filter((t) => t.status === 'planned' || t.status === 'error')
  const done = w.topics.filter((t) => t.progress.done).length

  const plan = async () => {
    const written = w.topics.filter((t) => t.status === 'ready').length
    if (written && !(await confirmDialog(`Plan ${w.label} again?`, `This replaces its ${w.topics.length} topics, including ${written} you’ve already written. Recall cards you’ve made stay in the deck.`, { confirmText: 'Re-plan', danger: true }))) return
    try {
      await api.courses.plan({ weekId: w.id })
      reload()
    } catch (e) {
      toast(errorText(e), 'bad')
    }
  }
  const addFiles = async () => {
    const files = await api.app.pickFiles({ kind: 'course' })
    if (!files.length) return
    await api.courses.addFiles({ weekId: w.id, files })
    reload()
    if (w.topics.length) toast(`Added to ${w.label}. Plan it again to use the new files.`, 'info', { label: 'Plan again', run: () => void plan() })
  }
  const rename = async () => {
    const label = await askText('Rename week', { initial: w.label, confirmText: 'Rename' })
    if (label) await api.courses.renameWeek({ weekId: w.id, label }).then(reload)
  }
  const del = async () => {
    if (!(await confirmDialog(`Delete ${w.label}?`, 'Its files, topics and their recall cards go.', { confirmText: 'Delete week', danger: true }))) return
    await api.courses.deleteWeek({ weekId: w.id })
    useStore.getState().bump()
  }
  const saveNote = async (t: Topic) => {
    // Notes are made when the topic is written; this also makes them if they were deleted.
    const noteId = await api.courses.saveNote({ topicId: t.id })
    go({ name: 'notes', id: noteId })
  }

  return (
    <section data-week={w.label}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h2 className="truncate text-[1.2rem] font-semibold tracking-tight">{w.label}</h2>
          {w.topics.length > 0 && (
            <span className="shrink-0 text-[0.88rem] text-muted">
              {w.topics.length} topic{w.topics.length === 1 ? '' : 's'} · {done} done
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {!planning && w.files.length > 0 && !w.topics.length && w.status !== 'error' && (
          <Button size="sm" variant="primary" onClick={plan}>
            <Sparkles className="size-4" /> Plan topics
          </Button>
        )}
        {!planning && unwritten.length > 0 && (
          <Button size="sm" variant="soft" onClick={() => write(unwritten.map((t) => t.id))}>
            <Sparkles className="size-4" /> Write {unwritten.length === w.topics.length ? `all ${unwritten.length}` : `${unwritten.length} more`}
          </Button>
        )}
        <Menu
          trigger={(open) => (
            <Button size="icon" variant="ghost" onClick={open} aria-label={`${w.label} options`}>
              <MoreHorizontal className="size-4" />
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<Upload className="size-4" />} onClick={() => (close(), void addFiles())}>
                Add files
              </MenuItem>
              {w.files.length > 0 && !planning && (
                <MenuItem icon={<RefreshCw className="size-4" />} onClick={() => (close(), void plan())}>
                  {w.topics.length ? 'Plan again' : 'Plan topics'}
                </MenuItem>
              )}
              {w.deck_id && (
                <MenuItem icon={<Layers className="size-4" />} onClick={() => (close(), go({ name: 'deck', id: w.deck_id! }))}>
                  This week’s flashcards
                </MenuItem>
              )}
              <MenuItem icon={<Pencil className="size-4" />} onClick={() => (close(), void rename())}>
                Rename week
              </MenuItem>
              <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => (close(), void del())}>
                Delete week
              </MenuItem>
            </>
          )}
        </Menu>
        </div>
      </div>

      {w.files.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {w.files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-1.5 pl-3 text-[0.85rem]">
              <FileText className="size-3.5 text-muted" /> {f.name}
              {f.pages ? <span className="text-muted">· {f.pages}p</span> : null}
              {!planning && (
                <button
                  className="grid size-5 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"
                  aria-label={`Remove ${f.name}`}
                  onClick={async () => {
                    if (await confirmDialog(`Remove ${f.name}?`, 'Topics already written from it stay as they are.', { confirmText: 'Remove' })) await api.courses.removeFile({ fileId: f.id }).then(reload)
                  }}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {!planning && (
            <button onClick={addFiles} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.85rem] text-muted hover:text-accent">
              <Plus className="size-3.5" /> Add files
            </button>
          )}
        </div>
      ) : (
        <button onClick={addFiles} className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line px-5 py-6 text-center transition-colors hover:border-accent">
          <Upload className="size-5 text-muted" />
          <span className="font-semibold">Add {w.label}’s files</span>
          <span className="text-[0.88rem] text-muted">Slides, lecture transcripts, readings</span>
        </button>
      )}

      {planning && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-accent" /> Planning {w.label} <Dots />
          </div>
          <p className="mt-1 text-[0.9rem] text-muted">This takes a minute or two. You can leave this page; it keeps going.</p>
          <div className="mt-4">
            {planJob ? (
              <JobLive job={planJob} />
            ) : (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-14" />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {w.status === 'error' && !planning && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-bad/40 bg-bad-soft px-5 py-4">
          <AlertTriangle className="size-5 text-bad" />
          <div className="min-w-0 flex-1 text-[0.92rem]">
            <div className="font-semibold">Planning didn’t finish</div>
            <div className="text-muted">{w.error}</div>
          </div>
          <Button size="sm" variant="ink" onClick={plan}>
            Try again
          </Button>
        </div>
      )}

      {!planning && w.topics.length > 0 && (
        <ol className="flex flex-col gap-2">
          {w.topics.map((t) => (
            <TopicRow key={t.id} t={t} write={write} saveNote={saveNote} reload={reload} />
          ))}
        </ol>
      )}
    </section>
  )
}

function TopicRow({ t, write, saveNote, reload }: { t: Topic; write: (ids: string[]) => void; saveNote: (t: Topic) => void; reload: () => void }) {
  const go = useStore((s) => s.go)
  const jobs = useStore((s) => s.jobs)
  const job = running(jobs, 'course_topic', 'topicId', t.id)
  // The last write of this topic since the app started, for its share of the 5-hour limit.
  const lastWrite = jobs.find((j) => j.kind === 'course_topic' && j.status === 'done' && j.meta?.topicId === t.id)
  const used = planUsageText(lastWrite?.planUsage, true)
  const writing = t.status === 'writing' || !!job
  const p = t.progress
  const sections = t.content?.sections.length ?? t.plan.sections.length
  const n = Number(t.key.match(/t(\d+)$/)?.[1] ?? t.position + 1)
  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3.5 transition-[border-color,box-shadow,transform] duration-300 ease-out-soft sm:gap-x-4 sm:px-5 sm:py-4',
        t.status === 'ready' && 'cursor-pointer hover:border-[color-mix(in_oklab,var(--ink)_22%,transparent)] hover:shadow-[0_8px_24px_-18px_rgba(0,0,0,0.35)] active:scale-[0.995]'
      )}
      onClick={() => t.status === 'ready' && go({ name: 'topic', id: t.id })}
    >
      <div className={cx('grid size-8 shrink-0 place-items-center rounded-full text-[0.9rem] font-semibold transition-colors duration-500 sm:size-9', p.done ? 'bg-good text-white' : 'bg-surface-2')}>{p.done ? <CheckCircle2 className="size-5" /> : n}</div>
      <div className="min-w-[min(12rem,100%)] flex-1">
        <div className="font-semibold">{t.content?.title ?? t.plan.title}</div>
        <div className="truncate text-[0.88rem] text-muted">{t.content?.goal ?? t.plan.goal}</div>
        {writing && !job && (
          <div className="mt-1 flex items-center gap-1.5 text-[0.85rem] text-accent">
            <Sparkles className="size-3.5" /> Writing…
          </div>
        )}
        {t.status === 'error' && !writing && <div className="mt-1 text-[0.85rem] text-bad">{t.error}</div>}
        {t.status === 'ready' && !p.done && (p.section > 0 || p.step) && <ProgressBar value={p.section / sections} className="mt-2 h-1.5 max-w-[240px]" />}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[0.85rem] text-muted" onClick={(e) => e.stopPropagation()}>
        {t.plan.minutes > 0 && (
          <span className="hidden items-center gap-1 sm:flex">
            <Clock className="size-3.5" /> {t.plan.minutes} min
          </span>
        )}
        {!job && lastWrite?.planUsage?.measuring && <span className="text-[0.8rem]">Measuring usage…</span>}
        {!job && used && (
          <span className="hidden text-[0.8rem] sm:inline" title={`Writing this topic used ${planUsageText(lastWrite?.planUsage)}`}>
            Used {used}
          </span>
        )}
        {p.checkTotal ? (
          <Pill tone={p.checkScore != null && p.checkScore / p.checkTotal >= 0.8 ? 'good' : 'warn'}>
            Test {p.checkScore}/{p.checkTotal}
          </Pill>
        ) : null}
        {t.status === 'ready' ? (
          <>
            <Button size="sm" variant={p.done ? 'ghost' : 'soft'} onClick={() => go({ name: 'topic', id: t.id })}>
              {p.done ? <RotateCcw className="size-4" /> : <Play className="size-4" />} {p.done ? 'Again' : p.section > 0 || p.step ? 'Continue' : 'Start'}
            </Button>
            {!!t.content?.check.length && (
              <Button size="sm" variant="ghost" onClick={() => go({ name: 'topic', id: t.id, test: true })} title={`Topic test: ${t.content.check.length} questions, from memory`}>
                <ClipboardCheck className="size-4" /> Test
              </Button>
            )}
            <Menu
              trigger={(open) => (
                <Button size="icon" variant="ghost" onClick={open} aria-label="Topic options">
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<NotebookPen className="size-4" />} onClick={() => (close(), void saveNote(t))}>
                    Open notes
                  </MenuItem>
                  <MenuItem icon={<RotateCcw className="size-4" />} onClick={() => (close(), void api.courses.resetProgress({ topicId: t.id }).then(reload))}>
                    Reset progress
                  </MenuItem>
                  <MenuItem
                    icon={<RefreshCw className="size-4" />}
                    onClick={async () => {
                      close()
                      if (await confirmDialog('Write this topic again?', 'You get new notes and questions, and its recall cards are replaced (with their review history).', { confirmText: 'Rewrite', danger: true })) write([t.id])
                    }}
                  >
                    Write again
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        ) : (
          !writing && (
            <Button size="sm" variant="soft" onClick={() => write([t.id])}>
              <Sparkles className="size-4" /> {t.status === 'error' ? 'Try again' : 'Write'}
            </Button>
          )
        )}
        {job && (
          <Button size="sm" variant="ghost" onClick={() => api.jobs.cancel({ id: job.id })}>
            Cancel
          </Button>
        )}
      </div>
      {job && (
        <div className="basis-full pl-13" onClick={(e) => e.stopPropagation()}>
          <JobLive job={job} />
        </div>
      )}
    </li>
  )
}

function AddWeekModal({ courseId, defaultLabel, onClose, onDone }: { courseId: string; defaultLabel: string; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(defaultLabel)
  const [files, setFiles] = useState<string[]>([])
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      await api.courses.addWeek({ courseId, label: label.trim(), files, instructions })
      onDone()
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a week"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={create}>
            {files.length ? 'Add and plan topics' : 'Add week'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Week 3, Reading week, Revision…" />
        </Field>
        <Field label="Files" hint="This week’s slides, lecture transcripts and readings. Claude plans its topics from these, knowing what earlier weeks already covered.">
          <FileDrop list={files} setList={setFiles} />
        </Field>
        <Field label="Anything else? (optional)" hint="e.g. “The second lecture was a guest talk, skip it”.">
          <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
