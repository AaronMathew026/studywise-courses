import type { OutputMode } from '@shared/types'
import type { TaskId } from '@shared/tasks'

export interface SeedPreset {
  builtin_key: string
  task: TaskId
  name: string
  output_mode: OutputMode
  system: string
  user_template: string
  is_default: boolean
}
