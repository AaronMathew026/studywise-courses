import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// ~/Library/Application Support/Studywise Courses/ (STUDYWISE_DATA_DIR overrides it, for tests)
function build(root: string) {
  return {
    userData: root,
    db: join(root, 'studywise.db'),
    attachments: join(root, 'attachments'),
    courses: join(root, 'courses'),
    cache: join(root, 'cache'),
    logs: join(root, 'logs'),
    backups: join(root, 'backups'),
    lastVersion: join(root, 'last-version'),
    windowState: join(root, 'window-state.json')
  }
}

const APP_DIR = 'Studywise Courses'
// `app` is missing when unit tests import this outside Electron; they set STUDYWISE_DATA_DIR.
const ROOT = process.env.STUDYWISE_DATA_DIR || join(app.getPath('appData'), APP_DIR)
// Set before anything asks for the single-instance lock (it lives in userData),
// so test runs with their own data dir don't collide with the real app.
app?.setPath('userData', ROOT)
export let paths = build(ROOT)

export function initPaths(): void {
  const root = process.env.STUDYWISE_DATA_DIR || join(app.getPath('appData'), APP_DIR)
  app.setPath('userData', root)
  paths = build(root)
  for (const d of [paths.userData, paths.attachments, paths.courses, paths.cache, paths.logs]) mkdirSync(d, { recursive: true })
}
