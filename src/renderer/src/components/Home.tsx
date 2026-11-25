import { useEffect, useRef, useState } from 'react'
import type { SessionMode } from '@shared/types'
import { LANGUAGES, detectLanguage, findLanguage, languageInfo } from '@shared/languages'
import { api } from '../api'
import { navigate, toast, useStore, setState } from '../store'
import { Icon } from './Icon'
import { LangDot } from './LangBadge'

const FEATURED = ['rust', 'python', 'csharp', 'typescript', 'go', 'cpp', 'java', 'c', 'kotlin', 'lua', 'haskell', 'zig', 'javascript', 'sql', 'elixir', 'ruby']

const MODES: { id: SessionMode; label: string; icon: string; placeholder: string; desc: string }[] = [
  { id: 'learn', label: 'Learn', icon: 'book', placeholder: 'I want to learn Rust — I already know some Python…', desc: 'Measure what you know, plan a path, learn step by step.' },
  { id: 'project', label: 'Build a project', icon: 'hammer', placeholder: 'I want to build a CLI todo app in Go…', desc: 'Build something real together — you write the code, the tutor guides.' },
  { id: 'practice', label: 'Practice', icon: 'target', placeholder: 'Give me practice problems for C# LINQ…', desc: 'Varied problems drawn from what you already learned.' }
]

function greeting(name: string) {
  const h = new Date().getHours()
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}.` : `${part}.`
}

export function Home() {
  const settings = useStore((s) => s.settings)
  const sessions = useStore((s) => s.sessions)
  const [mode, setMode] = useState<SessionMode>('learn')
  const [text, setText] = useState('')
  const [lang, setLang] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const detected = detectLanguage(text)
  const effective = lang === 'other' ? custom.trim().toLowerCase() || null : (lang ?? detected?.id ?? null)
  const noProvider = settings && settings.providers.length === 0
  const m = MODES.find((x) => x.id === mode)!

  useEffect(() => ta.current?.focus(), [])
  useEffect(() => {
    const el = ta.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(220, el.scrollHeight) + 'px'
    }
  }, [text])

  const start = async () => {
    if (busy) return
    if (noProvider) {
      toast('Add an AI provider first (Settings → Providers).', 'error')
      navigate({ kind: 'settings', tab: 'providers' })
      return
    }
    if (!effective) {
      toast('Which language? Mention it, or pick one below.', 'error')
      return
    }
    setBusy(true)
    try {
      const s = await api.createSession({ language: effective, mode, text, workspace: folder ?? undefined })
      setState((st) => ({ sessionCache: { ...st.sessionCache, [s.id]: s } }))
      setText('')
      navigate({ kind: 'session', id: s.id })
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home">
      {noProvider && (
        <div className="banner">
          <Icon name="sparkles" />
          <div style={{ flex: 1 }}>Connect an AI model to get started — any OpenAI-compatible endpoint works (OpenAI, OpenRouter, Ollama, LM Studio, …).</div>
          <button className="btn small" onClick={() => navigate({ kind: 'settings', tab: 'providers' })}>
            Add provider
          </button>
        </div>
      )}
      <div className="logo" style={{ width: 54, height: 54, fontSize: 22, borderRadius: 16 }}>
        Ae
      </div>
      <h1>
        {greeting(settings?.agent.learnerName ?? '')} <span className="grad">What do you want to learn today?</span>
      </h1>
      <div className="subtitle">{m.desc}</div>

      <div className="mode-tabs">
        {MODES.map((x) => (
          <button key={x.id} className={`mode-tab ${mode === x.id ? 'active' : ''}`} onClick={() => setMode(x.id)}>
            <Icon name={x.icon} size={15} /> {x.label}
          </button>
        ))}
      </div>

      <div className="home-composer">
        <div className="composer">
          <textarea
            ref={ta}
            rows={2}
            value={text}
            placeholder={m.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                start()
              }
            }}
          />
          <div className="composer-row">
            {effective ? (
              <span className="badge" style={{ color: languageInfo(effective).color }}>
                <span style={{ fontFamily: 'var(--mono)' }}>{languageInfo(effective).icon}</span> {findLanguage(effective)?.name ?? effective}
                {lang && (
                  <span style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => setLang(null)}>
                    ✕
                  </span>
                )}
              </span>
            ) : (
              <span className="hint">Mention a language or pick one below</span>
            )}
            {mode === 'project' && (
              <button className="btn small ghost" onClick={async () => setFolder(await api.pickFolder())} title="Use an existing folder as the project workspace">
                <Icon name="folder" size={13} /> {folder ? folder.split(/[\\/]/).pop() : 'Use existing folder…'}
              </button>
            )}
            <span className="spacer" />
            <span className="hint">
              <kbd>Enter</kbd> to start
            </span>
            <button className="btn primary" onClick={start} disabled={busy || (!text.trim() && !effective)}>
              {busy ? <span className="spinner" /> : <Icon name="send" size={14} />} Start
            </button>
          </div>
        </div>
        {lang === 'other' && (
          <input className="input" style={{ marginTop: 10 }} placeholder="Language name, e.g. Fortran, Nim, COBOL…" value={custom} autoFocus onChange={(e) => setCustom(e.target.value)} />
        )}
      </div>

      <div className="chips">
        {FEATURED.map((id) => {
          const l = LANGUAGES.find((x) => x.id === id)!
          return (
            <button key={id} className={`chip ${effective === id ? 'selected' : ''}`} onClick={() => setLang(lang === id ? null : id)}>
              <span className="glyph" style={{ color: l.color }}>
                {l.icon}
              </span>
              {l.name}
            </button>
          )
        })}
        <select className={`chip ${lang && !FEATURED.includes(lang) && lang !== 'other' ? 'selected' : ''}`} value="" onChange={(e) => setLang(e.target.value || null)} style={{ appearance: 'none', paddingRight: 14 }}>
          <option value="">More…</option>
          {LANGUAGES.filter((l) => !FEATURED.includes(l.id)).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="other">Other language…</option>
        </select>
      </div>

      {sessions.length > 0 ? (
        <div className="recent">
          <h3>Continue where you left off</h3>
          <div className="recent-grid">
            {sessions.slice(0, 6).map((s) => (
              <div key={s.id} className="recent-card" onClick={() => navigate({ kind: 'session', id: s.id })}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <LangDot language={s.language} size={22} />
                  <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </div>
                </div>
                <div className="s">{s.summary ?? `${s.mode} · ${s.phase}`}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="welcome-steps">
          <div className="welcome-step">
            <div className="n">01 · MEASURE</div>
            <b>Find your edge</b>
            The tutor checks your history, then asks a few sharp questions and tiny coding tasks to see what you already know.
          </div>
          <div className="welcome-step">
            <div className="n">02 · PLAN</div>
            <b>A minimal path</b>
            It plans the smallest set of ideas from where you are to your goal — no re-teaching what you already hold.
          </div>
          <div className="welcome-step">
            <div className="n">03 · TEACH</div>
            <b>One step at a time</b>
            Each idea lands with an example in the editor and a check: quizzes, fill-in-the-gap, fix-the-bug, build-it-yourself.
          </div>
        </div>
      )}
    </div>
  )
}
