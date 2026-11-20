import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupOnUpgrade } from '../../src/main/upgradeBackup'

let dir: string
let db: string, backups: string, marker: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-upgrade-'))
  db = join(dir, 'studywise.db')
  backups = join(dir, 'backups')
  marker = join(dir, 'last-version')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('backupOnUpgrade', () => {
  it('does nothing on a fresh install, but remembers the version', () => {
    expect(backupOnUpgrade(db, backups, marker, '1.1.0')).toBeNull()
    expect(existsSync(backups)).toBe(false)
    expect(readFileSync(marker, 'utf8')).toBe('1.1.0')
  })

  it('copies the database (and WAL) when the version changes, once', () => {
    writeFileSync(db, 'main')
    writeFileSync(db + '-wal', 'wal')
    writeFileSync(marker, '1.0.0')
    const out = backupOnUpgrade(db, backups, marker, '1.1.0')!
    expect(out).toContain('before-1.1.0-from-1.0.0-')
    expect(readFileSync(join(out, 'studywise.db'), 'utf8')).toBe('main')
    expect(readFileSync(join(out, 'studywise.db-wal'), 'utf8')).toBe('wal')
    expect(backupOnUpgrade(db, backups, marker, '1.1.0')).toBeNull()
  })

  it('backs up existing data from a version that predates the marker', () => {
    writeFileSync(db, 'old')
    expect(backupOnUpgrade(db, backups, marker, '1.1.0')).toContain('from-unknown')
  })

  it('keeps only the newest five backups', () => {
    writeFileSync(db, 'x')
    mkdirSync(backups)
    for (let i = 0; i < 7; i++) mkdirSync(join(backups, `before-0.${i}-from-0-2020-01-0${i + 1}T00-00-00-000Z`))
    backupOnUpgrade(db, backups, marker, '2.0.0')
    const left = readdirSync(backups).sort()
    expect(left).toHaveLength(5)
    expect(left.some((n) => n.startsWith('before-2.0.0'))).toBe(true)
    expect(left.some((n) => n.includes('2020-01-01'))).toBe(false)
  })
})
