import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { migrate } from './migrations'

let db: Database.Database | null = null

export function openDb(file: string): Database.Database {
  if (db) db.close()
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not open')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

export const uid = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
