import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlanNode } from '../src/shared/types'
import { layout, orderPlan } from '../src/renderer/src/lib/logic'


const node = (id: string, dependsOn: string[] = []): PlanNode => ({ id, title: id, dependsOn, status: 'todo' })

test('orderPlan puts dependencies before dependents and survives cycles', () => {
  const out = orderPlan([node('c', ['b']), node('a'), node('b', ['a']), node('d', ['a', 'c'])]).map((n) => n.id)
  assert.deepEqual(out, ['a', 'b', 'c', 'd'])
  const cyc = orderPlan([node('x', ['y']), node('y', ['x'])]).map((n) => n.id)
  assert.deepEqual(cyc.sort(), ['x', 'y'])
  assert.deepEqual(orderPlan([node('a', ['missing'])]).map((n) => n.id), ['a'])
})

test('graph layout is deterministic, finite and keeps linked nodes closer', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const edges: [string, string][] = [['a', 'b'], ['b', 'c']]
  const p1 = layout(ids, edges, 200)
  const p2 = layout(ids, edges, 200)
  assert.deepEqual([...p1.entries()], [...p2.entries()])
  for (const v of p1.values()) assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y))
  const d = (a: string, b: string) => Math.hypot(p1.get(a)!.x - p1.get(b)!.x, p1.get(a)!.y - p1.get(b)!.y)
  assert.ok(d('a', 'b') < d('a', 'f'), 'linked nodes should be closer than unrelated ones')
  assert.equal(layout([], []).size, 0)
})
