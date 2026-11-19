import type { StudywiseApi } from '../main/ipc'
import type { JobInfo, ClaudeStatus } from '../shared/types'

export type StudywiseEvent =
  | { type: 'ai:delta'; streamId: string; text: string }
  | { type: 'job'; job: JobInfo }
  | { type: 'job:delta'; jobId: string; text: string }
  | { type: 'menu'; action: string }
  | { type: 'open-files'; paths: string[] }
  | { type: 'claude:status'; status: ClaudeStatus }
  | { type: 'fullscreen'; on: boolean }

declare global {
  interface Window {
    studywise: StudywiseApi & {
      on: (cb: (ev: StudywiseEvent) => void) => () => void
      pathForFile: (file: File) => string
    }
  }
}

export {}
