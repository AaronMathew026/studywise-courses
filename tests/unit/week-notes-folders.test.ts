import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { folderTree, withSubfolders, folderPath, groupByFolderTree } from '../../src/renderer/src/lib/collapsed'

let dir: string
let svc: typeof import('../../src/main/services/course')
let repo: typeof import('../../src/main/db/repo')
let closeDb: () => void

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sw-weeknotes-'))
  process.env.STUDYWISE_DATA_DIR = dir
  const db = await import('../../src/main/db')
  closeDb = db.closeDb
  db.openDb(join(dir, 't.db'))
  const { seedPresets } = await import('../../src/main/ai/presets')
  seedPresets()
  repo = await import('../../src/main/db/repo')
  svc = await import('../../src/main/services/course')
})
afterAll(() => {
  closeDb?.()
  rmSync(dir, { recursive: true, force: true })
})

const ctx = () => ({ signal: new AbortController().signal, progress: () => {}, delta: () => {}, meta: () => {} })

describe('course weeks (mock AI)', () => {
  it('files topic notes under the week, counts the week’s cards, and keeps folders in step', async () => {
    expect(process.env.AI_MOCK).toBe('1')
    const course = svc.createCourse({ name: 'Quantum 101', level: 'first-year physics' })
    const w1 = svc.addWeek(course.id)
    await svc.addFiles(w1.id, [resolve('tests/fixtures/photoelectric-lecture.pdf')])
    await svc.planWeek(w1.id, ctx())
    const [t1] = svc.listTopics(course.id)
    await svc.writeTopic(t1.id, ctx())

    // The note sits in Quantum 101 › Week 1.
    const noteId = svc.getTopic(t1.id).note_id!
    const folders = repo.listFolders('note')
    const weekFolder = folders.find((f) => f.id === repo.getNote(noteId).folder_id)!
    expect(weekFolder.name).toBe('Week 1')
    expect(folders.find((f) => f.id === weekFolder.parent_id)?.name).toBe('Quantum 101')

    // Every card in the week's deck counts, not just recall cards.
    const week = svc.getCourse(course.id).weeks[0]
    const recall = week.topics[0].card_count
    expect(recall).toBeGreaterThan(0)
    repo.createCards([{ deck_id: week.deck_id!, front: 'Imported', back: 'card' }])
    expect(svc.getCourse(course.id).weeks[0].card_count).toBe(recall + 1)

    // Renaming the week renames its notes folder.
    svc.renameWeek(w1.id, 'Week 1: Photons')
    expect(repo.listFolders('note').find((f) => f.id === weekFolder.id)?.name).toBe('Week 1: Photons')

    // Notes left loose in the course folder are filed by week at startup; ones you moved elsewhere stay put.
    const courseFolder = weekFolder.parent_id!
    repo.updateNote(noteId, { folder_id: courseFolder })
    svc.organizeCourseNotes()
    expect(repo.getNote(noteId).folder_id).toBe(weekFolder.id)
    const mine = repo.createFolder('Mine', 'note')
    repo.updateNote(noteId, { folder_id: mine.id })
    svc.organizeCourseNotes()
    expect(repo.getNote(noteId).folder_id).toBe(mine.id)

    // Files can be found to open them.
    const file = svc.listFiles(course.id)[0]
    expect(svc.courseFilePath(file.id)).toBe(file.path)
    expect(() => svc.courseFilePath('nope')).toThrow(/no longer/)
  })
})

describe('nested folders', () => {
  const f = (id: string, name: string, parent_id: string | null = null) => ({ id, name, parent_id })
  const folders = [f('b', 'Physics'), f('w10', 'Week 10', 'b'), f('w2', 'Week 2', 'b'), f('a', 'Algebra'), f('x', 'Lost', 'gone'), f('d', 'Deep', 'w2')]

  it('orders depth-first, numbers naturally, and treats orphans as top level', () => {
    expect(folderTree(folders).map(({ folder, depth }) => `${depth}:${folder.name}`)).toEqual(['0:Algebra', '0:Lost', '0:Physics', '1:Week 2', '2:Deep', '1:Week 10'])
    expect([...withSubfolders(folders, 'b')].sort()).toEqual(['b', 'd', 'w10', 'w2'])
    expect(folderPath(folders, 'd')).toBe('Physics › Week 2 › Deep')
  })

  it('groups items under nested folders, skipping branches with nothing in them', () => {
    const items = [
      { id: 1, folder_id: 'd' },
      { id: 2, folder_id: 'w2' },
      { id: 3, folder_id: null },
      { id: 4, folder_id: 'missing' }
    ]
    const groups = groupByFolderTree(items, folders)
    expect(groups.map((g) => [g.folder?.name ?? 'loose', g.depth, g.items.length, g.total, g.ancestors])).toEqual([
      ['Physics', 0, 0, 2, []],
      ['Week 2', 1, 1, 2, ['b']],
      ['Deep', 2, 1, 1, ['b', 'w2']],
      ['loose', 0, 2, 2, []]
    ])
  })
})
