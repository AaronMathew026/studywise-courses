import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { Logo } from './GooNav'
import { Button, Input, Kbd, Select, cx } from './ui'
import { OllamaModelOptions, useOllamaModels } from './OllamaModels'
import { keyLabel } from '@shared/keymap'

const STEPS = ['welcome', 'claude', 'level', 'deck', 'keys'] as const
type Step = (typeof STEPS)[number]

const SAMPLE: [string, string][] = [
  ['What is the work function?', 'the **minimum energy** needed to remove an electron from the surface of a metal'],
  ['Explain why a threshold frequency exists (2)', '- below the threshold frequency, photons have less energy than the work function\n\n- so they do not have enough energy to remove an electron'],
  ['Each electron can only absorb _________', 'one photon of energy'],
  ['What is the equation for the energy of a photon?', '$E = hf$'],
  ['What happens when light intensity increases above the threshold?', 'more **photoelectrons** are emitted per second'],
  ['What are the units of Planck’s constant?', '**J s** (joule seconds)'],
  ['The ________ of a photon depends only on its ________', '- energy\n\n- frequency'],
  ['Define a photoelectron', 'an **electron** emitted from a metal surface by light']
]

const LEVELS = ['GCSE', 'A-level', 'IB', 'First-year university', 'Later university', 'Postgraduate']

export function Onboarding({ onDone }: { onDone: () => void }) {
  const go = useStore((s) => s.go)
  const claude = useStore((s) => s.claude)
  const dropFiles = useStore((s) => s.dropFiles)
  const [step, setStep] = useState<Step>('welcome')
  const [checking, setChecking] = useState(false)
  const [level, setLevel] = useState('')
  const [subject, setSubject] = useState('')
  const idx = STEPS.indexOf(step)

  const finish = async () => {
    await api.settings.set({ key: 'onboarding.done', value: true })
    if (level || subject) await api.settings.set({ key: 'profile.level', value: [level, subject].filter(Boolean).join(' ') })
    onDone()
  }
  const next = () => (idx < STEPS.length - 1 ? setStep(STEPS[idx + 1]) : void finish())
  const back = () => idx > 0 && setStep(STEPS[idx - 1])

  // A file dropped mid-onboarding means they're ready to go.
  useEffect(() => {
    if (dropFiles) void finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropFiles])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      if (e.key === 'Escape') void finish()
      else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        next()
      } else if (!typing && e.key === 'ArrowRight') next()
      else if (!typing && e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const recheck = async () => {
    setChecking(true)
    useStore.getState().setClaude(await api.claude.recheck())
    setChecking(false)
  }

  const sampleDeck = async () => {
    try {
      const d = await api.decks.create({ name: 'Sample: the photoelectric effect' })
      await api.cards.create({ cards: SAMPLE.map(([front, back]) => ({ deck_id: d.id, front, back, format: 'question_answer' as const, tags: ['sample'] })) })
      useStore.getState().bump()
      await finish()
      go({ name: 'deck', id: d.id })
    } catch (e) {
      toast(errorText(e), 'bad')
    }
  }
  const pickPdf = async () => {
    const files = await api.app.pickFiles({ kind: 'sources' })
    if (!files.length) return
    await finish()
    useStore.getState().openGenCards({ files })
  }
  const importDeck = async () => {
    await finish()
    const ids = await api.io.importDeck().catch(() => [])
    if (ids.length) {
      useStore.getState().bump()
      go({ name: 'deck', id: ids[0] })
    }
  }

  const ai = useStore((s) => s.ai)
  const useOllama = ai?.provider === 'ollama'
  const ready = useOllama ? !!ai?.ollama.ready && !!ai.ollama.defaultModel : !!claude?.path && claude.loggedIn
  const mock = !!claude?.mock

  return createPortal(
    <div data-modal className="fade-in drag fixed inset-0 z-[60] grid place-items-center bg-bg p-6">
      <div className="no-drag w-full max-w-[540px]">
        <div key={step} className="page-in min-h-[360px]">
          {step === 'welcome' && (
            <div>
              <div className="mb-8">
                <Logo size={56} />
              </div>
              <h1 className="text-[2.2rem] leading-tight font-semibold tracking-[-0.03em]">Welcome to Studywise.</h1>
              <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
                Give it your lecture PDFs. It writes the notes, makes the flashcards, quizzes you, and marks your answers. It runs on your own Claude account, or on Ollama if you prefer.
              </p>
            </div>
          )}

          {step === 'claude' && (
            <div>
              <h1 className="text-[1.8rem] font-semibold tracking-[-0.025em]">Connect an AI</h1>
              <p className="mt-3 text-muted">Use the Claude Code app you already have, or Ollama Cloud with an API key.</p>
              <div className="mt-5 flex gap-1.5">
                {(['claude', 'ollama'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={async () => useStore.getState().setAi(await api.ai.setProvider({ provider: p }))}
                    className={cx('rounded-full px-4 py-1.5 text-[0.92rem] font-semibold transition-colors', (ai?.provider ?? 'claude') === p ? 'bg-ink text-bg' : 'bg-surface-2 text-muted hover:text-ink')}
                  >
                    {p === 'claude' ? 'Claude Code' : 'Ollama Cloud'}
                  </button>
                ))}
              </div>
              {useOllama ? (
                <OllamaSetup />
              ) : (
              <>
              <div className={cx('mt-4 rounded-xl border p-4', ready || mock ? 'border-good/40 bg-good-soft' : 'border-line bg-surface')}>
                {ready || mock ? (
                  <div>
                    <div className="font-medium text-good">{mock ? 'Mock mode: AI is simulated' : 'Connected'}</div>
                    {!mock && <div className="mt-1 font-mono text-[0.8rem] break-all text-muted">{claude?.path} · {claude?.version}</div>}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 text-[0.95rem]">
                    <div className="font-medium">{claude?.path ? 'Claude Code is installed but not signed in.' : 'Claude Code isn’t installed yet.'}</div>
                    <div className="rounded-lg bg-surface-2 p-3 font-mono text-[0.82rem] leading-relaxed">
                      {!claude?.path && (
                        <>
                          npm install -g @anthropic-ai/claude-code
                          <br />
                        </>
                      )}
                      claude
                    </div>
                    <div className="text-[0.88rem] text-muted">Run {claude?.path ? 'this' : 'these'} in a terminal, sign in, then check again.</div>
                  </div>
                )}
              </div>
              {!ready && !mock && (
                <Button className="mt-4" onClick={recheck} loading={checking}>
                  Check again
                </Button>
              )}
              </>
              )}
            </div>
          )}

          {step === 'level' && (
            <div>
              <h1 className="text-[1.8rem] font-semibold tracking-[-0.025em]">What are you studying?</h1>
              <p className="mt-3 text-muted">Explanations and questions get pitched at this level. You can change it per deck later.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLevel(level === l ? '' : l)}
                    className={cx('rounded-lg border px-3 py-1.5 text-[0.92rem] transition-colors', level === l ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface hover:border-accent/50')}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <Input className="mt-4" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject, e.g. Physics (AQA) or Computer Science" />
            </div>
          )}

          {step === 'deck' && (
            <div>
              <h1 className="text-[1.8rem] font-semibold tracking-[-0.025em]">Your first deck</h1>
              <p className="mt-3 text-muted">You can also drop a file anywhere on the window, any time.</p>
              <div className="mt-6 flex flex-col gap-2">
                {(
                  [
                    ['Make flashcards from a PDF', 'Lecture slides, notes, a chapter', pickPdf, !(ready || mock)],
                    ['Import a deck', 'Anki .apkg, or a StudySmarter .txt or .xlsx export', importDeck, false],
                    ['Try a sample deck', 'Eight physics cards, ready for Learn', sampleDeck, false]
                  ] as const
                ).map(([title, sub, run, needsAi]) => (
                  <button
                    key={title}
                    onClick={() => void run()}
                    disabled={needsAi}
                    className="group flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent/60 disabled:opacity-50"
                  >
                    <span>
                      <span className="block font-medium">{title}</span>
                      <span className="block text-[0.88rem] text-muted">{needsAi ? 'Connect an AI first' : sub}</span>
                    </span>
                    <span className="text-muted transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'keys' && (
            <div>
              <h1 className="text-[1.8rem] font-semibold tracking-[-0.025em]">A few keys worth knowing</h1>
              <dl className="mt-6 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-[0.98rem]">
                {(
                  [
                    ['⌘K', 'find anything, run any command'],
                    ['⌘G', 'generate flashcards'],
                    ['⌘L', 'start Learn'],
                    ['Space  1–4', 'flip a card, rate it'],
                    ['⌘E', 'explain the current card'],
                    ['?', 'every shortcut']
                  ] as const
                ).map(([k, what]) => (
                  <div key={k} className="contents">
                    <dt className="flex gap-1">
                      {k.split('  ').map((part) => (
                        <Kbd key={part} className="text-[0.8rem]">
                          {part}
                        </Kbd>
                      ))}
                    </dt>
                    <dd className="text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div className="mt-10 flex items-center gap-3">
          <div className="flex flex-1 gap-1.5">
            {STEPS.map((s, i) => (
              <button key={s} onClick={() => setStep(s)} aria-label={`Step ${i + 1}`} className={cx('h-1.5 rounded-full transition-all duration-500 ease-out-soft', i === idx ? 'w-6 bg-accent' : i < idx ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-line')} />
            ))}
          </div>
          {idx === 0 ? (
            <Button variant="ghost" onClick={() => void finish()}>
              Skip
            </Button>
          ) : (
            <Button variant="ghost" onClick={back}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={next}>
            {idx === STEPS.length - 1 ? 'Start' : step === 'claude' && !ready && !mock ? 'Skip for now' : 'Continue'}
          </Button>
        </div>
        <p className="mt-3 text-right text-[0.78rem] text-muted">{keyLabel('↩ to continue, esc to skip')}</p>
      </div>
    </div>,
    document.body
  )
}

/** Ollama Cloud in two steps: paste a key, pick a default model. */
function OllamaSetup() {
  const ai = useStore((s) => s.ai)!
  const setAi = useStore((s) => s.setAi)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const { models, error, load } = useOllamaModels(ai.ollama.ready)
  const saveKey = async () => {
    setSaving(true)
    try {
      await api.ollama.setConfig({ apiKey: key.trim() })
      setAi(await api.ai.status())
      setKey('')
      await load(true)
    } catch (e) {
      toast(errorText(e), 'bad')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-[0.95rem]">
      {!ai.ollama.ready ? (
        <>
          <div className="font-medium">Paste your Ollama API key</div>
          <div className="text-[0.88rem] text-muted">Create one at ollama.com/settings/keys. It’s stored encrypted on this computer.</div>
          <div className="flex gap-2">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ollama API key" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && key.trim() && (e.stopPropagation(), void saveKey())} />
            <Button variant="primary" disabled={!key.trim()} loading={saving} onClick={saveKey}>
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="font-medium text-good">Key saved</div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.88rem] text-muted">Default model (you can set one per task later in Settings → Models)</span>
            <Select value={ai.ollama.defaultModel} onChange={async (e) => setAi({ ...ai, ollama: await api.ollama.setDefault({ model: e.target.value }) })}>
              <option value="">{models ? 'Choose a model…' : 'Loading models…'}</option>
              <OllamaModelOptions models={models ?? []} saved={ai.ollama.saved} current={ai.ollama.defaultModel} />
            </Select>
          </label>
          {error && <div className="text-[0.88rem] text-bad">{error}</div>}
        </>
      )}
    </div>
  )
}
