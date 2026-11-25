import { useEffect, useMemo, useState } from 'react'
import type { ChatMessage, Session } from '@shared/types'
import { api } from '../api'
import { toast } from '../store'
import { Markdown } from './Markdown'
import { Icon } from './Icon'

function seededOrder(n: number, seed: string): number[] {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
    const j = Math.abs(h) % (i + 1)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

const KEYS = ['1', '2', '3', '4', '5', '6']

export function QuizCard({ session, callId, input, result, pending }: { session: Session; callId: string; input: any; result?: ChatMessage; pending: boolean }) {
  const order = useMemo(() => seededOrder(input.options?.length ?? 0, callId), [callId, input.options?.length])
  const [sel, setSel] = useState<number | null>(null)
  const [confidence, setConfidence] = useState(60)
  const [thinking, setThinking] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const answer = (result?.meta?.answer ?? null) as any
  const correct = result?.meta?.correct as boolean | undefined
  const skipped = !!result?.meta?.skipped
  const isRecall = input.kind === 'recall'

  const send = async (payload: any) => {
    setSending(true)
    try {
      await api.answer(session.id, callId, payload)
    } catch (e: any) {
      toast(e.message, 'error')
      setSending(false)
    }
  }

  useEffect(() => {
    if (!pending || isRecall) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.closest('.xterm') || t.closest('.cm-editor')) return
      const k = KEYS.indexOf(e.key)
      if (k >= 0 && k < order.length) setSel(order[k])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, isRecall, order])

  return (
    <div className={`card ${pending ? 'pending' : ''}`}>
      <div className="card-kicker">
        <Icon name="help" size={13} /> {pending ? 'Check your understanding' : 'Check'}
      </div>
      <Markdown text={input.question} />
      {!isRecall &&
        order.map((oi, k) => {
          const isSel = pending ? sel === oi : answer?.selectedIndex === oi
          const showResult = !!result && !skipped
          const cls = showResult ? (oi === input.correctIndex ? 'correct' : isSel ? 'wrong' : '') : isSel ? 'selected' : ''
          return (
            <button key={oi} className={`option ${cls}`} disabled={!pending || sending} onClick={() => setSel(oi)}>
              <span className="key">{KEYS[k]}</span>
              <Markdown text={String(input.options[oi])} />
            </button>
          )
        })}
      {isRecall && pending && <textarea className="field" rows={3} placeholder="Your answer in your own words…" value={text} onChange={(e) => setText(e.target.value)} />}
      {isRecall && answer && !pending && (
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <div className="help">Your answer</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{answer.dontKnow ? "I don't know" : answer.text}</div>
        </div>
      )}
      {pending && !isRecall && (
        <>
          <div className="confidence">
            <span>Confidence</span>
            <input type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            <span style={{ width: 36, textAlign: 'right', color: 'var(--fg)' }}>{confidence}%</span>
          </div>
          <textarea className="field" rows={2} placeholder="Your reasoning (optional — helps the tutor see how you think)" value={thinking} onChange={(e) => setThinking(e.target.value)} />
        </>
      )}
      {pending && (
        <div className="row-actions">
          <button className="btn ghost small" disabled={sending} onClick={() => send(isRecall ? { dontKnow: true } : { dontKnow: true, thinking })}>
            I don't know
          </button>
          <span className="spacer" />
          <button
            className="btn primary"
            disabled={sending || (isRecall ? !text.trim() : sel === null)}
            onClick={() => send(isRecall ? { text } : { selectedIndex: sel, confidence, thinking })}
          >
            {sending ? <span className="spinner" /> : <Icon name="check" size={14} />} Answer
          </button>
        </div>
      )}
      {result && !skipped && !isRecall && (
        <div className={`verdict ${correct ? 'ok' : 'bad'}`}>
          <Icon name={correct ? 'check' : 'x'} size={14} /> {answer?.dontKnow ? "You said you don't know — that's useful, honest data." : correct ? 'Correct' : 'Not quite'}
          {typeof answer?.confidence === 'number' && !answer?.dontKnow && <span className="help">· confidence {answer.confidence}%</span>}
        </div>
      )}
      {result && !skipped && !isRecall && input.explanation && (
        <div className="explanation">
          <Markdown text={input.explanation} />
        </div>
      )}
      {result && !skipped && isRecall && (
        <div className="explanation">
          <div className="help" style={{ marginBottom: 4 }}>
            Reference answer
          </div>
          <Markdown text={input.correctAnswer} />
        </div>
      )}
      {skipped && <div className="help" style={{ marginTop: 6 }}>Skipped — answered in chat instead.</div>}
    </div>
  )
}

export function QuestionCard({ session, callId, input, result, pending }: { session: Session; callId: string; input: any; result?: ChatMessage; pending: boolean }) {
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const answer = result?.meta?.answer as any
  const options: { label: string; description?: string }[] = (input.options ?? []).map((o: any) => (typeof o === 'string' ? { label: o } : o))
  const toggle = (label: string) => {
    if (input.multiSelect) setPicked((p) => (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]))
    else setPicked([label])
  }
  const send = async (sel = picked) => {
    setSending(true)
    try {
      await api.answer(session.id, callId, { selected: sel, text: text.trim() || undefined })
    } catch (e: any) {
      toast(e.message, 'error')
      setSending(false)
    }
  }
  return (
    <div className={`card ${pending ? 'pending' : ''}`}>
      <div className="card-kicker question">
        <Icon name="sparkles" size={13} /> Question
      </div>
      <Markdown text={input.question} />
      {options.map((o, k) => {
        const isSel = pending ? picked.includes(o.label) : answer?.selected?.includes(o.label)
        return (
          <button
            key={o.label}
            className={`option ${isSel ? 'selected' : ''}`}
            disabled={!pending || sending}
            onClick={() => toggle(o.label)}
            onDoubleClick={() => pending && !input.multiSelect && send([o.label])}
          >
            <span className="key">{KEYS[k] ?? '•'}</span>
            <span>
              {o.label}
              {o.description && <div className="help">{o.description}</div>}
            </span>
          </button>
        )
      })}
      {pending && (
        <>
          <textarea
            className="field"
            rows={2}
            style={{ marginTop: 6 }}
            placeholder={options.length ? 'Or answer in your own words…' : 'Your answer…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && (text.trim() || picked.length)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="row-actions">
            <span className="spacer" />
            <button className="btn primary" disabled={sending || (!picked.length && !text.trim())} onClick={() => send()}>
              {sending ? <span className="spinner" /> : <Icon name="send" size={13} />} Answer
            </button>
          </div>
        </>
      )}
      {answer?.text && !pending && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', color: 'var(--fg-dim)' }}>“{answer.text}”</div>}
      {!!result?.meta?.skipped && <div className="help" style={{ marginTop: 6 }}>Skipped — answered in chat instead.</div>}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { write: 'Write it', fill_in: 'Fill in the gaps', fix_bug: 'Fix the bug', predict: 'Predict the output', refactor: 'Refactor' }

export function ExerciseCard({ session, callId, input, result, pending }: { session: Session; callId: string; input: any; result?: ChatMessage; pending: boolean }) {
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const files: string[] = [...new Set([input.open, ...(input.files ?? []).map((f: any) => f.path)].filter(Boolean))]
  const run = result?.meta?.run as any
  const submit = async () => {
    setSending(true)
    try {
      await api.answer(session.id, callId, { note: note.trim() || undefined })
    } catch (e: any) {
      toast(e.message, 'error')
      setSending(false)
    }
  }
  return (
    <div className={`card ${pending ? 'pending' : ''}`} style={pending ? { borderColor: 'rgba(158,206,106,0.55)', boxShadow: '0 0 0 3px rgba(158,206,106,0.08)' } : undefined}>
      <div className="card-kicker exercise">
        <Icon name={input.kind === 'fix_bug' ? 'bug' : 'pencil'} size={13} /> Exercise · {KIND_LABEL[input.kind] ?? 'Code'}
      </div>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>{input.title}</div>
      <Markdown text={input.instructions} />
      {files.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {files.map((f) => (
            <span key={f} className="tool-chip clickable" onClick={() => api.openFile(session.id, f).catch((e) => toast(e.message, 'error'))}>
              <Icon name="file" size={12} /> <code>{f}</code>
            </span>
          ))}
        </div>
      )}
      {pending && (
        <>
          <div className="help" style={{ margin: '6px 0 8px' }}>
            Work in the editor on the left. When you're done, submit here, with the Submit button, or <kbd>Space</kbd> <kbd>a</kbd> <kbd>s</kbd> in Neovim.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Optional note (what you tried, where you're unsure)…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <button className="btn success" disabled={sending} onClick={submit}>
              {sending ? <span className="spinner" /> : <Icon name="check" size={14} />} Submit
            </button>
          </div>
        </>
      )}
      {result && !result.meta?.skipped && (
        <div className="verdict ok" style={{ color: 'var(--fg-dim)' }}>
          <Icon name="check" size={14} style={{ color: 'var(--green)' }} /> Submitted
          {run && (
            <span className={run.ok ? '' : ''} style={{ color: run.ok ? 'var(--green)' : 'var(--red)' }}>
              · run {run.ok ? 'succeeded' : `failed (exit ${run.exitCode ?? '?'})`}
            </span>
          )}
          {(result.meta?.answer as any)?.note && <span className="help">· “{(result.meta?.answer as any).note}”</span>}
        </div>
      )}
      {!!result?.meta?.skipped && <div className="help" style={{ marginTop: 6 }}>Moved on in chat.</div>}
    </div>
  )
}

export function AssessmentCard({ input }: { input: any }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="card">
      <div className="card-kicker assessment" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <Icon name="target" size={13} /> Where you stand <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
      </div>
      {input.goal && (
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <b>Goal:</b> {input.goal}
        </div>
      )}
      {open && (
        <>
          {(input.strands ?? []).map((s: any, i: number) => (
            <div key={i} className="strand">
              <b>{s.strand}</b>
              {s.level && <span className={`level ${s.level}`}>{s.level}</span>}
              <div style={{ color: 'var(--fg-dim)' }}>{s.assessment}</div>
            </div>
          ))}
          {input.summary && <div className="explanation">{input.summary}</div>}
        </>
      )}
    </div>
  )
}
