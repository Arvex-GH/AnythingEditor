// Pure UI logic (no DOM / React) so it can be unit tested in Node.
import type { Evidence, PlanNode } from '@shared/types'

/** Topologically order plan nodes so dependencies come first (stable for ties). */
export function orderPlan(nodes: PlanNode[]): PlanNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: PlanNode[] = []
  const visit = (n: PlanNode, stack: Set<string>) => {
    if (seen.has(n.id) || stack.has(n.id)) return
    stack.add(n.id)
    for (const d of n.dependsOn ?? []) {
      const dn = byId.get(d)
      if (dn) visit(dn, stack)
    }
    stack.delete(n.id)
    seen.add(n.id)
    out.push(n)
  }
  for (const n of nodes) visit(n, new Set())
  return out
}

interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export const OUTCOME_COLOR: Record<Evidence['outcome'], string> = {
  demonstrated: '#9ece6a',
  shaky: '#e0af68',
  gap: '#f7768e',
  misconception: '#bb9af7'
}

/** Small deterministic force layout (no dependency, fine for a few hundred nodes). */
export function layout(ids: string[], edges: [string, string][], iterations = 300): Map<string, { x: number; y: number }> {
  const n = ids.length
  const nodes: SimNode[] = ids.map((id, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2
    const r = 60 + 14 * Math.sqrt(n) * ((i % 7) / 7 + 0.5)
    return { id, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 }
  })
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]))
  const E = edges.map(([a, b]) => [idx.get(a), idx.get(b)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1])
  const k = 70
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = 0.1 * (i - j)
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        if (d2 > 250000) continue
        const f = (k * k) / d2
        a.vx += dx * f * 0.05
        a.vy += dy * f * 0.05
        b.vx -= dx * f * 0.05
        b.vy -= dy * f * 0.05
      }
    }
    for (const [i, j] of E) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = ((d - k) / d) * 0.06
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }
    for (const nd of nodes) {
      nd.vx -= nd.x * 0.004
      nd.vy -= nd.y * 0.004
      const sp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
      const max = 18 * t + 0.5
      if (sp > max) {
        nd.vx = (nd.vx / sp) * max
        nd.vy = (nd.vy / sp) * max
      }
      nd.x += nd.vx
      nd.y += nd.vy
      nd.vx *= 0.6
      nd.vy *= 0.6
    }
  }
  return new Map(nodes.map((nd) => [nd.id, { x: nd.x, y: nd.y }]))
}
