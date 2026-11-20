import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parseFrontmatter, importMarkdown, exportObsidian, exportNotion } from '@shared/noteFormats'
import * as io from '../../src/main/importexport'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

describe('frontmatter', () => {
  it('reads values, inline lists and block lists', () => {
    const { data, body } = parseFrontmatter('---\nmodule: HCI\ntags: [a, b]\naliases:\n  - IFT\n  - "Foraging"\n---\n# Body')
    expect(data).toEqual({ module: 'HCI', tags: ['a', 'b'], aliases: ['IFT', 'Foraging'] })
    expect(body).toBe('# Body')
  })
})

describe('importing', () => {
  it('turns Notion toggles, callouts and page links into the stored syntax', () => {
    const md = '<aside>💡 Remember the threshold</aside>\n\n<details><summary>Why?</summary>Because photons.</details>\n\nSee [Work function](Work%20function%200123456789abcdef0123456789abcdef.md).'
    const out = importMarkdown(md)
    expect(out).toContain('> [!tip]\n> Remember the threshold')
    expect(out).toContain('> [!note]- Why?\n> Because photons.')
    expect(out).toContain('[[Work function]]')
  })
  it('resolves Obsidian embeds and Notion image paths, and leaves code alone', () => {
    const resolveImage = (ref: string) => (ref.endsWith('.png') ? `studywise-file://attachments/${ref.split('/').pop()}` : null)
    const out = importMarkdown('![[photo.png|300]]\n![x](Page%20abc/diagram%201.png)\n```\n![[photo.png]]\n```', { resolveImage })
    expect(out).toContain('![](studywise-file://attachments/photo.png)')
    expect(out).toContain('![x](studywise-file://attachments/diagram 1.png)')
    expect(out).toContain('```\n![[photo.png]]\n```')
  })
  it('reads Obsidian properties and keeps the extra ones', () => {
    const n = io.noteFromMarkdown('---\nmodule: HCI\nweek: 3\ntags: [ift]\n---\n# Info Foraging\n\n> [!note] Key idea\n> scent', 'file')
    expect([n.title, n.module, n.week]).toEqual(['Info Foraging', 'HCI', '3'])
    expect(n.content.startsWith('---\ntags: [ift]\n---\n')).toBe(true)
    expect(n.content).toContain('> [!note] Key idea')
  })
  it('imports a vault zip, copying the images it embeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sw-notes-'))
    try {
      const zip = new JSZip()
      zip.file('Vault/Notes/Pipelines.md', '# Pipelines\n\n![[stages.png]]\n\n![](../Notion%20Page/img.png)')
      zip.file('Vault/attachments/stages.png', PNG)
      zip.file('Vault/Notion Page/img.png', PNG)
      const file = join(dir, 'vault.zip')
      writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
      const att = join(dir, 'attachments')
      const [note] = await io.notesFromFile(file, att)
      expect(note.content.match(/studywise-file:\/\/attachments\//g)?.length).toBe(2)
      expect(readdirSync(att)).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('imports a single Obsidian note with its image from an attachments folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sw-notes-'))
    try {
      mkdirSync(join(dir, 'attachments'))
      writeFileSync(join(dir, 'attachments', 'fig.png'), PNG)
      writeFileSync(join(dir, 'Note.md'), 'Look: ![[fig.png]]')
      const [note] = await io.notesFromFile(join(dir, 'Note.md'), join(dir, 'store'))
      expect(note.content).toMatch(/!\[\]\(studywise-file:\/\/attachments\/[\w-]+\.png\)/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('exporting', () => {
  const note = {
    title: 'Pipelines',
    module: 'Architecture',
    type: 'Lecture',
    week: '4',
    content: '---\ntags: [cpu]\n---\nA ==key== idea, see [[Hazards|hazards]] %%todo%%.\n\n> [!warning] Careful\n> stalls\n\n![fig](studywise-file://attachments/abc.png)\n\n```svg\n<svg viewBox="0 0 10 10"></svg>\n```\n'
  }
  it('Obsidian: properties in frontmatter, native syntax, files in attachments/', () => {
    const r = exportObsidian(note)
    expect(r.markdown.startsWith('---\ntags:\n  - cpu\nmodule: Architecture\ntype: Lecture\nweek: "4"\n---\n')).toBe(true)
    expect(r.markdown).toContain('A ==key== idea, see [[Hazards|hazards]] %%todo%%.')
    expect(r.markdown).toContain('> [!warning] Careful')
    expect(r.markdown).toContain('![[abc.png]]')
    expect(r.markdown).toContain('![[pipelines-diagram-1.svg]]')
    expect(r.files.map((f) => f.path)).toEqual(['attachments/pipelines-diagram-1.svg', 'attachments/abc.png'])
    expect(r.files[0].text).toContain('xmlns="http://www.w3.org/2000/svg"')
  })
  it('Notion: title heading, property lines, quotes for callouts, no Obsidian-only syntax', () => {
    const r = exportNotion(note)
    expect(r.markdown.startsWith('# Pipelines\n\nModule: Architecture\nType: Lecture\nWeek: 4\nTags: cpu\n\n')).toBe(true)
    expect(r.markdown).toContain('A **key** idea, see hazards .')
    expect(r.markdown).toContain('> ⚠️ **Careful**\n> stalls')
    expect(r.markdown).toContain('![fig](attachments/abc.png)')
    expect(r.markdown).not.toMatch(/\[\[|==|%%|\[!warning\]/)
  })
})
