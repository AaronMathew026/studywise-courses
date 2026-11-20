import { useEffect, useState, lazy, Suspense } from 'react'
import { AlertTriangle, X, FileUp, NotebookPen, Layers, Terminal, GraduationCap } from 'lucide-react'
import { useStore, toast, type Route } from './lib/store'
import { api, onEvent, errorText } from './lib/api'
import { startCommandDispatch, useCommands, runCommand } from './lib/commands'
import { askText, confirmDialog, chooseDialog, DialogHost } from './lib/dialogs'
import { GooNav } from './components/GooNav'
import { CommandPalette } from './components/CommandPalette'
import { ShortcutSheet } from './components/ShortcutSheet'
import { ExplainPanel } from './components/ExplainPanel'
import { GenerateCardsModal, CardPreviewModal, jobDeck } from './components/GenerateCards'
import { GenerateNotesModal, followNoteJobs } from './components/GenerateNotes'
import { Button, Spinner, cx } from './components/ui'
import { Home } from './pages/Home'
import { Onboarding } from './components/Onboarding'
import { Decks } from './pages/Decks'
import { DeckPage } from './pages/Deck'
import { Flashcards } from './pages/Flashcards'
import { Notes } from './pages/Notes'
import { Jobs } from './pages/Jobs'
import { Courses, NewCourseModal } from './pages/Courses'
import { JobDock } from './components/JobLive'
import { CoursePage } from './pages/Course'

const Learn = lazy(() => import('./pages/Learn').then((m) => ({ default: m.Learn })))
const TopicPage = lazy(() => import('./pages/Topic').then((m) => ({ default: m.TopicPage })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

type Theme = 'system' | 'light' | 'dark'

function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function App() {
  const route = useStore((s) => s.route)
  const go = useStore((s) => s.go)
  const focus = useStore((s) => s.focus)
  const [theme, setTheme] = useState<Theme>('system')
  const [zoom, setZoom] = useState(1)
  const [ready, setReady] = useState(false)
  const [onboarding, setOnboarding] = useState(false)

  // Boot: settings, last route, claude status, jobs.
  useEffect(() => {
    startCommandDispatch()
    void (async () => {
      const s = await api.settings.all()
      const t = (s['ui.theme'] as Theme) ?? 'system'
      setTheme(t)
      applyTheme(t)
      const z = Number(s['ui.zoom'] ?? 1)
      setZoom(z)
      const last = s['ui.lastRoute'] as Route | undefined
      if (last && last.name === 'course') {
        try {
          await api.courses.get({ id: last.id })
          useStore.setState({ route: last })
        } catch {
          /* gone */
        }
      }
      if (last && (last.name === 'deck' || last.name === 'notes')) {
        try {
          if (last.name === 'deck') await api.decks.get({ id: last.id })
          if (last.name === 'notes' && last.id) await api.notes.get({ id: last.id })
          useStore.setState({ route: last })
        } catch {
          /* gone */
        }
      }
      useStore.getState().setClaude(await api.claude.status())
      useStore.getState().setAi(await api.ai.status())
      useStore.getState().setJobs(await api.jobs.list())
      if (!s['onboarding.done']) setOnboarding(true)
      setReady(true)
    })()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => applyTheme((document.documentElement.dataset.theme as Theme) || 'system')
    mq.addEventListener('change', onMq)
    return () => mq.removeEventListener('change', onMq)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    applyTheme(theme)
  }, [theme])
  useEffect(() => {
    document.documentElement.style.setProperty('--zoom', String(zoom))
  }, [zoom])

  // Remember the last open deck / note.
  useEffect(() => {
    if (!ready) return
    if (route.name === 'course') void api.settings.set({ key: 'ui.lastRoute', value: route })
    if (route.name === 'deck' || (route.name === 'notes' && route.id)) void api.settings.set({ key: 'ui.lastRoute', value: route.name === 'deck' ? { name: 'deck', id: route.id } : route })
  }, [route, ready])

  // Events from the main process.
  useEffect(
    () =>
      onEvent((ev) => {
        const st = useStore.getState()
        if (ev.type === 'fullscreen') document.documentElement.classList.toggle('is-fullscreen', ev.on)
        if (ev.type === 'claude:status') st.setClaude(ev.status)
        if (ev.type === 'open-files') openFiles(ev.paths)
        if (ev.type === 'job') {
          const j = ev.job
          st.upsertJob(j)
          if (j.kind === 'generate_notes' && followNoteJobs.has(j.id) && typeof j.meta?.noteId === 'string') {
            followNoteJobs.delete(j.id)
            st.go({ name: 'notes', id: j.meta.noteId })
          }
          if (j.status === 'done' && j.kind === 'generate_cards' && jobDeck.has(j.id)) {
            const r = j.result as { cards: never[]; presetName: string }
            st.openPreview({ cards: r.cards, deckId: jobDeck.get(j.id) ?? null, jobId: j.id, presetName: r.presetName })
            jobDeck.delete(j.id)
          }
          if (j.status === 'done' && j.kind === 'generate_notes') {
            st.bump()
            toast(`${j.title.replace(/^Notes: /, '')}: notes ready`, 'good')
          }
          if (j.kind === 'course_outline' || j.kind === 'course_topic') {
            st.bump()
            if (j.status === 'done') toast(j.kind === 'course_outline' ? `${j.title.replace(/^Plan: /, '')}: topics planned` : `${j.title.replace(/^Topic: /, '')} is ready`, 'good')
          }
          if (j.status === 'error') toast(`${j.title}: ${j.error}`, 'bad', { label: 'Jobs', run: () => st.go({ name: 'jobs' }) })
        }
      }),
    []
  )

  const setThemeSaved = (t: Theme) => {
    setTheme(t)
    void api.settings.set({ key: 'ui.theme', value: t })
  }
  const setZoomSaved = (z: number) => {
    const v = Math.round(Math.min(1.5, Math.max(0.75, z)) * 100) / 100
    setZoom(v)
    void api.settings.set({ key: 'ui.zoom', value: v })
  }

  const lastDeckId = async (): Promise<string | null> => {
    const r = useStore.getState().route
    if (r.name === 'deck') return r.id
    if (r.name === 'flashcards' || r.name === 'learn') return r.deckId
    const s = await api.settings.all()
    const last = s['ui.lastRoute'] as Route | undefined
    if (last?.name === 'deck') return last.id
    const decks = await api.decks.list()
    if (decks.length === 1) return decks[0].id
    if (!decks.length) return null
    return chooseDialog(
      'Which deck?',
      decks.map((d) => ({ value: d.id, label: `${d.name} · ${d.card_count} card${d.card_count === 1 ? "" : "s"}` })),
      { confirmText: 'Continue' }
    )
  }

  const newDeck = async () => {
    const name = await askText('New deck', { label: 'Deck name', confirmText: 'Create' })
    if (!name) return
    const d = await api.decks.create({ name })
    useStore.getState().bump()
    go({ name: 'deck', id: d.id })
  }

  useCommands(
    {
      'go.home': () => go({ name: 'home' }),
      'go.decks': () => go({ name: 'decks' }),
      'go.courses': () => go({ name: 'courses' }),
      'go.notes': () => go({ name: 'notes', id: (useStore.getState().route as { id?: string }).id ?? null }),
      'go.jobs': () => go({ name: 'jobs' }),
      'view.jobs': () => go({ name: 'jobs' }),
      'go.settings': () => go({ name: 'settings' }),
      'go.prompts': () => go({ name: 'settings', tab: 'prompts' }),
      'go.models': () => go({ name: 'settings', tab: 'models' }),
      'go.usage': () => go({ name: 'settings', tab: 'usage' }),
      'go.actions': () => go({ name: 'settings', tab: 'actions' }),
      'help.claude': () => go({ name: 'settings', tab: 'claude' }),
      'go.back': () => useStore.getState().goBack(),
      'go.forward': () => useStore.getState().goForward(),
      palette: () => useStore.getState().setPalette(!useStore.getState().palette),
      search: () => useStore.getState().setPalette(true),
      shortcuts: () => useStore.getState().setSheet(!useStore.getState().sheet),
      'view.sidebar': () => useStore.getState().toggleRail(),
      'view.focus': () => useStore.getState().toggleFocus(),
      'view.explain': () => useStore.getState().openExplain(null),
      'view.theme': () => setThemeSaved(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'),
      'view.zoomIn': () => setZoomSaved(zoom + 0.05),
      'view.zoomOut': () => setZoomSaved(zoom - 0.05),
      'view.zoomReset': () => setZoomSaved(1),
      'gen.cards': () => useStore.getState().openGenCards({ deckId: route.name === 'deck' ? route.id : null }),
      'gen.notes': () => useStore.getState().openGenNotes({}),
      'deck.new': newDeck,
      'folder.new': async () => {
        const name = await askText('New folder', { label: 'Folder name', confirmText: 'Create' })
        if (!name) return
        await api.folders.create({ name, kind: route.name === 'notes' ? 'note' : 'deck' })
        useStore.getState().bump()
      },
      'note.new': async () => {
        const n = await api.notes.create({ title: 'Untitled' })
        useStore.getState().bump()
        go({ name: 'notes', id: n.id })
      },
      'card.new': async () => {
        const id = await lastDeckId()
        if (!id) return newDeck()
        go({ name: 'deck', id })
        setTimeout(() => runCommand('card.new'), 60)
      },
      'study.learn': async () => {
        const id = await lastDeckId()
        if (id) go({ name: 'learn', deckId: id })
        else toast('Create a deck first', 'info')
      },
      'study.flashcards': async () => {
        const id = await lastDeckId()
        if (id) go({ name: 'flashcards', deckId: id, mode: 'due' })
      },
      'study.cram': async () => {
        const id = await lastDeckId()
        if (id) go({ name: 'flashcards', deckId: id, mode: 'all' })
      },
      'io.importDeck': async () => {
        try {
          const ids = await api.io.importDeck()
          if (ids.length) {
            toast(`Imported ${ids.length} deck${ids.length === 1 ? '' : 's'}`, 'good')
            useStore.getState().bump()
            go({ name: 'deck', id: ids[0] })
          }
        } catch (e) {
          toast(errorText(e), 'bad')
        }
      },
      'io.importNotes': async () => {
        try {
          const ids = await api.io.importNotes()
          if (ids.length) {
            toast(`Imported ${ids.length} note${ids.length === 1 ? '' : 's'}`, 'good')
            useStore.getState().bump()
            go({ name: 'notes', id: ids[0] })
          }
        } catch (e) {
          toast(errorText(e), 'bad')
        }
      },
      'app.backup': async () => {
        const f = await api.app.backup()
        if (f) toast('Library backed up', 'good')
      },
      'app.restore': () => void api.app.restore().catch((e) => toast(errorText(e), 'bad')),
      'app.showData': () => void api.app.showDataFolder(),
      'ai.cancelAll': async () => {
        if (await confirmDialog('Cancel all running jobs?', undefined, { confirmText: 'Cancel jobs', danger: true })) await api.jobs.cancelAll()
      },
      'help.readme': () => useStore.getState().setSheet(true),
      'help.onboarding': () => setOnboarding(true),
      'study.end': () => {
        const r = useStore.getState()
        if (r.explain) r.openExplain(null)
      }
    },
    [route, theme, zoom]
  )

  // Drag files anywhere onto the window.
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])].map((f) => window.studywise.pathForFile(f)).filter((p) => /\.(pdf|docx|pptx|txt|md|markdown|vtt|srt|apkg|colpkg)$/i.test(p))
      if (files.length) openFiles(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const pageKey = `${route.name}:${(route as { id?: string; deckId?: string }).id ?? (route as { deckId?: string }).deckId ?? ''}`

  return (
    <div className="flex h-full flex-col">
      {!focus && <GooNav />}
      {focus && <div className="drag h-9 shrink-0" />}
      <SetupBanner />
      <main className="relative min-h-0 flex-1">
        <div key={pageKey} className="page-in absolute inset-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
          {!ready ? (
            <div className="grid h-full place-items-center">
              <Spinner className="size-6 text-muted" />
            </div>
          ) : (
            <Suspense fallback={<div className="grid h-full place-items-center"><Spinner className="size-6 text-muted" /></div>}>
              <Page route={route} />
            </Suspense>
          )}
        </div>
      </main>
      <ExplainPanel />
      <GenerateCardsModal />
      <GenerateNotesModal />
      <NewCourseModal />
      <JobDock />
      <CardPreviewModal />
      <CommandPalette />
      <ShortcutSheet />
      <DialogHost />
      <DropChooser />
      <Toasts />
      {onboarding && <Onboarding onDone={() => setOnboarding(false)} />}
      {dragging && (
        <div className="fade-in pointer-events-none fixed inset-3 z-[70] grid place-items-center rounded-xl border-4 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm">
          <div className="pop-in flex flex-col items-center gap-3 text-center">
            <FileUp className="size-12 text-accent" />
            <div className="text-2xl font-semibold">Drop to make a course, notes or flashcards</div>
            <div className="text-muted">PDF, Word, PowerPoint, text or Markdown</div>
          </div>
        </div>
      )}
    </div>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'decks':
      return <Decks folderId={route.folderId ?? null} />
    case 'deck':
      return <DeckPage id={route.id} focusCardId={route.cardId} />
    case 'flashcards':
      return <Flashcards deckId={route.deckId} mode={route.mode} />
    case 'learn':
      return <Learn deckId={route.deckId} cardIds={route.cardIds} />
    case 'notes':
      return <Notes noteId={route.id ?? null} />
    case 'settings':
      return <Settings tab={route.tab} />
    case 'jobs':
      return <Jobs />
    case 'courses':
      return <Courses />
    case 'course':
      return <CoursePage id={route.id} />
    case 'topic':
      return <TopicPage id={route.id} />
  }
}

const isAnki = (p: string) => /\.(apkg|colpkg)$/i.test(p)

/** Anki packages import straight away as decks; anything else asks what to make. */
function openFiles(paths: string[]) {
  const st = useStore.getState()
  const decks = paths.filter(isAnki)
  const rest = paths.filter((p) => !isAnki(p))
  if (rest.length) st.setDropFiles(rest)
  if (!decks.length) return
  st.toast(`Importing ${decks.length === 1 ? decks[0].split(/[\\/]/).pop() : `${decks.length} Anki packages`}…`)
  api.io
    .importDeck({ files: decks })
    .then((ids) => {
      if (!ids.length) return
      st.toast(`Imported ${ids.length} deck${ids.length === 1 ? '' : 's'} from Anki`, 'good')
      st.bump()
      if (!rest.length) st.go({ name: 'deck', id: ids[0] })
    })
    .catch((e) => st.toast(errorText(e), 'bad'))
}

function OllamaBanner({ problem, onHide }: { problem: string; onHide: () => void }) {
  return (
    <div className="pop-in mx-3 mt-2.5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 sm:mx-4">
      <AlertTriangle className="size-5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 text-[0.92rem]">
        <div className="font-semibold">Ollama isn’t set up yet</div>
        <div className="text-muted">{problem}</div>
      </div>
      <Button size="sm" variant="ink" onClick={() => useStore.getState().go({ name: 'settings', tab: problem.includes('model') ? 'models' : 'claude' })}>
        Open settings
      </Button>
      <button onClick={onHide} className="text-muted hover:text-ink" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  )
}

function SetupBanner() {
  const claude = useStore((s) => s.claude)
  const ai = useStore((s) => s.ai)
  const [hidden, setHidden] = useState(false)
  const [checking, setChecking] = useState(false)
  if (ai?.provider === 'ollama') {
    if (hidden || claude?.mock) return null
    const problem = !ai.ollama.ready
      ? 'Add your Ollama API key in Settings → AI provider. You can create one at ollama.com/settings/keys.'
      : !ai.ollama.defaultModel
        ? 'Choose a default model in Settings → Models.'
        : null
    return problem ? <OllamaBanner problem={problem} onHide={() => setHidden(true)} /> : null
  }
  if (!claude || hidden || claude.mock || (claude.path && claude.loggedIn)) return null
  return (
    <div className="pop-in mx-3 mt-2.5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 sm:mx-4">
      <AlertTriangle className="size-5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 text-[0.92rem]">
        <div className="font-semibold">{claude.path ? 'Claude Code isn’t logged in' : 'Claude Code isn’t installed'}</div>
        <div className="text-muted">
          {claude.path ? (
            <>
              AI features need your own Claude login. Open Terminal and run <code className="rounded bg-surface px-1.5 font-mono">claude</code>, sign in, then press Re-check.
            </>
          ) : (
            <>
              Install it with <code className="rounded bg-surface px-1.5 font-mono">npm install -g @anthropic-ai/claude-code</code>, run <code className="rounded bg-surface px-1.5 font-mono">claude</code> once to log in, then press Re-check.
            </>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ink"
        loading={checking}
        onClick={async () => {
          setChecking(true)
          useStore.getState().setClaude(await api.claude.recheck())
          setChecking(false)
        }}
      >
        Re-check
      </Button>
      <Button size="sm" variant="ghost" onClick={() => useStore.getState().go({ name: 'settings', tab: 'claude' })}>
        Settings
      </Button>
      <button onClick={() => setHidden(true)} className="text-muted hover:text-ink" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  )
}

function DropChooser() {
  const files = useStore((s) => s.dropFiles)
  const set = useStore((s) => s.setDropFiles)
  if (!files) return null
  const names = files.map((f) => f.split('/').pop()).join(', ')
  const pick = (kind: 'course' | 'notes' | 'cards') => {
    set(null)
    if (kind === 'course') useStore.getState().openNewCourse(files)
    else if (kind === 'notes') useStore.getState().openGenNotes({ files })
    else {
      const r = useStore.getState().route
      useStore.getState().openGenCards({ files, deckId: r.name === 'deck' ? r.id : null })
    }
  }
  return (
    <div data-modal className="fade-in fixed inset-0 z-[65] grid place-items-center bg-black/30 p-4 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && set(null)} onKeyDown={(e) => e.key === 'Escape' && set(null)}>
      <div className="pop-in w-full max-w-[860px] rounded-xl border border-line bg-bg p-6 shadow-2xl">
        <h2 className="text-xl font-semibold">What should we make?</h2>
        <p className="mt-1 truncate text-muted">{names}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['course', GraduationCap, 'Make a course', 'Split it into topics and learn them in short sections with questions'],
              ['notes', NotebookPen, 'Generate notes', 'Structured study notes in your style, streamed into the editor'],
              ['cards', Layers, 'Generate flashcards', 'Exam-style cards, with a preview to check and fix before saving']
            ] as const
          ).map(([k, Icon, title, sub]) => (
            <button
              key={k}
              autoFocus={k === 'course'}
              onClick={() => pick(k)}
              className="group flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-5 text-left transition-[transform,box-shadow,border-color] duration-500 ease-out-soft hover:border-accent active:scale-[0.98]"
            >
              <span className="text-accent">
                <Icon className="size-5" />
              </span>
              <span className="text-lg font-semibold">{title}</span>
              <span className="text-[0.9rem] text-muted">{sub}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 text-right">
          <Button variant="ghost" onClick={() => set(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[80] flex flex-col items-center gap-2 sm:left-auto sm:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pop-in pointer-events-auto flex max-w-[440px] items-center gap-3 rounded-full py-2.5 pr-2.5 pl-5 text-[0.92rem] font-medium shadow-xl',
            t.kind === 'bad' ? 'bg-bad text-white' : t.kind === 'good' ? 'bg-ink text-bg' : 'bg-ink text-bg'
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
              className="rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="grid size-7 place-items-center rounded-full opacity-70 hover:opacity-100" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
