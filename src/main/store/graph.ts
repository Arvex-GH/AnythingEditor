/**
 * The persistent knowledge graph (adapted from LearnHarness):
 *  - propositions (nodes): self-contained TRUE statements about a language/concept
 *  - chains: premises that jointly entail a conclusion (the reasoning structure)
 *  - evidence: what the learner demonstrated / struggled with (kept separate from
 *    the graph so the graph stays a map of ideas, not ratings)
 *
 * Storage is append-only JSONL ledgers; reads merge repeated lines by id so a
 * re-encountered proposition unions its aliases and provenance.
 */
import { writeFileSync } from 'node:fs'
import type { Evidence, GraphChain, GraphNode, GraphSnapshot } from '@shared/types'
import { dataPath, ensureDir } from '../paths'
import { appendJsonl, readJsonl, nowIso } from './fsutil'

const nodesFile = () => (ensureDir(dataPath('graph')), dataPath('graph', 'nodes.jsonl'))
const chainsFile = () => (ensureDir(dataPath('graph')), dataPath('graph', 'chains.jsonl'))
const evidenceFile = () => (ensureDir(dataPath('graph')), dataPath('graph', 'evidence.jsonl'))

function rid(prefix: string): string {
  return prefix + Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}

function chainKey(premises: string[], conclusion: string): string {
  return `${[...premises].sort().join('+')}>${conclusion}`
}

export function getGraph(): GraphSnapshot {
  const nodes = new Map<string, GraphNode>()
  for (const line of readJsonl<GraphNode & { deleted?: boolean }>(nodesFile())) {
    if (line.deleted) {
      nodes.delete(line.id)
      continue
    }
    const prev = nodes.get(line.id)
    if (!prev) nodes.set(line.id, { ...line, aliases: line.aliases ?? [], sessions: line.sessions ?? [] })
    else {
      nodes.set(line.id, {
        ...prev,
        statement: line.statement || prev.statement,
        name: prev.name,
        aliases: [...new Set([...prev.aliases, ...(line.aliases ?? []), ...(line.name !== prev.name ? [line.name] : [])])],
        sessions: [...new Set([...prev.sessions, ...(line.sessions ?? [])])],
        updatedAt: line.updatedAt ?? prev.updatedAt
      })
    }
  }
  const chains = new Map<string, GraphChain>()
  for (const c of readJsonl<GraphChain & { deleted?: boolean }>(chainsFile())) {
    if (c.deleted) {
      chains.delete(c.id)
      continue
    }
    if (!c.premises.every((p) => nodes.has(p)) || !nodes.has(c.conclusion)) continue
    const key = chainKey(c.premises, c.conclusion)
    const prev = chains.get(key)
    if (prev) prev.sessions = [...new Set([...prev.sessions, ...c.sessions])]
    else chains.set(key, { ...c })
  }
  return { nodes: [...nodes.values()], chains: [...chains.values()], evidence: readJsonl<Evidence>(evidenceFile()) }
}

export interface Findings {
  propositions: { id: string; name: string; statement: string }[]
  chains: { premises: string[]; conclusion: string }[]
  evidence: { topic: string; propositionId?: string; outcome: Evidence['outcome']; note: string }[]
}

/**
 * Deterministic merger: the LLM supplies the judgement (what the ideas are,
 * which existing id a proposition IS), this code owns ids, timestamps and
 * provenance.
 */
export function mergeFindings(f: Findings, sessionId: string, language: string): { added: number; linked: number; chains: number } {
  const graph = getGraph()
  const existing = new Map(graph.nodes.map((n) => [n.id, n]))
  const idMap = new Map<string, string>()
  const now = nowIso()
  const nodeLines: GraphNode[] = []
  let added = 0
  let linked = 0
  for (const p of f.propositions ?? []) {
    if (!p || !p.id) continue
    const ex = existing.get(p.id)
    if (ex) {
      idMap.set(p.id, ex.id)
      if (!ex.sessions.includes(sessionId) || (p.name && p.name !== ex.name)) {
        nodeLines.push({ ...ex, name: p.name || ex.name, statement: '', aliases: p.name && p.name !== ex.name ? [p.name] : [], sessions: [sessionId], updatedAt: now })
        linked++
      }
      continue
    }
    if (!p.name || !p.statement) continue
    // Exact-name dedupe within the same language as a safety net.
    const dup = graph.nodes.find((n) => n.language === language && n.name.toLowerCase() === p.name.toLowerCase())
    if (dup) {
      idMap.set(p.id, dup.id)
      nodeLines.push({ ...dup, statement: '', aliases: [], sessions: [sessionId], updatedAt: now })
      linked++
      continue
    }
    const id = rid('n_')
    idMap.set(p.id, id)
    nodeLines.push({ id, name: p.name.trim(), statement: p.statement.trim(), language, aliases: [], sessions: [sessionId], createdAt: now, updatedAt: now })
    added++
  }
  appendJsonl(nodesFile(), nodeLines)

  const known = new Set([...existing.keys(), ...nodeLines.map((n) => n.id)])
  const seen = new Set(graph.chains.map((c) => chainKey(c.premises, c.conclusion)))
  const chainLines: GraphChain[] = []
  for (const c of f.chains ?? []) {
    const premises = (c.premises ?? []).map((p) => idMap.get(p) ?? p).filter((p) => known.has(p))
    const conclusion = idMap.get(c.conclusion) ?? c.conclusion
    if (!known.has(conclusion) || premises.length === 0 || premises.includes(conclusion)) continue
    const key = chainKey(premises, conclusion)
    if (seen.has(key)) continue
    seen.add(key)
    chainLines.push({ id: rid('arg_'), premises, conclusion, sessions: [sessionId], createdAt: now })
  }
  appendJsonl(chainsFile(), chainLines)

  const ev: Evidence[] = (f.evidence ?? [])
    .filter((e) => e && e.topic && e.outcome)
    .map((e) => ({
      at: now,
      sessionId,
      language,
      topic: e.topic,
      propositionId: e.propositionId ? (idMap.get(e.propositionId) ?? (known.has(e.propositionId) ? e.propositionId : undefined)) : undefined,
      outcome: e.outcome,
      note: e.note ?? ''
    }))
  appendJsonl(evidenceFile(), ev)
  return { added, linked, chains: chainLines.length }
}

export function deleteNode(id: string): void {
  appendJsonl(nodesFile(), [{ id, deleted: true }])
}

export function forgetSession(sessionId: string): void {
  // Remove evidence of a deleted session; graph nodes keep their provenance.
  const ev = readJsonl<Evidence>(evidenceFile()).filter((e) => e.sessionId !== sessionId)
  writeFileSync(evidenceFile(), ev.map((e) => JSON.stringify(e)).join('\n') + (ev.length ? '\n' : ''))
}

// ─── lexical candidate search (the auditor's lookup, simplified) ───────────

const STOP = new Set('the a an and or of to in is are be for on with as by it that this from at into its can not no you your we use used using when then than which what how why'.split(' '))

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_#+]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t))
}

export function searchNodes(query: string, opts: { language?: string; limit?: number } = {}): GraphNode[] {
  const q = new Set(tokens(query))
  if (q.size === 0) return []
  const graph = getGraph()
  const df = new Map<string, number>()
  const docs = graph.nodes
    .filter((n) => !opts.language || n.language === opts.language)
    .map((n) => {
      const toks = new Set(tokens(`${n.name} ${n.name} ${n.statement} ${n.aliases.join(' ')}`))
      for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1)
      return { n, toks }
    })
  const N = docs.length || 1
  return docs
    .map(({ n, toks }) => {
      let score = 0
      for (const t of q) if (toks.has(t)) score += Math.log(1 + N / (df.get(t) ?? 1))
      return { n, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 15)
    .map((x) => x.n)
}
