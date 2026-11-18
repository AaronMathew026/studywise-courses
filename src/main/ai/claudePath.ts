import { execFile } from 'node:child_process'
import { existsSync, accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import type { ClaudeStatus } from '@shared/types'

// Apps launched from Finder/Dock get a minimal PATH (/usr/bin:/bin:...), so we
// ask the user's login shell for its PATH once and cache it.

let cachedPath: string | null = null
let status: ClaudeStatus = { path: null, version: null, loggedIn: false, authMethod: null, error: null, overridePath: null, mock: false }
let overridePath: string | null = null

const MARK = '__STUDYWISE_PATH__'

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: opts.env, timeout: opts.timeout ?? 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as unknown as { code: number }).code) : 1) : 0
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
  })
}

export async function resolveLoginShellPath(force = false): Promise<string> {
  if (cachedPath && !force) return cachedPath
  const shell = process.env.SHELL || '/bin/zsh'
  const script = `printf '${MARK}%s${MARK}' "$PATH"`
  let found = ''
  for (const flags of [['-ilc'], ['-lc']]) {
    const r = await run(shell, [...flags, script], { timeout: 8000, env: { ...process.env, HOME: homedir() } })
    const m = r.stdout.match(new RegExp(`${MARK}(.*?)${MARK}`))
    if (m && m[1]) {
      found = m[1]
      break
    }
  }
  const extras = [
    join(homedir(), '.claude', 'local'),
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.npm-global', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
  const parts = [...found.split(delimiter), ...(process.env.PATH ?? '').split(delimiter), ...extras].filter(Boolean)
  cachedPath = [...new Set(parts)].join(delimiter)
  return cachedPath
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function npmGlobalBin(pathEnv: string): Promise<string | null> {
  const r = await run('npm', ['prefix', '-g'], { env: { ...process.env, PATH: pathEnv, HOME: homedir() }, timeout: 8000 }).catch(() => null)
  const prefix = r?.stdout.trim()
  return prefix ? join(prefix, 'bin') : null
}

export async function findClaude(pathEnv: string): Promise<string | null> {
  for (const dir of pathEnv.split(delimiter)) {
    const p = join(dir, 'claude')
    if (dir && existsSync(p) && isExecutable(p)) return p
  }
  const candidates = [
    join(homedir(), '.claude', 'local', 'claude'),
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]
  const npmBin = await npmGlobalBin(pathEnv)
  if (npmBin) candidates.push(join(npmBin, 'claude'))
  for (const c of candidates) if (existsSync(c) && isExecutable(c)) return c
  return null
}

/** Environment for the claude child: the login PATH + HOME, and no API keys,
 * so it always uses the user's own login and never bills an API account. */
export function childEnv(pathEnv: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: pathEnv, HOME: homedir() }
  for (const k of Object.keys(env)) {
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_API_KEY|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|AWS_BEARER_TOKEN_BEDROCK|OPENAI_API_KEY)$/.test(k)) delete env[k]
    if (/API_KEY$/.test(k) && /ANTHROPIC|CLAUDE/.test(k)) delete env[k]
  }
  // Don't let a parent Claude Code session (e.g. running `npm run dev` from one) leak in.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  delete env.CLAUDE_CODE_SSE_PORT
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  return env
}

export function setOverridePath(p: string | null): void {
  overridePath = p
}

export async function detectClaude(opts: { force?: boolean } = {}): Promise<ClaudeStatus> {
  const pathEnv = await resolveLoginShellPath(opts.force)
  const mock = process.env.AI_MOCK === '1'
  let path = overridePath && existsSync(overridePath) ? overridePath : await findClaude(pathEnv)
  if (!path) {
    status = {
      path: null,
      version: null,
      loggedIn: false,
      authMethod: null,
      error: 'Claude Code is not installed (no `claude` found on your login PATH or in the usual places).',
      overridePath,
      mock
    }
    return status
  }
  const env = childEnv(pathEnv)
  const v = await run(path, ['--version'], { env, timeout: 15000 })
  const version = v.stdout.trim().split('\n')[0] || null
  if (!version) {
    status = { path, version: null, loggedIn: false, authMethod: null, error: `Found ${path} but it did not run: ${v.stderr.trim().slice(0, 300)}`, overridePath, mock }
    return status
  }
  const a = await run(path, ['auth', 'status'], { env, timeout: 15000 })
  let loggedIn = false
  let authMethod: string | null = null
  try {
    const j = JSON.parse(a.stdout) as { loggedIn?: boolean; authMethod?: string }
    loggedIn = !!j.loggedIn
    authMethod = j.authMethod ?? null
  } catch {
    loggedIn = /logged in/i.test(a.stdout) && !/not logged in/i.test(a.stdout)
  }
  status = {
    path,
    version,
    loggedIn,
    authMethod,
    error: loggedIn ? null : 'Claude Code is installed but not logged in. Open Terminal and run `claude` (or `claude auth login`) to sign in.',
    overridePath,
    mock
  }
  return status
}

export function getClaudeStatus(): ClaudeStatus {
  return status
}

export function getResolvedPath(): string {
  return cachedPath ?? process.env.PATH ?? ''
}
