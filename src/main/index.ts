import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, rmSync, unlinkSync, watchFile, writeFileSync } from 'node:fs'
import type { EditorMode, Provider, SessionMode, Settings } from '@shared/types'
import { getDataDir, dataPath } from './paths'
import { emitAgent, send } from './bus'
import { getSettings, mergeFromRenderer, publicSettings, resolveProviderFromRenderer } from './store/settings'
import { createSession, deleteSession, getSession, listSessions, saveSession } from './store/sessions'
import { deleteNode, forgetSession, getGraph } from './store/graph'
import { listModels, streamChat } from './agent/llm'
import { answerInteraction, isBusy, runTurn, sendUserMessage, stopTurn, submitExercise } from './agent/loop'
import { flushExtraction } from './agent/extraction'
import { editor } from './editor/manager'
import { nvimRoots } from './editor/nvim-config'
import { runForUser, stopRun } from './run-service'
import { install, languageToolchainItems, refreshPath, runDoctor } from './doctor'
import { detectLanguage, findLanguage } from '@shared/languages'

let win: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#16161e',
    title: 'AnythingEditor',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file:')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win?.webContents.toggleDevTools()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  if (process.env.ANYTHING_DEBUG === '1') setupDebugHarness(win)
}

/**
 * Opt-in remote test harness (ANYTHING_DEBUG=1): executes JS from
 * <data>/debug-cmd.js in the renderer and writes the result + a screenshot.
 * Never active in normal use.
 */
function setupDebugHarness(w: BrowserWindow) {
  const cmdFile = dataPath('debug-cmd.js')
  const outFile = dataPath('debug-out.json')
  const shot = dataPath('debug-shot.jpg')
  const tick = async () => {
    if (!existsSync(cmdFile)) return
    const code = readFileSync(cmdFile, 'utf8')
    unlinkSync(cmdFile)
    let result: unknown
    try {
      result = await w.webContents.executeJavaScript(code, true)
    } catch (err: any) {
      result = { error: String(err?.message ?? err) }
    }
    try {
      const img = await w.webContents.capturePage()
      writeFileSync(shot, img.resize({ width: 1280 }).toJPEG(70))
    } catch {
      /* ignore */
    }
    writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), result }, null, 2))
  }
  setInterval(() => tick().catch(() => {}), 700)
  watchFile(cmdFile, { interval: 500 }, () => tick().catch(() => {}))
}

function registerIpc() {
  const handle = (ch: string, fn: (...args: any[]) => any) =>
    ipcMain.handle(ch, async (_e, ...args) => {
      try {
        return { ok: true, value: await fn(...args) }
      } catch (err: any) {
        console.error(`[ipc ${ch}]`, err)
        return { ok: false, error: String(err?.message ?? err) }
      }
    })

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: getDataDir(), nvimConfig: nvimRoots().appConfig }))

  handle('settings:get', () => publicSettings())
  handle('settings:save', (s: Settings) => {
    mergeFromRenderer(s)
    return publicSettings()
  })
  handle('provider:test', async (p: Provider) => {
    const provider = resolveProviderFromRenderer(p)
    const started = Date.now()
    const res = await streamChat({ provider, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], maxTokens: 20 })
    return { reply: res.content.trim().slice(0, 100) || '(empty reply)', ms: Date.now() - started }
  })
  handle('provider:models', (p: Provider) => listModels(resolveProviderFromRenderer(p)))

  handle('sessions:list', () => listSessions().map((s) => ({ ...s, busy: isBusy(s.id) })))
  handle('sessions:get', (id: string) => getSession(id) ?? null)
  handle('sessions:create', (opts: { language?: string; mode: SessionMode; text: string; workspace?: string }) => {
    const lang = findLanguage(opts.language) ?? detectLanguage(opts.text)
    const language = lang?.id ?? (opts.language || 'general').toLowerCase()
    const s = createSession({ language, mode: opts.mode, workspace: opts.workspace })
    const text = opts.text.trim() || (opts.mode === 'practice' ? `Let's practice ${lang?.name ?? language}.` : `I want to learn ${lang?.name ?? language}.`)
    sendUserMessage(s.id, text).catch((err) => emitAgent({ type: 'notice', level: 'error', message: String(err?.message ?? err) }))
    return getSession(s.id)
  })
  handle('sessions:delete', async (id: string, deleteWs: boolean) => {
    stopTurn(id)
    if (editor.sessionId === id) await editor.stop()
    deleteSession(id, deleteWs)
    forgetSession(id)
    emitAgent({ type: 'sessions', sessions: listSessions() })
    return true
  })
  handle('sessions:update', (id: string, patch: { title?: string; providerId?: string; model?: string; language?: string }) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    if (patch.title !== undefined) s.title = patch.title.slice(0, 80)
    if (patch.providerId !== undefined) s.providerId = patch.providerId || undefined
    if (patch.model !== undefined) s.model = patch.model || undefined
    if (patch.language) s.language = patch.language
    saveSession(s)
    emitAgent({ type: 'session', session: s })
    emitAgent({ type: 'sessions', sessions: listSessions() })
    return s
  })
  handle('sessions:leave', (id: string) => {
    flushExtraction(id)
    return true
  })

  const bg = (p: Promise<unknown>) => p.catch((err) => emitAgent({ type: 'notice', level: 'error', message: String(err?.message ?? err) }))
  handle('chat:send', (id: string, text: string, meta?: Record<string, unknown>) => {
    if (isBusy(id)) throw new Error('The tutor is still working — wait or press Stop.')
    bg(sendUserMessage(id, text, meta))
    return true
  })
  handle('chat:answer', (id: string, toolCallId: string, answer: unknown) => {
    bg(answerInteraction(id, toolCallId, answer))
    return true
  })
  handle('chat:submit', (id: string, note?: string) => {
    bg(submitExercise(id, note))
    return true
  })
  handle('chat:stop', (id: string) => stopTurn(id))
  handle('chat:retry', (id: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    while (s.messages.length && s.messages[s.messages.length - 1].error) s.messages.pop()
    saveSession(s)
    bg(runTurn(id))
    return true
  })

  handle('editor:start', (id: string, cols: number, rows: number, mode?: EditorMode) => editor.start(id, cols, rows, mode))
  handle('editor:stop', () => editor.stop())
  handle('editor:status', () => editor.status())
  handle('editor:files', (id: string) => {
    const s = getSession(id)
    return s ? editor.listFiles(s) : []
  })
  handle('editor:read', (id: string, path: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    const abs = editor.resolvePath(s, path)
    return existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  })
  handle('editor:write', async (id: string, path: string, content: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    const abs = editor.resolvePath(s, path)
    writeFileSync(abs, content, 'utf8')
    return true
  })
  handle('editor:open', async (id: string, path: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    return editor.openFile(s, path)
  })
  handle('editor:new-file', async (id: string, path: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    const abs = await editor.writeFile(s, path, '', true)
    return abs
  })
  handle('editor:builtin-file', (id: string, path?: string) => editor.setBuiltinFile(id, path))
  ipcMain.on('pty:write', (_e, data: string) => editor.ptyWrite(data))
  ipcMain.on('pty:resize', (_e, cols: number, rows: number) => editor.ptyResize(cols, rows))

  handle('run:file', async (id: string, path?: string, stdin?: string) => {
    const s = getSession(id)
    if (!s) throw new Error('Session not found')
    let file = path ? editor.resolvePath(s, path) : (await editor.state(s))?.file
    if (!file) throw new Error('No file is open — open a file in the editor first.')
    return runForUser(s, file, stdin)
  })
  handle('run:stop', () => stopRun())

  handle('graph:get', () => getGraph())
  handle('graph:delete-node', (id: string) => deleteNode(id))

  handle('doctor:check', (languages?: string[]) => runDoctor(languages))
  handle('doctor:toolchains', () => languageToolchainItems())
  handle('doctor:install', (item: { kind: string; value: string }) => install(item))
  handle('doctor:refresh-path', () => refreshPath())

  handle('nvim:reset-config', async () => {
    await editor.stop()
    const r = nvimRoots()
    rmSync(r.appConfig, { recursive: true, force: true })
    return true
  })
  handle('nvim:open-config', () => shell.openPath(nvimRoots().appConfig))
  handle('shell:open-path', (p: string) => shell.openPath(p))
  handle('shell:open-external', (url: string) => (/^https?:/.test(url) ? shell.openExternal(url) : undefined))
  handle('dialog:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  getSettings()
  registerIpc()
  editor.setHooks({
    onSubmit: (id) => submitExercise(id).catch((err) => emitAgent({ type: 'notice', level: 'error', message: String(err?.message ?? err) })),
    onRun: async (id, file) => {
      const s = getSession(id)
      if (!s) return
      const f = file || (await editor.state(s))?.file
      if (f) runForUser(s, f).catch(() => {})
    },
    onAsk: (id, payload) => {
      win?.focus()
      send('editor:ask', { sessionId: id, ...payload })
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', () => {
  editor.stop().catch(() => {})
})

app.on('window-all-closed', () => {
  app.quit()
})
