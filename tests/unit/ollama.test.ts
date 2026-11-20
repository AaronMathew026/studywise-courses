import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { openDb, closeDb } from '../../src/main/db'
import * as repo from '../../src/main/db/repo'
import { seedPresets } from '../../src/main/ai/presets'
import { runOllama, visibleText, thinkFor, listOllamaModels, setOllamaKey, getOllamaKey, ollamaStatus } from '../../src/main/ai/ollama'
import { modelFor, resolveModel, setActiveProvider, setGlobalModel } from '../../src/main/ai/models'
import { runAI } from '../../src/main/ai'

// A fake Ollama: records requests, answers with scripted NDJSON chunks.
type Reply = { status?: number; chunks?: object[]; error?: string }
let server: Server
let base: string
let requests: { path: string; body: Record<string, unknown>; auth?: string }[] = []
let replies: Reply[] = []

const readBody = (req: IncomingMessage) =>
  new Promise<string>((res) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => res(s))
  })

let dir: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sw-ollama-'))
  openDb(join(dir, 't.db'))
  seedPresets()
  server = createServer(async (req, res) => {
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {}
    requests.push({ path: req.url ?? '', body, auth: req.headers.authorization })
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ models: [{ name: 'zeta:1b', capabilities: ['completion'] }, { name: 'alpha:7b', capabilities: ['completion', 'vision'] }] }))
    }
    const r = replies.shift() ?? { chunks: [{ message: { content: 'ok' }, done: true, done_reason: 'stop' }] }
    if (r.status && r.status !== 200) {
      res.statusCode = r.status
      return res.end(JSON.stringify({ error: r.error ?? 'nope' }))
    }
    res.setHeader('Content-Type', 'application/x-ndjson')
    for (const c of r.chunks ?? []) res.write(JSON.stringify(c) + '\n')
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  requests = []
  replies = []
  repo.setSetting('ollama.baseUrl', base)
})

const chunks = (...parts: string[]) => [...parts.map((p) => ({ message: { role: 'assistant', content: p }, done: false })), { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 34 }]

describe('helpers', () => {
  it('hides inline <think> blocks, even half-streamed', () => {
    expect(visibleText('<think>hmm</think>\nHello')).toBe('Hello')
    expect(visibleText('Hi <think>still going')).toBe('Hi ')
    expect(visibleText('Hi <thi')).toBe('Hi ')
    expect(visibleText('a < b')).toBe('a < b')
  })
  it('maps effort to think', () => {
    expect(thinkFor('qwen3', null)).toBeUndefined()
    expect(thinkFor('qwen3', 'off')).toBe(false)
    expect(thinkFor('qwen3', 'high')).toBe(true)
    expect(thinkFor('gpt-oss:120b', 'medium')).toBe('medium')
    expect(thinkFor('gpt-oss:120b', 'max')).toBe('high')
  })
})

describe('runOllama', () => {
  it('streams, strips thinking, counts tokens', async () => {
    replies.push({ chunks: chunks('<think>plan', '</think>Hel', 'lo') })
    let streamed = ''
    const events: string[] = []
    const r = await runOllama({ prompt: 'hi', system: 'be nice', model: 'm', timeoutMs: 5000, onDelta: (t) => (streamed += t), onEvent: (e) => events.push(e.kind === 'output' ? `out:${e.text}` : e.kind) })
    expect(r.text).toBe('Hello')
    expect(streamed).toBe('Hello')
    expect(events).toEqual(['thinking', 'out:Hel', 'out:lo'])
    expect(r.inputTokens).toBe(12)
    expect(r.outputTokens).toBe(34)
    expect(r.stopReason).toBe('end_turn')
    const body = requests[0].body as { messages: { role: string }[]; options?: { num_ctx: number }; stream: boolean }
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body.stream).toBe(true)
    expect(body.options?.num_ctx).toBe(32768) // local server
  })

  it('keeps a session for auto-continue', async () => {
    replies.push({ chunks: [{ message: { content: 'part one' }, done: true, done_reason: 'length' }] })
    const first = await runOllama({ prompt: 'make cards', model: 'm', timeoutMs: 5000, persistSession: true })
    expect(first.stopReason).toBe('max_tokens')
    replies.push({ chunks: chunks(' part two') })
    await runOllama({ prompt: 'continue', model: 'm', timeoutMs: 5000, resume: first.sessionId!, persistSession: true })
    const msgs = (requests[1].body as { messages: { role: string; content: string }[] }).messages
    expect(msgs.map((m) => `${m.role}:${m.content}`)).toEqual(['user:make cards', 'assistant:part one', 'user:continue'])
  })

  it('sends structured output to local models only', async () => {
    await runOllama({ prompt: 'json please', model: 'm', timeoutMs: 5000, jsonSchema: { type: 'object' } })
    expect(requests[0].body.format).toEqual({ type: 'object' })
    await runOllama({ prompt: 'json please', model: 'gpt-oss:120b-cloud', timeoutMs: 5000, jsonSchema: { type: 'object' } })
    expect(requests[1].body.format).toBeUndefined()
  })

  it('retries without think when the model has no thinking', async () => {
    replies.push({ status: 400, error: '"m" does not support thinking' })
    replies.push({ chunks: chunks('fine') })
    const r = await runOllama({ prompt: 'x', model: 'm', effort: 'high', timeoutMs: 5000 })
    expect(r.text).toBe('fine')
    expect(requests[0].body.think).toBe(true)
    expect(requests[1].body.think).toBeUndefined()
  })

  it('explains auth and missing-model errors', async () => {
    replies.push({ status: 404, error: 'model "nope" not found' })
    await expect(runOllama({ prompt: 'x', model: 'nope', timeoutMs: 5000 })).rejects.toThrow(/doesn't have that model/)
    replies.push({ status: 500, error: 'boom' })
    await expect(runOllama({ prompt: 'x', model: 'm', timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'transient' })
  })

  it('needs a key for Ollama Cloud and sends it as a bearer token', async () => {
    repo.setSetting('ollama.baseUrl', 'https://ollama.com')
    setOllamaKey(null)
    const env = process.env.OLLAMA_API_KEY
    delete process.env.OLLAMA_API_KEY
    try {
      expect(ollamaStatus()).toMatchObject({ cloud: true, hasKey: false, ready: false })
      await expect(runOllama({ prompt: 'x', model: 'm', timeoutMs: 5000 })).rejects.toThrow(/API key/)
      setOllamaKey('sk-test')
      expect(getOllamaKey()).toBe('sk-test')
      expect(ollamaStatus()).toMatchObject({ hasKey: true, ready: true })
      // The key never shows up in plain settings reads.
      expect(JSON.stringify(repo.getSetting('ollama.baseUrl', ''))).not.toContain('sk-test')
    } finally {
      if (env) process.env.OLLAMA_API_KEY = env
    }
    repo.setSetting('ollama.baseUrl', base)
    await runOllama({ prompt: 'x', model: 'm', timeoutMs: 5000 })
    expect(requests.at(-1)!.auth).toBe('Bearer sk-test')
    setOllamaKey(null)
  })

  it('reads source files into the prompt', async () => {
    const file = join(dir, 'notes.md')
    require('node:fs').writeFileSync(file, '# Photons\nE = hf')
    await runOllama({ prompt: 'summarise', model: 'm', timeoutMs: 5000, files: [file] })
    const content = (requests.at(-1)!.body as { messages: { content: string }[] }).messages[0].content
    expect(content).toContain('<file name="notes.md">')
    expect(content).toContain('E = hf')
  })
})

describe('model list and choice', () => {
  it('lists models sorted', async () => {
    const mock = process.env.AI_MOCK
    delete process.env.AI_MOCK
    const m = await listOllamaModels(true).finally(() => mock && (process.env.AI_MOCK = mock))
    expect(m.map((x) => x.name)).toEqual(['alpha:7b', 'zeta:1b'])
    expect(m[0].capabilities).toContain('vision')
  })

  it('resolves per-task, default and deck models', () => {
    setActiveProvider('ollama')
    repo.setSetting('ollama.defaultModel', 'base:1b')
    expect(modelFor('hint')).toMatchObject({ model: 'base:1b', provider: 'ollama' })
    setGlobalModel('hint', { model: 'fast:1b', effort: 'off' })
    expect(modelFor('hint')).toMatchObject({ model: 'fast:1b', effort: 'off' })
    const deck = repo.createDeck({ name: 'D' })
    repo.updateDeck(deck.id, { model_overrides: { 'ollama:hint': { model: 'deck:3b', effort: null }, hint: { model: 'opus', effort: null } } })
    expect(modelFor('hint', deck.id).model).toBe('deck:3b')
    // Claude names from custom actions fall back to the Ollama table.
    expect(resolveModel('custom_action', null, { model: 'sonnet', effort: null }).model).toBe('base:1b')
    expect(resolveModel('custom_action', null, { model: 'llama3:8b', effort: null }).model).toBe('llama3:8b')
    setActiveProvider('claude')
    expect(modelFor('hint', deck.id)).toMatchObject({ model: 'opus', provider: 'claude' })
  })

  it('runAI goes through Ollama when it is the provider', async () => {
    const mock = process.env.AI_MOCK
    delete process.env.AI_MOCK
    try {
      setActiveProvider('ollama')
      repo.setSetting('ollama.defaultModel', 'base:1b')
      // Cloud-style reply: JSON wrapped in prose and a fence, parsed out of the text.
      replies.push({ chunks: chunks('Sure!\n```json\n{"hint": "think about ', 'energy"}\n```') })
      const r = await runAI<{ hint: string }>({ task: 'hint', vars: { front: 'f', back: 'b', question: 'q', type: 'free_answer', previous_hints: '(none)' } })
      expect(r.model.model).toBe('fast:1b') // set per task above
      expect(requests.at(-1)!.path).toBe('/api/chat')
      expect(r.data).toEqual({ hint: 'think about energy' })
      expect(repo.listAiCalls(1)[0].model).toMatch(/^ollama:fast:1b/)
    } finally {
      setActiveProvider('claude')
      if (mock) process.env.AI_MOCK = mock
    }
  })
})
