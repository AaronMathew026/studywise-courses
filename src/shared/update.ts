/** Self-update for a copy run from its git checkout (npm run dev / npm start). */
export interface UpdateStatus {
  /** False for installed builds, or a folder that isn't a git checkout: no banner then. */
  supported: boolean
  /** Commits on GitHub that this copy doesn't have yet. */
  behind: number
  /** Local commits that aren't on GitHub. An update would need a merge, so it isn't done automatically. */
  ahead: number
  /** Uncommitted edits to tracked files. Kept by the update unless they clash with it. */
  dirty: boolean
  branch: string | null
  /** Subjects of the new commits, newest first (up to 5). */
  changes: string[]
  state: 'idle' | 'checking' | 'updating' | 'restarting' | 'error'
  /** What an update is doing right now. */
  stage: string | null
  error: string | null
  checkedAt: string | null
}
