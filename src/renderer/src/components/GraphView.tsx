import { useEffect, useMemo, useRef, useState } from 'react'
import type { Evidence, GraphSnapshot } from '@shared/types'
import { languageInfo } from '@shared/languages'
import { api } from '../api'
import { navigate, toast, useStore } from '../store'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { layout, OUTCOME_COLOR } from '../lib/logic'

export function GraphView() {
  const sessions = useStore((s) => s.sessions)
  const [g, setG] = useState<GraphSnapshot | null>(null)
  const [lang, setLang] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, s: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const load = () =>
    api
      .graph()
      .then(setG)
      .catch((e) => toast(e.message, 'error'))
  useEffect(() => {
    load()
  }, [])

  const languages = useMemo(() => [...new Set((g?.nodes ?? []).map((n) => n.language))].sort(), [g])
  const nodes = useMemo(() => (g?.nodes ?? []).filter((n) => lang === 'all' || n.language === lang), [g, lang])
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
  const edges = useMemo(() => {
    const out: [string, string][] = []
    for (const c of g?.chains ?? []) for (const p of c.premises) if (nodeIds.has(p) && nodeIds.has(c.conclusion)) out.push([p, c.conclusion])
    return out
  }, [g, nodeIds])
  const pos = useMemo(() => layout(nodes.map((n) => n.id), edges), [nodes, edges])
  const latestOutcome = useMemo(() => {
    const m = new Map<string, Evidence>()
    for (const e of g?.evidence ?? []) if (e.propositionId) m.set(e.propositionId, e)
    return m
  }, [g])
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const [a, b] of edges) {
      d.set(a, (d.get(a) ?? 0) + 1)
      d.set(b, (d.get(b) ?? 0) + 1)
    }
    return d
  }, [edges])
  const q = query.trim().toLowerCase()
  const matches = (id: string) => {
    if (!q) return true
    const n = nodes.find((x) => x.id === id)
    return !!n && (n.name.toLowerCase().includes(q) || n.statement.toLowerCase().includes(q) || n.aliases.some((a) => a.toLowerCase().includes(q)))
  }

  // Fit the view when the node set changes.
  useEffect(() => {
    const el = svgRef.current
    if (!el || pos.size === 0) return
    const xs = [...pos.values()].map((p) => p.x)
    const ys = [...pos.values()].map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs) + 160
    const h = Math.max(...ys) - Math.min(...ys) + 160
    const r = el.getBoundingClientRect()
    const s = Math.min(1.6, Math.max(0.2, Math.min(r.width / w, r.height / h)))
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    setView({ s, x: r.width / 2 - cx * s, y: r.height / 2 - cy * s })
  }, [pos])

  const sel = selected ? g?.nodes.find((n) => n.id === selected) : undefined
  const selEvidence = (g?.evidence ?? []).filter((e) => e.propositionId === selected).slice(-8).reverse()
  const neighbors = selected ? edges.filter(([a, b]) => a === selected || b === selected) : []
  const evidenceByOutcome = (g?.evidence ?? []).reduce<Record<string, number>>((acc, e) => ((acc[e.outcome] = (acc[e.outcome] ?? 0) + 1), acc), {})
  const sessionTitle = (id: string) => sessions.find((s) => s.id === id)?.title

  return (
    <div className="graph-page">
      <div className="graph-canvas">
        <div className="graph-toolbar">
          <input className="input" style={{ width: 220 }} placeholder="Search concepts…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input" style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="all">All languages</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageInfo(l).name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={load} title="Reload">
            <Icon name="refresh" size={12} />
          </button>
        </div>
        {g && nodes.length === 0 ? (
          <div className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <div>
              <Icon name="brain" size={34} />
              <div style={{ marginTop: 10 }}>Your knowledge graph is empty.</div>
              <div className="help">After each session, the ideas you worked on are extracted here — and future sessions use them to know where you stand.</div>
            </div>
          </div>
        ) : (
          <svg
            ref={svgRef}
            onWheel={(e) => {
              const r = svgRef.current!.getBoundingClientRect()
              const mx = e.clientX - r.left
              const my = e.clientY - r.top
              const f = Math.exp(-e.deltaY * 0.0015)
              setView((v) => {
                const s = Math.min(4, Math.max(0.1, v.s * f))
                const k = s / v.s
                return { s, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
              })
            }}
            onMouseDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
            }}
            onMouseMove={(e) => {
              const d = drag.current
              if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
            }}
            onMouseUp={() => (drag.current = null)}
            onMouseLeave={() => (drag.current = null)}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b4261" />
              </marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.s})`}>
              {edges.map(([a, b], i) => {
                const pa = pos.get(a)!
                const pb = pos.get(b)!
                const dx = pb.x - pa.x
                const dy = pb.y - pa.y
                const d = Math.sqrt(dx * dx + dy * dy) || 1
                const r = 9 + Math.min(6, degree.get(b) ?? 0)
                const hl = selected && (a === selected || b === selected)
                return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x - (dx / d) * (r + 2)} y2={pb.y - (dy / d) * (r + 2)} stroke={hl ? '#7aa2f7' : '#2f3549'} strokeWidth={hl ? 2 : 1.2} markerEnd="url(#arrow)" />
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id)!
                const r = 7 + Math.min(6, degree.get(n.id) ?? 0)
                const ev = latestOutcome.get(n.id)
                const dim = !matches(n.id)
                const isSel = n.id === selected
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: 'pointer', opacity: dim ? 0.18 : 1 }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setSelected(isSel ? null : n.id)}
                  >
                    <circle r={r + 3} fill="none" stroke={ev ? OUTCOME_COLOR[ev.outcome] : 'transparent'} strokeWidth={2} />
                    <circle r={r} fill={languageInfo(n.language).color} stroke={isSel ? '#c0caf5' : '#1a1b26'} strokeWidth={isSel ? 2.5 : 1.5} />
                    {(view.s > 0.55 || isSel || (q && !dim)) && (
                      <text y={r + 14} textAnchor="middle" fontSize={11} fill={isSel ? '#c0caf5' : '#a9b1d6'} style={{ pointerEvents: 'none', paintOrder: 'stroke' }} stroke="#1a1b26" strokeWidth={3}>
                        {n.name.length > 34 ? n.name.slice(0, 32) + '…' : n.name}
                      </text>
                    )}
                    <title>{n.statement}</title>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>
      <div className="graph-side">
        {!sel ? (
          <>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Knowledge graph</h2>
            <p className="help">Ideas you have worked on, and which ideas build on which. Rings show your latest result on that idea.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
              <div className="stat">
                <b>{g?.nodes.length ?? '–'}</b>
                <span>concepts</span>
              </div>
              <div className="stat">
                <b>{g?.chains.length ?? '–'}</b>
                <span>derivations</span>
              </div>
              <div className="stat">
                <b>{languages.length}</b>
                <span>languages</span>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              {(Object.keys(OUTCOME_COLOR) as Evidence['outcome'][]).map((o) => (
                <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${OUTCOME_COLOR[o]}` }} />
                  <span style={{ flex: 1, textTransform: 'capitalize' }}>{o}</span>
                  <span className="help">{evidenceByOutcome[o] ?? 0}</span>
                </div>
              ))}
            </div>
            <h3 style={{ fontSize: 13, marginTop: 22 }}>Recent observations</h3>
            {(g?.evidence ?? [])
              .slice(-12)
              .reverse()
              .map((e, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: OUTCOME_COLOR[e.outcome], fontWeight: 600 }}>{e.outcome}</span> · {e.topic}
                  <div className="help">{e.note}</div>
                </div>
              ))}
            {(g?.evidence.length ?? 0) === 0 && <div className="help">None yet.</div>}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="lang-dot" style={{ background: languageInfo(sel.language).color }} />
              <span className="help" style={{ flex: 1 }}>
                {languageInfo(sel.language).name}
              </span>
              <button className="icon-btn" onClick={() => setSelected(null)}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <h2 style={{ fontSize: 17, margin: '8px 0' }}>{sel.name}</h2>
            <div className="md" style={{ fontSize: 13.5 }}>
              <Markdown text={sel.statement} />
            </div>
            {sel.aliases.length > 0 && <div className="help">Also: {sel.aliases.join(', ')}</div>}
            {neighbors.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, marginTop: 18 }}>Connections</h3>
                {neighbors.map(([a, b], i) => {
                  const other = a === selected ? b : a
                  const n = g?.nodes.find((x) => x.id === other)
                  return (
                    <div key={i} className="session-item" style={{ fontSize: 12.5 }} onClick={() => setSelected(other)}>
                      <span className="help">{a === selected ? 'leads to →' : '← builds on'}</span> {n?.name}
                    </div>
                  )
                })}
              </>
            )}
            {selEvidence.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, marginTop: 18 }}>Your results</h3>
                {selEvidence.map((e, i) => (
                  <div key={i} style={{ fontSize: 12.5, padding: '5px 0' }}>
                    <span style={{ color: OUTCOME_COLOR[e.outcome], fontWeight: 600 }}>{e.outcome}</span> <span className="help">· {new Date(e.at).toLocaleDateString()}</span>
                    <div className="help">{e.note}</div>
                  </div>
                ))}
              </>
            )}
            <h3 style={{ fontSize: 13, marginTop: 18 }}>Sessions</h3>
            {sel.sessions.map((sid) => (
              <div key={sid} className="session-item" style={{ fontSize: 12.5 }} onClick={() => sessionTitle(sid) && navigate({ kind: 'session', id: sid })}>
                <Icon name="book" size={12} /> {sessionTitle(sid) ?? <span className="help">deleted session</span>}
              </div>
            ))}
            <button
              className="btn small danger"
              style={{ marginTop: 22 }}
              onClick={async () => {
                if (!confirm(`Remove “${sel.name}” from your knowledge graph?`)) return
                await api.deleteNode(sel.id).catch((e) => toast(e.message, 'error'))
                setSelected(null)
                load()
              }}
            >
              <Icon name="trash" size={12} /> Remove concept
            </button>
          </>
        )}
      </div>
    </div>
  )
}
