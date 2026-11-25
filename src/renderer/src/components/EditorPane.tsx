import { useEffect, useRef, useState } from 'react'
import type { EditorStatus, RunResult, Session } from '@shared/types'
import { api, on } from '../api'
import { navigate, toast, useStore } from '../store'
import { Icon } from './Icon'
import { NvimTerminal, type TerminalHandle } from './NvimTerminal'
import { BuiltinEditor } from './BuiltinEditor'
import { RunPanel } from './RunPanel'

export function EditorPane({ session }: { session: Session }) {
  const settings = useStore((s) => s.settings)
  const [status, setStatus] = useState<EditorStatus | null>(null)
  const [exited, setExited] = useState(false)
  const [file, setFile] = useState<string | undefined>()
  const [restartKey, setRestartKey] = useState(0)
  const [forceMode, setForceMode] = useState<'neovim' | 'builtin' | undefined>()
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const started = useRef(false)
  const preferred = forceMode ?? settings?.editor.mode ?? 'neovim'
  const pendingExercise = session.pending?.kind === 'assign_exercise' ? session.pending : null
  const fontSize = settings?.editor.fontSize ?? 14

  useEffect(() => {
    const offs = [
      on('editor:status', (st: EditorStatus) => st.sessionId === session.id && setStatus(st)),
      on('pty:exit', (p: { sessionId: string }) => p.sessionId === session.id && setExited(true)),
      on('editor:focus', (p: { sessionId: string; file: string }) => p.sessionId === session.id && setFile(rel(p.file))),
      on('run:event', (ev: { type: string; result?: RunResult }) => {
        if (ev.type === 'start') setRunning(true)
        if (ev.type === 'end') setRunning(false)
      })
    ]
    return () => offs.forEach((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => {
    return () => {
      api.editorStop().catch(() => {})
    }
  }, [session.id])

  // Built-in mode starts without a terminal.
  useEffect(() => {
    if (preferred !== 'builtin') return
    setExited(false)
    api
      .editorStart(session.id, 80, 24, 'builtin')
      .then(setStatus)
      .catch((e) => toast(e.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, preferred, restartKey])

  const rel = (p: string) => {
    const ws = session.workspace.replace(/\\/g, '/').toLowerCase()
    const n = p.replace(/\\/g, '/')
    return n.toLowerCase().startsWith(ws) ? n.slice(ws.length).replace(/^\/+/, '') : n
  }

  const onTerminalReady = async (h: TerminalHandle) => {
    const { cols, rows } = h.fit()
    started.current = true
    setExited(false)
    try {
      const st = await api.editorStart(session.id, cols, rows, forceMode)
      setStatus(st)
      if (st.mode === 'builtin') setForceMode('builtin')
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const run = async () => {
    try {
      await api.run(session.id, file)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const submit = async () => {
    try {
      await api.submit(session.id, note.trim() || undefined)
      setNote('')
      setShowNote(false)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const mode = preferred

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <span className="badge" title={mode === 'neovim' ? 'Neovim with LazyVim' : 'Built-in editor with Vim keybindings'}>
          <Icon name={mode === 'neovim' ? 'terminal' : 'keyboard'} size={12} /> {mode === 'neovim' ? 'LazyVim' : 'Vim mode'}
        </span>
        <span className="file">{file ?? ''}</span>
        <span style={{ flex: 1 }} />
        <button className="btn small ghost" onClick={() => api.openPath(session.workspace)} title="Open workspace folder">
          <Icon name="folder" size={13} />
        </button>
        <button className="btn small ghost" onClick={() => { setForceMode(mode === 'neovim' ? 'builtin' : 'neovim'); setRestartKey((k) => k + 1) }} title="Switch editor">
          <Icon name="refresh" size={13} /> {mode === 'neovim' ? 'Built-in' : 'Neovim'}
        </button>
        <button className="btn small" onClick={run} title="Run the current file (<leader>ar in Neovim)">
          {running ? <span className="spinner" /> : <Icon name="play" size={12} />} Run
        </button>
        {pendingExercise ? (
          <button className="btn small success" onClick={() => setShowNote((v) => !v)} title="Submit the exercise (<leader>as in Neovim)">
            <Icon name="check" size={13} /> Submit
          </button>
        ) : (
          <button className="btn small" onClick={() => setShowNote((v) => !v)} title="Ask the tutor to review the current file">
            <Icon name="eye" size={13} /> Review
          </button>
        )}
      </div>
      {showNote && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)', display: 'flex', gap: 8 }}>
          <input
            className="input"
            autoFocus
            placeholder={pendingExercise ? 'Optional note for your tutor (what you tried, where you are unsure)…' : 'What should the tutor look at? (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setShowNote(false)
            }}
          />
          <button className={`btn ${pendingExercise ? 'success' : 'primary'}`} onClick={submit}>
            {pendingExercise ? 'Submit' : 'Send'}
          </button>
        </div>
      )}
      <div className="editor-body">
        {preferred === 'neovim' ? (
          <NvimTerminal key={`${session.id}-${restartKey}-${fontSize}`} fontSize={fontSize} onReady={onTerminalReady} />
        ) : (
          <BuiltinEditor key={`${session.id}-${restartKey}`} sessionId={session.id} workspace={session.workspace} onFile={setFile} />
        )}
        {status?.error && !exited && (
          <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 4 }}>
            <div className="banner" style={{ width: 'auto', margin: 0 }}>
              <div style={{ flex: 1, fontSize: 13 }}>{status.error}</div>
              <button className="btn small" onClick={() => navigate({ kind: 'settings', tab: 'doctor' })}>
                Doctor
              </button>
              <button className="icon-btn" onClick={() => setStatus({ ...status, error: undefined })}>
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        )}
        {exited && mode === 'neovim' && (
          <div className="editor-overlay">
            <div className="box">
              <Icon name="terminal" size={28} />
              <div>Neovim exited.</div>
              <button className="btn primary" onClick={() => setRestartKey((k) => k + 1)}>
                Restart editor
              </button>
            </div>
          </div>
        )}
      </div>
      <RunPanel sessionId={session.id} />
    </div>
  )
}
