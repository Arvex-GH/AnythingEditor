import { useEffect, useRef, useState } from 'react'
import type { RunResult } from '@shared/types'
import { api, on } from '../api'
import { Icon } from './Icon'

interface Chunk {
  stream: 'stdout' | 'stderr'
  text: string
  dim?: boolean
}

// Strip ANSI escape codes but remember "dim" command lines.
function parse(stream: 'stdout' | 'stderr', data: string): Chunk[] {
  const out: Chunk[] = []
  const re = /\x1b\[2m([\s\S]*?)\x1b\[0m/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(data))) {
    if (m.index > last) out.push({ stream, text: data.slice(last, m.index) })
    out.push({ stream, text: m[1], dim: true })
    last = m.index + m[0].length
  }
  if (last < data.length) out.push({ stream, text: data.slice(last) })
  // eslint-disable-next-line no-control-regex
  return out.map((c) => ({ ...c, text: c.text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') }))
}

export function RunPanel({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [title, setTitle] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => {
    return on('run:event', (ev: any) => {
      if (ev.type === 'start') {
        if (ev.sessionId && ev.sessionId !== sessionId) return
        setChunks([])
        setResult(null)
        setRunning(true)
        setOpen(true)
        setTitle(`${ev.source === 'agent' ? 'Tutor ran' : 'Running'} ${ev.command}`)
      } else if (ev.type === 'data') {
        setChunks((c) => [...c, ...parse(ev.stream, ev.data)].slice(-2000))
      } else if (ev.type === 'end') {
        setRunning(false)
        setResult(ev.result)
      }
    })
  }, [sessionId])

  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [chunks, open])

  return (
    <div className="run-panel">
      <div className="run-head" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
        <Icon name="terminal" size={13} />
        <span>{title || 'Output'}</span>
        {running && <span className="spinner" />}
        {result && (
          <span className={result.ok ? 'status-ok' : 'status-err'}>
            {result.ok ? '✓ exit 0' : `✗ ${result.timedOut ? 'timed out' : result.exitCode === null ? 'failed' : `exit ${result.exitCode}`}`} · {(result.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <span style={{ flex: 1 }} />
        {running && (
          <button
            className="btn small ghost"
            onClick={(e) => {
              e.stopPropagation()
              api.stopRun()
            }}
          >
            <Icon name="stop" size={11} /> Stop
          </button>
        )}
        {chunks.length > 0 && !running && (
          <button
            className="btn small ghost"
            onClick={(e) => {
              e.stopPropagation()
              setChunks([])
              setResult(null)
              setTitle('')
            }}
          >
            Clear
          </button>
        )}
      </div>
      {open && (
        <pre className="run-out" ref={pre}>
          {chunks.length === 0 && !running && <span className="dim">Run a file with the ▶ Run button or &lt;leader&gt;ar in Neovim.</span>}
          {chunks.map((c, i) => (
            <span key={i} className={c.dim ? 'dim' : c.stream === 'stderr' ? 'err' : ''}>
              {c.text}
            </span>
          ))}
        </pre>
      )}
    </div>
  )
}
