import { useEffect, useRef, useState } from 'react'
import type { Phase, Session } from '@shared/types'
import { api } from '../api'
import { setState, toast, useStore } from '../store'
import { EditorPane } from './EditorPane'
import { ChatPane } from './ChatPane'
import { LangBadge } from './LangBadge'

const STEPS: { id: string; label: string }[] = [
  { id: 'measure', label: 'Measure' },
  { id: 'plan', label: 'Plan' },
  { id: 'teach', label: 'Teach' }
]

function stepState(session: Session): { current: string; done: string[] } {
  if (session.phase === 'practice') return { current: 'practice', done: [] }
  if (session.phase === 'probe') return { current: 'measure', done: [] }
  const confirmedPlan = session.plan && session.plan.nodes.some((n) => n.status !== 'todo')
  if (!confirmedPlan) return { current: 'plan', done: ['measure'] }
  return { current: 'teach', done: ['measure', 'plan'] }
}

function PhaseSteps({ session }: { session: Session }) {
  if (session.phase === 'practice') {
    return (
      <div className="phase-steps">
        <span className="phase-step active">
          <span className="dot" /> Practice
        </span>
      </div>
    )
  }
  const { current, done } = stepState(session)
  const label = (id: string, l: string) => (id === 'teach' && (session.phase as Phase) === 'project' ? 'Build' : l)
  return (
    <div className="phase-steps">
      {STEPS.map((s, i) => (
        <span key={s.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="phase-sep">›</span>}
          <span className={`phase-step ${current === s.id ? 'active' : ''} ${done.includes(s.id) ? 'done' : ''}`}>
            <span className="dot" /> {label(s.id, s.label)}
          </span>
        </span>
      ))}
    </div>
  )
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.sessionCache[sessionId])
  const settings = useStore((s) => s.settings)
  const [chatWidth, setChatWidth] = useState<number>(settings?.ui.chatWidth ?? 460)
  const [dragging, setDragging] = useState(false)
  const [title, setTitle] = useState(session?.title ?? '')
  const splitRef = useRef<HTMLDivElement>(null)

  useEffect(() => setTitle(session?.title ?? ''), [session?.title])

  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect) return
      const w = Math.min(Math.max(rect.right - e.clientX, 340), rect.width - 320)
      setChatWidth(w)
    }
    const up = async () => {
      setDragging(false)
      if (settings) {
        const next = { ...settings, ui: { ...settings.ui, chatWidth } }
        setState({ settings: await api.saveSettings(next) })
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging, chatWidth, settings])

  if (!session) return <div className="empty">Loading session…</div>

  const provider = settings?.providers.find((p) => p.id === (session.providerId ?? settings.activeProviderId)) ?? settings?.providers[0]

  return (
    <div className="session">
      <div className="session-header">
        <LangBadge language={session.language} />
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== session.title && api.updateSession(session.id, { title: title.trim() }).catch((e) => toast(e.message, 'error'))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{ width: Math.max(140, title.length * 8 + 24) }}
        />
        <PhaseSteps session={session} />
        <span style={{ flex: 1 }} />
        {settings && settings.providers.length > 1 ? (
          <select
            className="input"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
            value={session.providerId ?? ''}
            onChange={(e) => api.updateSession(session.id, { providerId: e.target.value })}
            title="Model for this session"
          >
            <option value="">Default ({settings.providers.find((p) => p.id === settings.activeProviderId)?.name ?? '—'})</option>
            {settings.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        ) : (
          provider && <span className="badge" title={provider.baseUrl}>{provider.model}</span>
        )}
      </div>
      <div className="split" ref={splitRef}>
        <EditorPane session={session} />
        <div className={`splitter ${dragging ? 'dragging' : ''}`} onMouseDown={() => setDragging(true)} />
        <div className="chat-pane" style={{ width: chatWidth }}>
          <ChatPane session={session} />
        </div>
      </div>
      {dragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 40 }} />}
    </div>
  )
}
