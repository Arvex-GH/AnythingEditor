/**
 * Runs the learner's code for ~30 languages. Compile+run plans are resolved
 * against the tools that actually exist on PATH.
 */
import spawn from 'cross-spawn'
import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, extname, basename, delimiter, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunResult } from '@shared/types'
import { languageForFile } from '@shared/languages'

const isWin = process.platform === 'win32'
const whichCache = new Map<string, string | null>()

/** Locate an executable on PATH (honours PATHEXT on Windows). */
export function which(cmd: string): string | null {
  if (whichCache.has(cmd)) return whichCache.get(cmd)!
  let found: string | null = null
  if (cmd.includes('/') || cmd.includes('\\')) {
    found = existsSync(cmd) ? cmd : null
  } else {
    const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : ['']
    const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)
    if (isWin) dirs.push(...extraWindowsDirs())
    outer: for (const d of dirs) {
      for (const e of isWin ? ['', ...exts] : ['']) {
        const p = join(d, cmd + e)
        try {
          if (existsSync(p) && statSync(p).isFile()) {
            if (isWin && e === '' && !extname(p)) continue
            found = p
            break outer
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  whichCache.set(cmd, found)
  return found
}

export function clearWhichCache(): void {
  whichCache.clear()
}

function extraWindowsDirs(): string[] {
  const home = process.env.USERPROFILE ?? ''
  const local = process.env.LOCALAPPDATA ?? ''
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  return [
    join(home, '.cargo', 'bin'),
    join(pf, 'Git', 'bin'),
    join(pf, 'dotnet'),
    join(pf, 'Go', 'bin'),
    join(pf, 'Neovim', 'bin'),
    join(local, 'Microsoft', 'WinGet', 'Links'),
    join(local, 'Programs', 'Python', 'Python313'),
    join(local, 'Programs', 'Python', 'Python312'),
    join(home, '.ghcup', 'bin'),
    join(home, 'go', 'bin')
  ]
}

export function firstAvailable(cmds: string[]): string | null {
  for (const c of cmds) if (which(c)) return c
  return null
}

interface Step {
  cmd: string
  args: string[]
  cwd: string
}

function exeName(name: string): string {
  return isWin ? `${name}.exe` : name
}

function findUp(start: string, stop: string, test: (dir: string) => boolean): string | null {
  let d = start
  for (let i = 0; i < 20; i++) {
    if (test(d)) return d
    if (d === stop || dirname(d) === d) break
    d = dirname(d)
  }
  return null
}

/** Build the command plan for a file. Returns null + reason if impossible. */
export function planRun(file: string, workspace: string): { steps: Step[] } | { error: string } {
  const lang = languageForFile(file)
  const ext = extname(file).toLowerCase()
  const dir = dirname(file)
  const out = join(tmpdir(), 'anythingeditor-build')
  mkdirSync(out, { recursive: true })
  const outBin = join(out, exeName(basename(file, ext) + '_' + Math.random().toString(36).slice(2, 7)))
  const need = (cmds: string[], what: string): string => {
    const c = firstAvailable(cmds)
    if (!c) throw new Error(`${what} was not found on PATH (looked for: ${cmds.join(', ')}). Install it from the Doctor panel.`)
    return c
  }
  try {
    switch (lang?.id) {
      case 'python': {
        const py = need(isWin ? ['python', 'py', 'python3'] : ['python3', 'python'], 'Python')
        return { steps: [{ cmd: py, args: py === 'py' ? ['-3', '-u', file] : ['-u', file], cwd: dir }] }
      }
      case 'javascript':
        return { steps: [{ cmd: need(['node', 'bun', 'deno'], 'Node.js'), args: [file], cwd: dir }] }
      case 'typescript': {
        const rt = need(['node', 'bun', 'deno'], 'Node.js')
        return { steps: [{ cmd: rt, args: rt === 'deno' ? ['run', '-A', file] : [file], cwd: dir }] }
      }
      case 'rust': {
        const cargoDir = findUp(dir, workspace, (d) => existsSync(join(d, 'Cargo.toml')))
        if (cargoDir) return { steps: [{ cmd: need(['cargo'], 'cargo'), args: ['run', '--quiet'], cwd: cargoDir }] }
        return { steps: [{ cmd: need(['rustc'], 'rustc'), args: ['--edition', '2021', file, '-o', outBin], cwd: dir }, { cmd: outBin, args: [], cwd: dir }] }
      }
      case 'go': {
        const modDir = findUp(dir, workspace, (d) => existsSync(join(d, 'go.mod')))
        const go = need(['go'], 'Go')
        if (modDir) return { steps: [{ cmd: go, args: ['run', '.'], cwd: modDir }] }
        return { steps: [{ cmd: go, args: ['run', file], cwd: dir }] }
      }
      case 'csharp': {
        const dotnet = need(['dotnet'], '.NET SDK')
        const projDir = findUp(dir, workspace, (d) => {
          try {
            return readdirSync(d).some((f) => f.endsWith('.csproj'))
          } catch {
            return false
          }
        })
        if (projDir) return { steps: [{ cmd: dotnet, args: ['run'], cwd: projDir }] }
        // .NET 10+ file-based apps
        return { steps: [{ cmd: dotnet, args: ['run', file], cwd: dir }] }
      }
      case 'c':
      case 'cpp': {
        const isCpp = lang.id === 'cpp'
        const cc = need(isCpp ? ['g++', 'clang++', 'zig', 'cl'] : ['gcc', 'clang', 'zig', 'cl'], 'A C/C++ compiler')
        let compile: Step
        if (cc === 'zig') compile = { cmd: 'zig', args: [isCpp ? 'c++' : 'cc', file, '-o', outBin], cwd: dir }
        else if (cc === 'cl') compile = { cmd: 'cl', args: ['/nologo', '/EHsc', file, `/Fe:${outBin}`], cwd: out }
        else compile = { cmd: cc, args: [file, '-o', outBin, ...(isCpp ? ['-std=c++20'] : []), '-Wall'], cwd: dir }
        return { steps: [compile, { cmd: outBin, args: [], cwd: dir }] }
      }
      case 'java':
        return { steps: [{ cmd: need(['java'], 'Java (JDK 11+)'), args: [file], cwd: dir }] }
      case 'kotlin': {
        if (ext === '.kts') return { steps: [{ cmd: need(['kotlin', 'kotlinc'], 'Kotlin'), args: ['-script', file], cwd: dir }] }
        const jar = outBin.replace(/(\.exe)?$/, '.jar')
        return { steps: [{ cmd: need(['kotlinc'], 'kotlinc'), args: [file, '-include-runtime', '-d', jar], cwd: dir }, { cmd: need(['java'], 'Java'), args: ['-jar', jar], cwd: dir }] }
      }
      case 'lua': {
        const l = need(['lua', 'luajit', 'nvim'], 'Lua')
        return { steps: [{ cmd: l, args: l === 'nvim' ? ['-l', file] : [file], cwd: dir }] }
      }
      case 'ruby':
        return { steps: [{ cmd: need(['ruby'], 'Ruby'), args: [file], cwd: dir }] }
      case 'php':
        return { steps: [{ cmd: need(['php'], 'PHP'), args: [file], cwd: dir }] }
      case 'swift':
        return { steps: [{ cmd: need(['swift'], 'Swift'), args: [file], cwd: dir }] }
      case 'haskell':
        return { steps: [{ cmd: need(['runghc', 'runhaskell'], 'GHC'), args: [file], cwd: dir }] }
      case 'elixir':
        return { steps: [{ cmd: need(['elixir'], 'Elixir'), args: [file], cwd: dir }] }
      case 'zig':
        return { steps: [{ cmd: need(['zig'], 'Zig'), args: ['run', file], cwd: dir }] }
      case 'dart':
        return { steps: [{ cmd: need(['dart'], 'Dart'), args: ['run', file], cwd: dir }] }
      case 'scala': {
        const s = need(['scala-cli', 'scala'], 'Scala')
        return { steps: [{ cmd: s, args: ['run', file], cwd: dir }] }
      }
      case 'ocaml':
        return { steps: [{ cmd: need(['ocaml'], 'OCaml'), args: [file], cwd: dir }] }
      case 'r':
        return { steps: [{ cmd: need(['Rscript'], 'R'), args: [file], cwd: dir }] }
      case 'julia':
        return { steps: [{ cmd: need(['julia'], 'Julia'), args: [file], cwd: dir }] }
      case 'perl':
        return { steps: [{ cmd: need(['perl'], 'Perl'), args: [file], cwd: dir }] }
      case 'bash':
        return { steps: [{ cmd: need(['bash'], 'bash'), args: [file], cwd: dir }] }
      case 'powershell': {
        const ps = need(['pwsh', 'powershell'], 'PowerShell')
        return { steps: [{ cmd: ps, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], cwd: dir }] }
      }
      case 'sql':
        return { steps: [{ cmd: need(['sqlite3'], 'sqlite3'), args: [':memory:', `.read ${file.replace(/\\/g, '/')}`], cwd: dir }] }
      case 'clojure':
        return { steps: [{ cmd: need(['clojure', 'clj'], 'Clojure'), args: ['-M', file], cwd: dir }] }
      case 'erlang':
        return { steps: [{ cmd: need(['escript'], 'Erlang'), args: [file], cwd: dir }] }
      case 'gleam': {
        const gDir = findUp(dir, workspace, (d) => existsSync(join(d, 'gleam.toml')))
        if (!gDir) return { error: 'Gleam needs a project (gleam.toml). Ask the tutor to scaffold one.' }
        return { steps: [{ cmd: need(['gleam'], 'Gleam'), args: ['run'], cwd: gDir }] }
      }
      case 'html':
        return { error: 'HTML/CSS files are opened in your browser — use the "Open" button.' }
      default:
        return { error: `Don't know how to run "${relative(workspace, file) || file}". Ask the tutor how to run it.` }
    }
  } catch (err: any) {
    return { error: err.message }
  }
}

export interface RunHandle {
  promise: Promise<RunResult>
  kill: () => void
}

/** Execute a plan, streaming output. Each step must succeed for the next to run. */
export function runFile(
  file: string,
  workspace: string,
  opts: { stdin?: string; timeoutMs?: number; onData?: (stream: 'stdout' | 'stderr', data: string) => void } = {}
): RunHandle {
  const plan = planRun(file, workspace)
  let killed = false
  let current: ReturnType<typeof spawn> | null = null
  const kill = () => {
    killed = true
    try {
      current?.kill()
    } catch {
      /* ignore */
    }
  }
  const promise = (async (): Promise<RunResult> => {
    const started = Date.now()
    if ('error' in plan) return { ok: false, exitCode: null, stdout: '', stderr: plan.error, command: '', durationMs: 0, error: plan.error }
    let stdout = ''
    let stderr = ''
    const commands: string[] = []
    const MAX = 200_000
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      const isLast = i === plan.steps.length - 1
      const cmdline = [step.cmd, ...step.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
      commands.push(cmdline)
      opts.onData?.('stderr', `\x1b[2m$ ${cmdline}\x1b[0m\n`)
      const res = await new Promise<{ code: number | null; timedOut: boolean; error?: string }>((resolve) => {
        let timedOut = false
        const child = spawn(step.cmd, step.args, {
          cwd: step.cwd,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
          windowsHide: true
        })
        current = child
        const timer = setTimeout(() => {
          timedOut = true
          try {
            child.kill()
          } catch {
            /* ignore */
          }
        }, opts.timeoutMs ?? 60_000)
        child.stdout?.on('data', (d: Buffer) => {
          const s = d.toString('utf8')
          if (stdout.length < MAX) stdout += s
          opts.onData?.('stdout', s)
        })
        child.stderr?.on('data', (d: Buffer) => {
          const s = d.toString('utf8')
          if (stderr.length < MAX) stderr += s
          opts.onData?.('stderr', s)
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          resolve({ code: null, timedOut, error: err.message })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code, timedOut })
        })
        if (isLast && opts.stdin) child.stdin?.write(opts.stdin)
        child.stdin?.end()
      })
      if (res.error || res.timedOut || res.code !== 0 || killed) {
        const msg = res.error ?? (res.timedOut ? `Timed out after ${(opts.timeoutMs ?? 60000) / 1000}s` : killed ? 'Stopped' : undefined)
        if (msg) {
          stderr += `\n${msg}`
          opts.onData?.('stderr', `\n${msg}\n`)
        }
        return { ok: false, exitCode: res.code, stdout, stderr, command: commands.join(' && '), durationMs: Date.now() - started, timedOut: res.timedOut, error: msg }
      }
    }
    return { ok: true, exitCode: 0, stdout, stderr, command: commands.join(' && '), durationMs: Date.now() - started }
  })()
  return { promise, kill }
}
