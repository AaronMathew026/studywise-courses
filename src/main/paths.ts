import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// ~/Library/Application Support/Studywise/ (STUDYWISE_DATA_DIR overrides it, for tests)
function build(root: string) {
  return {
    userData: root,
    db: join(root, 'studywise.db'),
    attachments: join(root, 'attachments'),
    cache: join(root, 'cache'),
    logs: join(root, 'logs'),
    windowState: join(root, 'window-state.json')
  }
}

const ROOT = process.env.STUDYWISE_DATA_DIR || join(app.getPath('appData'), 'Studywise')
// Set before anything asks for the single-instance lock (it lives in userData),
// so test runs with their own data dir don't collide with the real app.
app.setPath('userData', ROOT)
export let paths = build(ROOT)

export function initPaths(): void {
  const root = process.env.STUDYWISE_DATA_DIR || join(app.getPath('appData'), 'Studywise')
  app.setPath('userData', root)
  paths = build(root)
  for (const d of [paths.userData, paths.attachments, paths.cache, paths.logs]) mkdirSync(d, { recursive: true })
}
