import { useEffect, useRef, useState } from 'react'
import type { DoctorItem, Provider, Settings } from '@shared/types'
import { BASE_LAZY_EXTRAS, LANGUAGES } from '@shared/languages'
import { api, on } from '../api'
import { navigate, setState, toast, useStore } from '../store'
import { Icon } from './Icon'

export const PROVIDER_PRESETS: { name: string; baseUrl: string; model: string; keyHint?: string; noKey?: boolean }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', keyHint: 'sk-…' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', keyHint: 'sk-or-…' },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', keyHint: 'sk-ant-…' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:14b', noKey: true },
  { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: 'local-model', noKey: true },
  { name: 'Custom', baseUrl: 'https://', model: '' }
]

const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 12)

function ProviderCard({ p, active, onChange, onRemove, onActivate }: { p: Provider; active: boolean; onChange: (p: Provider) => void; onRemove: () => void; onActivate: () => void }) {
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [headersText, setHeadersText] = useState(p.headers ? JSON.stringify(p.headers) : '')
  const set = (patch: Partial<Provider>) => onChange({ ...p, ...patch })

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.testProvider(p)
      toast(`${p.name}: “${r.reply}” in ${r.ms} ms`)
    } catch (e: any) {
      toast(`${p.name}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }
  const fetchModels = async () => {
    setLoadingModels(true)
    try {
      const m = await api.listModels(p)
      setModels(m)
      if (!m.length) toast('The endpoint returned no models', 'error')
    } catch (e: any) {
      toast(`Could not list models: ${e.message}`, 'error')
    } finally {
      setLoadingModels(false)
    }
  }

  return (
    <div className={`provider-card ${active ? 'active' : ''}`}>
      <div className="head">
        <input className="input" style={{ maxWidth: 240, fontWeight: 600 }} value={p.name} onChange={(e) => set({ name: e.target.value })} />
        {active ? (
          <span className="badge" style={{ color: 'var(--blue)' }}>
            <Icon name="check" size={12} /> Default
          </span>
        ) : (
          <button className="btn small ghost" onClick={onActivate}>
            Make default
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={test} disabled={testing || !p.model}>
          {testing ? <span className="spinner" /> : <Icon name="sparkles" size={12} />} Test
        </button>
        <button className="icon-btn" onClick={onRemove} title="Remove">
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="form-grid">
        <label>Base URL</label>
        <input className="input" value={p.baseUrl} placeholder="https://host/v1" onChange={(e) => set({ baseUrl: e.target.value.trim() })} />
        <label>API key</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={p.apiKey}
            placeholder="Leave empty for local servers"
            onFocus={(e) => p.apiKey.startsWith('••••') && e.target.select()}
            onChange={(e) => set({ apiKey: e.target.value.trim() })}
          />
          <button className="icon-btn" onClick={() => setShowKey((v) => !v)} title="Show/hide">
            <Icon name="eye" size={14} />
          </button>
        </div>
        <label>Model</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" list={`models-${p.id}`} value={p.model} placeholder="model id" onChange={(e) => set({ model: e.target.value.trim() })} />
          <datalist id={`models-${p.id}`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="btn small" onClick={fetchModels} disabled={loadingModels} title="Fetch /models from the endpoint">
            {loadingModels ? <span className="spinner" /> : <Icon name="list" size={12} />} Models
          </button>
        </div>
        {models.length > 0 && (
          <>
            <label />
            <select className="input" value={models.includes(p.model) ? p.model : ''} onChange={(e) => e.target.value && set({ model: e.target.value })}>
              <option value="">Pick from {models.length} models…</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </>
        )}
        <label>Temperature</label>
        <input className="input" type="number" min={0} max={2} step={0.1} placeholder="provider default" value={p.temperature ?? ''} onChange={(e) => set({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <label>Reasoning effort</label>
        <select className="input" value={p.reasoningEffort ?? ''} onChange={(e) => set({ reasoningEffort: e.target.value as Provider['reasoningEffort'] })}>
          <option value="">Not sent</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        <label>Context budget</label>
        <div>
          <input className="input" type="number" min={20000} step={10000} placeholder="120000" value={p.contextChars ?? ''} onChange={(e) => set({ contextChars: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <div className="help">Characters of history before older turns are summarized.</div>
        </div>
        <label>Extra headers (JSON)</label>
        <input
          className="input"
          placeholder='{"HTTP-Referer": "https://example.com"}'
          value={headersText}
          onChange={(e) => {
            setHeadersText(e.target.value)
            try {
              const v = e.target.value.trim() ? JSON.parse(e.target.value) : undefined
              set({ headers: v })
            } catch {
              /* keep typing */
            }
          }}
        />
      </div>
    </div>
  )
}

function ProvidersTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const add = (preset: (typeof PROVIDER_PRESETS)[number]) => {
    const p: Provider = { id: uid(), name: preset.name, baseUrl: preset.baseUrl, apiKey: '', model: preset.model }
    update({ providers: [...s.providers, p], activeProviderId: s.activeProviderId ?? p.id })
  }
  return (
    <>
      <div className="section">
        <h2>Language model endpoints</h2>
        <p className="help" style={{ marginTop: -6, marginBottom: 12 }}>
          Any OpenAI-compatible Chat Completions endpoint works (with streaming and tool calling). Keys are encrypted with your OS keychain. Add one from a preset:
        </p>
        <div className="presets">
          {PROVIDER_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => add(p)}>
              <Icon name="plus" size={12} /> {p.name}
            </button>
          ))}
        </div>
        {s.providers.length === 0 && <div className="empty">No endpoint yet. Pick a preset above (use “Custom” for any other OpenAI-compatible server).</div>}
        {s.providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            active={(s.activeProviderId ?? s.providers[0]?.id) === p.id}
            onChange={(np) => update({ providers: s.providers.map((x) => (x.id === p.id ? np : x)) })}
            onRemove={() => {
              const providers = s.providers.filter((x) => x.id !== p.id)
              update({ providers, activeProviderId: s.activeProviderId === p.id ? providers[0]?.id : s.activeProviderId, backgroundProviderId: s.backgroundProviderId === p.id ? undefined : s.backgroundProviderId })
            }}
            onActivate={() => update({ activeProviderId: p.id })}
          />
        ))}
      </div>
      {s.providers.length > 1 && (
        <div className="section">
          <h2>Background model</h2>
          <div className="form-grid">
            <label>Knowledge extraction & summaries</label>
            <select className="input" value={s.backgroundProviderId ?? ''} onChange={(e) => update({ backgroundProviderId: e.target.value || undefined })}>
              <option value="">Same as the default endpoint</option>
              {s.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </div>
          <p className="help">A cheaper/faster model is fine here — it updates your knowledge graph after each session.</p>
        </div>
      )}
    </>
  )
}

function AgentTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const a = s.agent
  const set = (patch: Partial<Settings['agent']>) => update({ agent: { ...a, ...patch } })
  return (
    <div className="section">
      <h2>Tutor</h2>
      <div className="form-grid">
        <label>Your name</label>
        <input className="input" value={a.learnerName} placeholder="optional" onChange={(e) => set({ learnerName: e.target.value })} />
        <label>Tutor language</label>
        <input className="input" value={a.language} placeholder="e.g. English, Deutsch (default: the language you write in)" onChange={(e) => set({ language: e.target.value })} />
        <label>Question style</label>
        <select className="input" value={a.quizStyle} onChange={(e) => set({ quizStyle: e.target.value as Settings['agent']['quizStyle'] })}>
          <option value="mixed">Mixed (multiple choice + explain in your own words)</option>
          <option value="choice">Mostly multiple choice</option>
          <option value="recall">Mostly free recall</option>
        </select>
        <label>Run code</label>
        <label className="toggle">
          <input type="checkbox" checked={a.allowRunCode} onChange={(e) => set({ allowRunCode: e.target.checked })} />
          Let the tutor run your code to check it
        </label>
        <label>Workspaces folder</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={s.workspaceRoot} onChange={(e) => update({ workspaceRoot: e.target.value })} />
          <button
            className="btn small"
            onClick={async () => {
              const f = await api.pickFolder()
              if (f) update({ workspaceRoot: f })
            }}
          >
            <Icon name="folder" size={12} /> Browse
          </button>
        </div>
      </div>
    </div>
  )
}

function EditorTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const e = s.editor
  const set = (patch: Partial<Settings['editor']>) => update({ editor: { ...e, ...patch } })
  const [extra, setExtra] = useState(e.extraExtras.join('\n'))
  return (
    <>
      <div className="section">
        <h2>Editor</h2>
        <div className="form-grid">
          <label>Editor</label>
          <select className="input" value={e.mode} onChange={(ev) => set({ mode: ev.target.value as Settings['editor']['mode'] })}>
            <option value="neovim">Neovim + LazyVim (recommended)</option>
            <option value="builtin">Built-in editor with Vim keybindings (no install needed)</option>
          </select>
          <label>Neovim config</label>
          <select className="input" value={e.config} onChange={(ev) => set({ config: ev.target.value as Settings['editor']['config'] })}>
            <option value="lazyvim">Bundled LazyVim (isolated, tutor integration built in)</option>
            <option value="user">My own Neovim config (tutor keymaps injected)</option>
          </select>
          <label>nvim executable</label>
          <input className="input" value={e.nvimPath} placeholder="nvim (from PATH)" onChange={(ev) => set({ nvimPath: ev.target.value })} />
          <label>Font size</label>
          <input className="input" type="number" min={9} max={28} value={e.fontSize} onChange={(ev) => set({ fontSize: Math.max(9, Math.min(28, Number(ev.target.value) || 14)) })} />
        </div>
      </div>
      <div className="section">
        <h2>LazyVim extras</h2>
        <p className="help" style={{ marginTop: -6 }}>
          Always enabled: {BASE_LAZY_EXTRAS.join(', ')}. Language extras (LSP, treesitter, formatter, debugger) are added automatically for every language you study.
        </p>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <label>Additional extras</label>
          <textarea
            className="input"
            rows={4}
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
            placeholder={'one per line, e.g.\nlang.docker\nai.copilot'}
            value={extra}
            onChange={(ev) => setExtra(ev.target.value)}
            onBlur={() =>
              set({
                extraExtras: extra
                  .split(/\s+/)
                  .map((x) => x.trim().replace(/^lazyvim\.plugins\.extras\./, ''))
                  .filter(Boolean)
              })
            }
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={() => api.openNvimConfig()}>
            <Icon name="folder" size={13} /> Open config folder
          </button>
          <button
            className="btn"
            onClick={async () => {
              if (!confirm('Restore the bundled LazyVim config? Your changes to the AnythingEditor nvim config will be overwritten (plugins stay installed).')) return
              await api.resetNvimConfig().then(() => toast('Config restored'), (err) => toast(err.message, 'error'))
            }}
          >
            <Icon name="refresh" size={13} /> Restore bundled config
          </button>
        </div>
      </div>
      <div className="section">
        <h2>Tutor keymaps (Neovim)</h2>
        <div className="form-grid help" style={{ gridTemplateColumns: '150px 1fr' }}>
          <code>&lt;Space&gt;as</code> <span>Submit the current exercise</span>
          <code>&lt;Space&gt;ar</code> <span>Run the current file</span>
          <code>&lt;Space&gt;aa</code> <span>Ask the tutor about the selection / current line (visual mode works)</span>
          <code>&lt;Space&gt;ae</code> <span>Explain the error under the cursor</span>
          <code>&lt;Space&gt;</code> <span>Everything else is stock LazyVim — press Space and wait for which-key</span>
        </div>
      </div>
    </>
  )
}

function DoctorTab() {
  const [items, setItems] = useState<DoctorItem[] | null>(null)
  const [toolchains, setToolchains] = useState<DoctorItem[]>([])
  const [log, setLog] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const consoleRef = useRef<HTMLDivElement>(null)

  const refresh = async () => {
    setItems(null)
    await api.refreshPath().catch(() => {})
    const [d, t] = await Promise.all([api.doctor(), api.toolchains()])
    setItems(d)
    setToolchains(t.filter((x) => !d.some((y) => y.id === x.id)))
  }
  useEffect(() => {
    refresh()
    return on('doctor:output', (s: string) => setLog((l) => (l + s).slice(-40000)))
  }, [])
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [log])

  const install = async (it: DoctorItem) => {
    if (!it.install) return
    if (it.install.kind === 'url') return api.openExternal(it.install.value)
    setBusy(it.id)
    try {
      const r = await api.install(it.install)
      toast(r.ok ? `${it.name} installed` : `${it.name}: installer exited with ${r.code}`, r.ok ? 'info' : 'error')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const row = (it: DoctorItem) => (
    <div key={it.id} className="doctor-row">
      <span className={`state ${it.found ? 'ok' : it.optional ? 'optional' : 'missing'}`}>{it.found ? '✓' : it.optional ? '!' : '✗'}</span>
      <div className="info">
        <div className="name">
          {it.name} {it.version && <span className="help">· {it.version}</span>}
        </div>
        <div className="purpose">{it.purpose}</div>
        {it.path && <div className="path">{it.path}</div>}
      </div>
      {!it.found && it.install && (
        <button className="btn small" disabled={!!busy} onClick={() => install(it)} title={it.install.label}>
          {busy === it.id ? <span className="spinner" /> : <Icon name={it.install.kind === 'url' ? 'external' : 'plus'} size={12} />} {it.install.kind === 'url' ? 'Download' : it.install.kind === 'shell' ? 'Run' : 'Install'}
        </button>
      )}
    </div>
  )

  return (
    <>
      <div className="section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Environment</h2>
          <button className="btn small" onClick={refresh}>
            <Icon name="refresh" size={12} /> Re-check
          </button>
        </div>
        {!items && (
          <div className="help">
            <span className="spinner" /> Checking…
          </div>
        )}
        {items?.map(row)}
      </div>
      {toolchains.length > 0 && (
        <div className="section">
          <h2>Other language toolchains</h2>
          {toolchains.map(row)}
        </div>
      )}
      {log && (
        <div className="section">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>Installer output</h2>
            <button className="btn small ghost" onClick={() => setLog('')}>
              Clear
            </button>
          </div>
          <div className="console" ref={consoleRef}>
            {log}
          </div>
        </div>
      )}
    </>
  )
}

function AboutTab() {
  const [info, setInfo] = useState<{ version: string; platform: string; dataDir: string; nvimConfig: string } | null>(null)
  useEffect(() => {
    api.appInfo().then(setInfo)
  }, [])
  return (
    <div className="section">
      <h2>AnythingEditor {info?.version}</h2>
      <p className="help" style={{ fontSize: 13 }}>
        Learn any programming language with an AI tutor that measures what you know, plans a minimal path to your goal, teaches one step at a time, and remembers what you've learned across sessions. Inspired by the teaching algorithms of LearnHarness.
      </p>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <label>Data folder</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <code className="input" style={{ fontSize: 12 }}>
            {info?.dataDir}
          </code>
          <button className="btn small" onClick={() => info && api.openPath(info.dataDir)}>
            <Icon name="folder" size={12} />
          </button>
        </div>
        <label>Neovim config</label>
        <code className="input" style={{ fontSize: 12 }}>
          {info?.nvimConfig}
        </code>
        <label>Platform</label>
        <span>{info?.platform}</span>
        <label>Languages</label>
        <span className="help">{LANGUAGES.map((l) => l.name).join(', ')} — and anything else you ask for.</span>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'providers', label: 'Models' },
  { id: 'agent', label: 'Tutor' },
  { id: 'editor', label: 'Editor' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'about', label: 'About' }
]

export function SettingsPage({ initialTab }: { initialTab?: string }) {
  const stored = useStore((st) => st.settings)
  const [tab, setTab] = useState(initialTab ?? 'providers')
  const [s, setS] = useState<Settings | null>(stored)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef<Settings | null>(stored)

  useEffect(() => setTab(initialTab ?? 'providers'), [initialTab])
  useEffect(() => {
    if (!s && stored) {
      setS(stored)
      latest.current = stored
    }
  }, [stored, s])

  const flush = async () => {
    window.clearTimeout(timer.current)
    if (!latest.current) return
    try {
      const saved = await api.saveSettings(latest.current)
      setState({ settings: saved })
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }
  useEffect(
    () => () => {
      flush()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const update = (patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...(prev as Settings), ...patch }
      latest.current = next
      return next
    })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 600)
  }

  if (!s) return <div className="empty">Loading…</div>
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ flex: 1 }}>Settings</h1>
        <button className="btn ghost" onClick={() => flush().then(() => navigate({ kind: 'home' }))}>
          <Icon name="x" size={14} /> Close
        </button>
      </div>
      <div className="lead">Changes are saved automatically.</div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'providers' && <ProvidersTab s={s} update={update} />}
      {tab === 'agent' && <AgentTab s={s} update={update} />}
      {tab === 'editor' && <EditorTab s={s} update={update} />}
      {tab === 'doctor' && <DoctorTab />}
      {tab === 'about' && <AboutTab />}
    </div>
  )
}
