import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate, templateVariables } from '@shared/template'
import { openDb, closeDb, getDb } from '../../src/main/db'
import * as presets from '../../src/main/ai/presets'
import { renderPrompt, runAI, repairPrompt } from '../../src/main/ai'
import { MY_NOTES, LINKING_TEXTS } from '../../src/main/ai/prompts/notes'
import { EXAM_FLASHCARDS } from '../../src/main/ai/prompts/cards'
import { createDeck, updateDeck, listAiCalls, getSetting, setSetting } from '../../src/main/db/repo'
import { jsonSchemaFor, extractJson } from '../../src/main/ai/schemas'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-test-'))
  openDb(join(dir, 't.db'))
  presets.seedPresets()
})
afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('template rendering', () => {
  it('replaces variables, blanks unknown ones, stringifies objects', () => {
    expect(renderTemplate('Hi {{ name }}, {{missing}}!', { name: 'Sam' })).toBe('Hi Sam, !')
    expect(renderTemplate('{{n}} {{b}} {{o}}', { n: 3, b: true, o: { a: 1 } })).toBe('3 true {\n  "a": 1\n}')
    expect(templateVariables('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
  })
})

describe('seeded presets', () => {
  it('seeds the three exact presets as defaults', () => {
    const notes = presets.listPresets('generate_notes')
    expect(notes.find((p) => p.name === 'My notes')?.is_default).toBe(true)
    expect(notes.find((p) => p.name === 'My notes')?.user_template).toBe(MY_NOTES)
    expect(notes.find((p) => p.name === 'Linking texts')?.user_template).toBe(LINKING_TEXTS)
    const cards = presets.listPresets('generate_cards')
    const exam = cards.find((p) => p.name === 'Exam flashcards (my style)')!
    expect(exam.is_default).toBe(true)
    expect(exam.output_mode).toBe('studysmarter_text')
    expect(exam.user_template).toBe(EXAM_FLASHCARDS)
    expect(cards.find((p) => p.name === 'Standard cards')?.output_mode).toBe('json')
    expect(presets.listActions().map((a) => a.name)).toEqual(["Explain like I'm 12", 'Exam-style question', 'Real-world example', 'Mnemonic'])
  })
  it('seeding twice does not duplicate', () => {
    const n = presets.listPresets().length
    presets.seedPresets()
    expect(presets.listPresets().length).toBe(n)
  })
  it('updates untouched built-ins to the new text but keeps edited ones', () => {
    const myNotes = () => presets.getPresetByKey('notes.my_notes')!
    // An install from before seeding was tracked: version 1 means never edited.
    getDb().prepare("UPDATE presets SET user_template = 'old built-in text' WHERE builtin_key = 'notes.my_notes'").run()
    setSetting('presets.seeded', {})
    presets.seedPresets()
    expect(myNotes().user_template).toBe(MY_NOTES)

    // Edited by the user: never overwritten.
    presets.updatePreset(myNotes().id, { user_template: 'my own prompt' })
    presets.seedPresets()
    expect(myNotes().user_template).toBe('my own prompt')

    // Reset: follows the built-in text again.
    presets.resetPreset(myNotes().id)
    expect(myNotes().user_template).toBe(MY_NOTES)
    expect(getSetting<Record<string, string>>('presets.seeded', {})['notes.my_notes']).toBeTruthy()
  })
})

describe('prompt override + schema append', () => {
  it('a custom json prompt still gets the schema appended', () => {
    const hint = presets.defaultPreset('hint')
    const r = renderPrompt({ task: 'hint', presetId: hint.id, vars: {}, presetOverride: { system: 'x', user_template: 'Just say something about {{front}}', output_mode: 'json' } })
    expect(r.prompt.startsWith('Just say something about')).toBe(true)
    // The format rides with the system prompt (cached across calls), not the message.
    expect(r.system).toContain('OUTPUT FORMAT')
    expect(r.system).toContain('"hint"')
    expect(r.prompt).not.toContain('OUTPUT FORMAT')
    expect(r.schema).toEqual(jsonSchemaFor('hint'))
  })
  it('editing bumps the version, keeps history, and reset restores it', () => {
    const p = presets.defaultPreset('hint')
    const edited = presets.updatePreset(p.id, { user_template: 'New {{front}}' })
    expect(edited.version).toBe(p.version + 1)
    expect(presets.presetVersions(p.id)[0].user_template).toBe(p.user_template)
    const reset = presets.resetPreset(p.id)
    expect(reset.user_template).toBe(p.user_template)
  })
  it('source text and deck instructions are appended when the template lacks them', () => {
    const deck = createDeck({ name: 'Physics' })
    updateDeck(deck.id, { extra_instructions: 'Use SI units.' })
    const r = renderPrompt({ task: 'generate_cards', deckId: deck.id, vars: { source_text: 'SOURCE BODY' } })
    expect(r.prompt).toContain('<source>\nSOURCE BODY\n</source>')
    expect(r.prompt).toContain('Extra instructions for this deck:\nUse SI units.')
    expect(r.mode).toBe('studysmarter_text')
  })
  it('duplicate / set default / delete', () => {
    const p = presets.defaultPreset('explain')
    const copy = presets.duplicatePreset(p.id)
    presets.setDefaultPreset(copy.id)
    expect(presets.defaultPreset('explain').id).toBe(copy.id)
    presets.deletePreset(copy.id)
    expect(presets.defaultPreset('explain').id).toBe(p.id)
    expect(() => presets.deletePreset(p.id)).toThrow()
  })
  it('export → import round trip', () => {
    const bundle = presets.exportPresets()
    const r = presets.importPresets(JSON.parse(JSON.stringify(bundle)))
    expect(r.presets).toBe(bundle.presets.length)
    expect(presets.listActions()).toHaveLength(4)
  })
})

describe('runAI with AI_MOCK', () => {
  it('validates json output and logs the call', async () => {
    const r = await runAI<{ hint: string }>({ task: 'hint', vars: { front: 'q', back: 'a' } })
    expect(typeof r.data.hint).toBe('string')
    expect(listAiCalls(5)[0].task).toBe('hint')
  })
  it('fixes a reply in the wrong shape by sending back just the reply, not the whole request', async () => {
    const before = listAiCalls(1000).length
    const r = await runAI<{ hint: string }>({ task: 'hint', vars: { front: 'q', back: 'a', mock_bad_json: true } })
    expect(typeof r.data.hint).toBe('string')
    // The bad reply, then one repair call: no full re-run.
    expect(listAiCalls(1000).length - before).toBe(2)
    const fix = repairPrompt('{"wrong_shape": true}', 'hint: Required')
    expect(fix).toContain('<reply>\n{"wrong_shape": true}\n</reply>')
    expect(fix).toContain('hint: Required')
  })
  it('extractJson finds JSON inside prose and fences', () => {
    expect(extractJson('Sure! {"a": {"b": "}"}} trailing')).toEqual({ a: { b: '}' } })
    expect(extractJson('```json\n[1,2]\n```')).toEqual([1, 2])
  })
})
