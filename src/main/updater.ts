// Self-update for a copy run from its git checkout (`npm run dev` or `npm start`).
// It checks GitHub for new commits on the current branch; when you ask, it
// pulls them (fast-forward only), runs npm install if the packages changed, and
// starts the app again. Installed builds don't use this.
import { app } from 'electron'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '@shared/update'
import { getResolvedPath } from './ai/claudePath'
import { runningJobCount } from './jobs'
import { paths } from './paths'

const IS_WIN = process.platform === 'win32'
const CHECK_EVERY_MS = 30 * 60_000
const FIRST_CHECK_MS = 15_000

// `app` is missing when this is loaded outside Electron (unit tests).
const root = app?.getAppPath?.() ?? process.cwd()
const supported = !!app && !app.isPackaged && process.env.AI_MOCK !== '1' && existsSync(join(root, '.git'))

let status: UpdateStatus = { supported, behind: 0, ahead: 0, dirty: false, branch: null, changes: [], state: 'idle', stage: null, error: null, checkedAt: null }
let notify: (s: UpdateStatus) => void = () => {}

function set(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch }
  notify(status)
  return status
}

function run(cmd: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      // No password prompts: a fetch that needs credentials just fails.
      { cwd: root, timeout, windowsHide: true, shell: IS_WIN && cmd === 'npm', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PATH: getResolvedPath(), GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()))
    )
  })
}
const git = (...args: string[]) => run('git', args)

/**
 * What "this version" means for backups: the app version, plus the commit for a
 * copy run from git, whose updates (git pull) don't change the version number.
 */
export function buildId(version: string): string {
  if (!supported) return version
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, timeout: 5000, windowsHide: true, encoding: 'utf8' }).trim()
    return head ? `${version}+${head}` : version
  } catch {
    return version
  }
}

export function updateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!supported || status.state === 'updating' || status.state === 'restarting') return status
  set({ state: 'checking' })
  try {
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
    const upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => '')
    if (!upstream) return set({ state: 'idle', branch, behind: 0, ahead: 0, changes: [], error: null, checkedAt: new Date().toISOString() })
    await git('fetch', '--quiet', upstream.split('/')[0])
    const [behind, ahead, dirty, log] = await Promise.all([
      git('rev-list', '--count', 'HEAD..@{u}'),
      git('rev-list', '--count', '@{u}..HEAD'),
      git('status', '--porcelain', '--untracked-files=no'),
      git('log', '--format=%s', '-n', '5', 'HEAD..@{u}')
    ])
    return set({
      state: 'idle',
      branch,
      behind: Number(behind) || 0,
      ahead: Number(ahead) || 0,
      dirty: dirty.length > 0,
      changes: log ? log.split('\n') : [],
      error: null,
      checkedAt: new Date().toISOString()
    })
  } catch (e) {
    // Offline or no access: stay quiet, try again later.
    console.warn('[update] check failed:', (e as Error).message)
    return set({ state: 'idle', checkedAt: new Date().toISOString() })
  }
}

export async function applyUpdate(): Promise<UpdateStatus> {
  if (!supported) throw new Error('This copy can’t update itself.')
  if (status.state === 'updating' || status.state === 'restarting') return status
  if (runningJobCount() > 0) throw new Error('Wait for the running jobs to finish first (see the Jobs page), then update.')
  try {
    set({ state: 'updating', stage: 'Downloading the changes…', error: null })
    const before = await git('rev-parse', 'HEAD')
    try {
      await git('pull', '--ff-only')
    } catch (e) {
      const msg = (e as Error).message
      if (/local changes|overwritten|commit your changes|stash/i.test(msg)) throw new Error('Your own edits clash with this update. Commit or stash them, then try again.')
      if (/not possible to fast-forward|diverg/i.test(msg)) throw new Error('This copy has its own commits that aren’t on GitHub, so it can’t update automatically. Merge by hand with git pull.')
      throw new Error(msg)
    }
    const changed = await git('diff', '--name-only', before, 'HEAD')
    if (/^package(-lock)?\.json$/m.test(changed)) {
      set({ stage: 'Installing new packages…' })
      await run('npm', ['install'], 10 * 60_000)
    }
    set({ state: 'restarting', stage: 'Restarting…', behind: 0, changes: [] })
    restart()
    return status
  } catch (e) {
    set({ state: 'error', stage: null, error: (e as Error).message })
    throw e
  }
}

/**
 * Start the app again the way it was started, once this copy has quit. A
 * detached helper waits for this process (and, under `npm run dev`, the
 * electron-vite process that owns the dev server) to exit, then runs the npm
 * script again. Its output goes to logs/restart.log.
 */
function restart(): void {
  const viaDev = !!process.env.ELECTRON_RENDERER_URL
  const script = viaDev ? 'dev' : 'start'
  const wait = viaDev ? [process.pid, process.ppid] : [process.pid]
  mkdirSync(paths.logs, { recursive: true })
  const log = openSync(join(paths.logs, 'restart.log'), 'a')
  const helper = `
    const { spawn } = require('node:child_process')
    const [pids, cwd, script, win] = JSON.parse(process.argv[1])
    const alive = (p) => { try { process.kill(p, 0); return true } catch { return false } }
    const started = Date.now()
    const tick = () => {
      if (pids.some(alive) && Date.now() - started < 30000) return setTimeout(tick, 300)
      const env = { ...process.env }
      // Settings electron-vite handed to this run; the new run sets its own.
      for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'ELECTRON_ENTRY', 'ELECTRON_CLI_ARGS', 'REMOTE_DEBUGGING_PORT', 'NO_SANDBOX']) delete env[k]
      spawn('npm', ['run', script], { cwd, env, detached: true, stdio: 'inherit', shell: win, windowsHide: false }).unref()
      setTimeout(() => process.exit(0), 500)
    }
    tick()
  `
  const child = spawn(process.execPath, ['-e', helper, JSON.stringify([wait, root, script, IS_WIN])], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PATH: getResolvedPath(), ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true
  })
  child.unref()
  setTimeout(() => app.quit(), 400)
}

/** Check soon after launch, then every half hour. Status changes go to `onChange`. */
export function startUpdateChecks(onChange: (s: UpdateStatus) => void): void {
  notify = onChange
  if (!supported) return
  setTimeout(() => void checkForUpdate(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
}
