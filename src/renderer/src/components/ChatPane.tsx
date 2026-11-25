import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, Session, StreamDraft } from '@shared/types'
import { api } from '../api'
import { setState, toast, useStore } from '../store'
import { Markdown } from './Markdown'
import { Icon } from './Icon'
import { AssessmentCard, ExerciseCard, QuestionCard, QuizCard } from './Cards'
import { PlanPanel } from './PlanPanel'

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    // partial JSON while streaming: try to pull a path
    const m = s.match(/"path"\s*:\s*"([^"]*)/)
    return m ? { path: m[1] } : {}
  }
}

const TOOL_LABEL: Record<string, (a: any, r?: ChatMessage) => { icon: string; text: React.ReactNode }> = {
  write_file: (a) => ({ icon: 'pencil', text: <>Wrote <code>{a.path}</code></> }),
  read_file: (a) => ({ icon: 'eye', text: <>Read <code>{a.path}</code></> }),
  open_file: (a) => ({ icon: 'file', text: <>Opened <code>{a.path}</code></> }),
  list_files: () => ({ icon: 'list', text: 'Listed workspace files' }),
  get_editor_state: () => ({ icon: 'eye', text: 'Looked at your editor' }),
  get_diagnostics: () => ({ icon: 'bug', text: 'Checked diagnostics' }),
  run_code: (a, r) => {
    const res = r?.meta?.result as any
    return {
      icon: 'play',
      text: (
        <>
          Ran <code>{a.path}</code>
          {res && <span className={res.ok ? 'ok' : 'bad'}>{res.ok ? '✓' : `✗ exit ${res.exitCode ?? '?'}`}</span>}
        </>
      )
    }
  },
  get_learner_profile: () => ({ icon: 'brain', text: 'Checked your learning history' }),
  list_sessions: () => ({ icon: 'brain', text: 'Looked at past sessions' }),
  search_knowledge: (a) => ({ icon: 'search', text: <>Searched your knowledge graph for “{a.query}”</> }),
  plan_init: (a) => ({ icon: 'map', text: <>Planned {a.nodes?.length ?? ''} steps</> }),
  plan_update: (a) => ({ icon: 'map', text: <>Step {a.nodeId} → {a.status}</> })
}

function ToolChip({ name, args, result, session }: { name: string; args: any; result?: ChatMessage; session: Session }) {
  const label = TOOL_LABEL[name]?.(args, result) ?? { icon: 'sparkles', text: name }
  const path = args?.path
  const clickable = !!path && ['write_file', 'read_file', 'open_file', 'run_code'].includes(name)
  const isError = result?.content?.startsWith('Error')
  return (
    <span
      className={`tool-chip ${clickable ? 'clickable' : ''}`}
      title={isError ? result?.content ?? '' : clickable ? 'Open in editor' : ''}
      onClick={() => clickable && api.openFile(session.id, path).catch((e) => toast(e.message, 'error'))}
    >
      <Icon name={label.icon} size={12} />
      {label.text}
      {!result && <span className="spinner" style={{ width: 10, height: 10 }} />}
      {isError && <span className="bad">error</span>}
    </span>
  )
}

function AssistantMessage({ m, session, results, isLast, busy }: { m: ChatMessage; session: Session; results: Map<string, ChatMessage>; isLast: boolean; busy: boolean }) {
  if (m.error) {
    return (
      <div className="msg error">
        <div style={{ flex: 1 }}>{m.content}</div>
        {isLast && !busy && m.content !== '⏹ Stopped.' && (
          <button className="btn small" onClick={() => api.retry(session.id).catch((e) => toast(e.message, 'error'))}>
            <Icon name="refresh" size={12} /> Retry
          </button>
        )}
        {isLast && !busy && m.content === '⏹ Stopped.' && (
          <button className="btn small" onClick={() => api.retry(session.id).catch((e) => toast(e.message, 'error'))}>
            Continue
          </button>
        )}
      </div>
    )
  }
  const calls = m.tool_calls ?? []
  const chips = calls.filter((c) => !['quiz', 'ask_user_question', 'assign_exercise', 'probe_done'].includes(c.function.name))
  return (
    <div className="msg assistant">
      {m.reasoning && (
        <details className="reasoning-wrap">
          <summary>▸ Thought process</summary>
          <div className="reasoning">{m.reasoning}</div>
        </details>
      )}
      {m.content?.trim() && <Markdown text={m.content} />}
      {chips.length > 0 && (
        <div style={{ marginTop: m.content?.trim() ? 8 : 0 }}>
          {chips.map((c) => (
            <ToolChip key={c.id} name={c.function.name} args={safeParse(c.function.arguments)} result={results.get(c.id)} session={session} />
          ))}
        </div>
      )}
      {calls.map((c) => {
        const args = safeParse(c.function.arguments)
        const result = results.get(c.id)
        const pending = session.pending?.toolCallId === c.id
        const isErr = result?.content?.startsWith('Error') || result?.content?.startsWith('Not shown')
        if (isErr) return null
        if (c.function.name === 'quiz' && (pending || result)) return <QuizCard key={c.id} session={session} callId={c.id} input={args} result={result} pending={pending} />
        if (c.function.name === 'ask_user_question' && (pending || result)) return <QuestionCard key={c.id} session={session} callId={c.id} input={args} result={result} pending={pending} />
        if (c.function.name === 'assign_exercise' && (pending || result)) return <ExerciseCard key={c.id} session={session} callId={c.id} input={args} result={result} pending={pending} />
        if (c.function.name === 'probe_done' && result && !isErr) return <AssessmentCard key={c.id} input={args} />
        return null
      })}
    </div>
  )
}

function DraftView({ draft }: { draft: StreamDraft }) {
  return (
    <div className="msg assistant">
      {draft.reasoning && !draft.content && <div className="reasoning">{draft.reasoning.slice(-600)}</div>}
      {draft.content && <Markdown text={draft.content} />}
      {draft.toolCalls.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {draft.toolCalls.map((t, i) => (
            <span key={i} className="tool-chip">
              <span className="spinner" style={{ width: 10, height: 10 }} />
              {t.name === 'assign_exercise' ? 'Preparing an exercise…' : t.name === 'quiz' ? 'Writing a question…' : t.name === 'write_file' ? <>Writing <code>{safeParse(t.arguments).path ?? 'file'}</code>…</> : t.name === 'plan_init' ? 'Planning…' : t.name === 'probe_done' ? 'Writing assessment…' : t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPane({ session }: { session: Session }) {
  const draft = useStore((s) => s.drafts[session.id] ?? null)
  const st = useStore((s) => s.status[session.id])
  const listBusy = useStore((s) => !!s.sessions.find((x) => x.id === session.id)?.busy)
  const extracting = useStore((s) => !!s.extracting[session.id])
  const insert = useStore((s) => s.composerInsert)
  const busy = st ? st.status === 'thinking' || st.status === 'tool' : listBusy
  const [text, setText] = useState('')
  const [snippet, setSnippet] = useState<{ text: string; label: string } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const ta = useRef<HTMLTextAreaElement>(null)

  const results = useMemo(() => {
    const m = new Map<string, ChatMessage>()
    for (const x of session.messages) if (x.role === 'tool' && x.tool_call_id) m.set(x.tool_call_id, x)
    return m
  }, [session.messages])

  const visible = session.messages.filter((m) => !m.hidden && m.role !== 'tool')

  useEffect(() => {
    if (insert && insert.sessionId === session.id) {
      setSnippet({ text: insert.text, label: insert.label })
      setState({ composerInsert: null })
      setTimeout(() => ta.current?.focus(), 0)
    }
  }, [insert, session.id])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  useEffect(() => {
    const el = ta.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(200, el.scrollHeight) + 'px'
    }
  }, [text])

  const send = async () => {
    const body = (snippet ? snippet.text + '\n' : '') + text.trim()
    if (!body.trim() || busy) return
    try {
      await api.send(session.id, body)
      setText('')
      setSnippet(null)
      stick.current = true
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const lastVisible = visible[visible.length - 1]

  return (
    <>
      {session.plan && <PlanPanel plan={session.plan} />}
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {visible.map((m) => (
          <Fragment key={m.id}>
            {m.role === 'user' ? (
              <div className="msg user">
                <div className="bubble">
                  <Markdown text={m.content ?? ''} />
                </div>
              </div>
            ) : (
              <AssistantMessage m={m} session={session} results={results} isLast={m === lastVisible} busy={busy} />
            )}
          </Fragment>
        ))}
        {draft && <DraftView draft={draft} />}
        {busy && !draft && (
          <div className="status-line">
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
            {st?.status === 'tool' && <span>{st.detail === 'run_code' ? 'Running code…' : `Using ${st.detail}…`}</span>}
          </div>
        )}
        {extracting && !busy && (
          <div className="status-line">
            <Icon name="brain" size={12} /> Updating your knowledge graph…
          </div>
        )}
      </div>
      <div className="chat-bottom">
        <div className="composer">
          {snippet && (
            <div className="snippet-chip">
              <Icon name="file" size={12} />
              <span>{snippet.label}</span>
              <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => setSnippet(null)}>
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={session.pending ? 'Answer above, or write a message…' : 'Message your tutor…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="composer-row">
            <span className="hint">
              <kbd>Space</kbd> <kbd>a</kbd> <kbd>a</kbd> in Neovim sends code here
            </span>
            <span className="spacer" />
            {busy ? (
              <button className="btn small" onClick={() => api.stop(session.id)}>
                <Icon name="stop" size={11} /> Stop
              </button>
            ) : (
              <button className="btn primary small" disabled={!text.trim() && !snippet} onClick={send}>
                <Icon name="send" size={13} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
