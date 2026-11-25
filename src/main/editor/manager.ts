/**
 * One editor at a time, bound to the active session's workspace. Tools can
 * operate on any session's workspace; live-buffer features only apply to the
 * session currently shown in the editor.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { Diagnostic, EditorMode, EditorState, EditorStatus, FileEntry, Session } from '@shared/types'
import { send } from '../bus'
import { getSettings } from '../store/settings'
import { allSessions, getSession } from '../store/sessions'
import { which } from '../runner'
import { NvimEditor } from './nvim'
import { installNvimConfig, nvimEnv, syncLazyExtras } from './nvim-config'

const IGNORED = new Set(['.git', 'node_modules', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'dist', 'build', 'out', '.gradle', '.idea', '.vs', '_build', 'deps', '.zig-cache', 'zig-out', '.dart_tool'])

export interface EditorHooks {
  onSubmit: (sessionId: string) => void
  onRun: (sessionId: string, file?: string) => void
  onAsk: (sessionId: string, payload: { file: string; line1: number; line2: number; text: string; ft?: string }) => void
}

class EditorManager {
  private nvim: NvimEditor | null = null
  sessionId: string | null = null
  mode: EditorMode = 'neovim'
  private builtinFile: string | undefined
  private lastFile = new Map<string, string>()
  private hooks: EditorHooks | null = null
  private lastError: string | undefined

  setHooks(h: EditorHooks) {
    this.hooks = h
  }

  nvimPath(): string | null {
    const s = getSettings()
    if (s.editor.nvimPath && existsSync(s.editor.nvimPath)) return s.editor.nvimPath
    return which('nvim')
  }

  status(): EditorStatus {
    const s = this.sessionId ? getSession(this.sessionId) : undefined
    return { sessionId: this.sessionId, mode: this.mode, running: this.mode === 'builtin' ? !!this.sessionId : !!this.nvim?.alive, error: this.lastError, workspace: s?.workspace }
  }

  async start(sessionId: string, cols: number, rows: number, force?: EditorMode): Promise<EditorStatus> {
    const session = getSession(sessionId)
    if (!session) throw new Error('Session not found')
    await this.stop()
    this.sessionId = sessionId
    this.lastError = undefined
    const settings = getSettings()
    let mode: EditorMode = force ?? settings.editor.mode
    const nvimPath = mode === 'neovim' ? this.nvimPath() : null
    if (mode === 'neovim' && !nvimPath) {
      this.lastError = 'Neovim was not found. Install it from the Doctor (Settings → Doctor) or set its path. Using the built-in Vim editor for now.'
      mode = 'builtin'
    }
    this.mode = mode
    mkdirSync(session.workspace, { recursive: true })
    const file = this.initialFile(session)
    if (mode === 'neovim' && nvimPath) {
      let env: Record<string, string> = {}
      if (settings.editor.config === 'lazyvim') {
        installNvimConfig()
        syncLazyExtras([...new Set(allSessions().map((s) => s.language))])
        env = nvimEnv()
      }
      this.nvim = new NvimEditor({
        nvimPath,
        workspace: session.workspace,
        file: file ? relative(session.workspace, file) : undefined,
        cols,
        rows,
        env,
        onData: (d) => send('pty:data', d),
        onExit: (code) => {
          send('pty:exit', { code, sessionId })
          this.nvim = null
        },
        onNotify: (ev, data) => this.onNvimNotify(sessionId, ev, data)
      })
      this.nvim.whenReady(60000).then((ok) => {
        if (!ok && this.nvim) send('editor:status', { ...this.status(), error: 'Neovim started but the tutor bridge did not connect yet (first start installs plugins — this can take a minute).' })
      })
    } else {
      this.builtinFile = file
      if (file) send('editor:command', { type: 'open', path: file })
    }
    const st = this.status()
    send('editor:status', st)
    return st
  }

  private onNvimNotify(sessionId: string, ev: string, data: any) {
    if (ev === 'submit') this.hooks?.onSubmit(sessionId)
    else if (ev === 'run') this.hooks?.onRun(sessionId, data?.file)
    else if (ev === 'ask') this.hooks?.onAsk(sessionId, data)
    else if (ev === 'focus' && data?.file) {
      this.lastFile.set(sessionId, data.file)
      send('editor:focus', { sessionId, file: data.file })
    } else if (ev === 'saved') send('editor:saved', { sessionId, file: data?.file })
  }

  private initialFile(session: Session): string | undefined {
    const last = this.lastFile.get(session.id)
    if (last && existsSync(last)) return last
    const files = this.listFiles(session).filter((f) => !f.dir)
    if (files.length === 0) return undefined
    let best = files[0]
    let bestTime = 0
    for (const f of files) {
      try {
        const t = statSync(f.path).mtimeMs
        if (t > bestTime) {
          best = f
          bestTime = t
        }
      } catch {
        /* ignore */
      }
    }
    return best.path
  }

  async stop() {
    const n = this.nvim
    this.nvim = null
    if (n) await n.dispose()
    this.sessionId = null
    this.builtinFile = undefined
  }

  ptyWrite(data: string) {
    this.nvim?.write(data)
  }

  ptyResize(cols: number, rows: number) {
    this.nvim?.resize(cols, rows)
  }

  setBuiltinFile(sessionId: string, file: string | undefined) {
    if (sessionId === this.sessionId) this.builtinFile = file
    if (file) this.lastFile.set(sessionId, file)
  }

  isActive(session: Session) {
    return this.sessionId === session.id
  }

  // ─── workspace operations (used by agent tools and IPC) ──────────────

  resolvePath(session: Session, p: string): string {
    const ws = resolve(session.workspace)
    const abs = isAbsolute(p) ? normalize(p) : resolve(ws, p.replace(/^[/\\]+/, ''))
    const rel = relative(ws, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path "${p}" is outside the session workspace.`)
    return abs
  }

  rel(session: Session, abs: string): string {
    return relative(session.workspace, abs).split(sep).join('/')
  }

  listFiles(session: Session, max = 400): FileEntry[] {
    const out: FileEntry[] = []
    const walk = (dir: string, depth: number) => {
      if (out.length >= max || depth > 8) return
      let entries: string[] = []
      try {
        entries = readdirSync(dir).sort()
      } catch {
        return
      }
      for (const name of entries) {
        if (out.length >= max) return
        if (IGNORED.has(name) || name.startsWith('.')) continue
        const p = join(dir, name)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        out.push({ path: p, rel: relative(session.workspace, p).split(sep).join('/'), size: st.size, dir: st.isDirectory() })
        if (st.isDirectory()) walk(p, depth + 1)
      }
    }
    walk(session.workspace, 0)
    return out
  }

  async readFile(session: Session, p: string): Promise<{ text: string; live: boolean } | null> {
    const abs = this.resolvePath(session, p)
    if (this.isActive(session) && this.nvim) {
      const live = await this.nvim.readBuffer(abs)
      if (live !== null) return { text: live, live: true }
    }
    if (!existsSync(abs) || statSync(abs).isDirectory()) return null
    return { text: readFileSync(abs, 'utf8'), live: false }
  }

  async writeFile(session: Session, p: string, content: string, open = true): Promise<string> {
    const abs = this.resolvePath(session, p)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    if (this.isActive(session)) {
      if (this.nvim) {
        const mirrored = await this.nvim.setBuffer(abs, content)
        if (open || !mirrored) {
          if (open) await this.nvim.open(abs)
        }
      } else if (this.mode === 'builtin') {
        send('editor:command', { type: 'reload', path: abs })
        if (open) send('editor:command', { type: 'open', path: abs })
      }
    }
    send('editor:files', { sessionId: session.id })
    return abs
  }

  async openFile(session: Session, p: string, line?: number): Promise<string> {
    const abs = this.resolvePath(session, p)
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, '', 'utf8')
    }
    this.lastFile.set(session.id, abs)
    if (this.isActive(session)) {
      if (this.nvim) await this.nvim.open(abs, line)
      else send('editor:command', { type: 'open', path: abs })
    }
    return abs
  }

  async diagnostics(session: Session, p?: string): Promise<(Diagnostic & { file: string })[]> {
    if (!this.isActive(session) || !this.nvim) return []
    const abs = p ? this.resolvePath(session, p) : undefined
    return this.nvim.diagnostics(abs)
  }

  async state(session: Session): Promise<EditorState | null> {
    if (!this.isActive(session)) return { file: this.lastFile.get(session.id) }
    if (this.nvim) return await this.nvim.state()
    return { file: this.builtinFile }
  }

  async saveAll() {
    await this.nvim?.saveAll()
  }

  hasLiveDiagnostics(session: Session) {
    return this.isActive(session) && !!this.nvim
  }
}

export const editor = new EditorManager()
