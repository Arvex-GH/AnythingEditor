import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ANYTHING_DATA_DIR = mkdtempSync(join(tmpdir(), 'ae-graph-'))
let g: typeof import('../src/main/store/graph')
before(async () => {
  g = await import('../src/main/store/graph')
})

test('mergeFindings creates nodes, chains and evidence with fresh ids', () => {
  const r = g.mergeFindings(
    {
      propositions: [
        { id: 'p1', name: 'Ownership moves', statement: 'Assigning a non-Copy value moves ownership.' },
        { id: 'p2', name: 'Borrowing', statement: 'A reference borrows without taking ownership.' }
      ],
      chains: [{ premises: ['p1'], conclusion: 'p2' }],
      evidence: [{ topic: 'moves', propositionId: 'p1', outcome: 'shaky', note: 'confused clone with move' }]
    },
    's1',
    'rust'
  )
  assert.deepEqual(r, { added: 2, linked: 0, chains: 1 })
  const snap = g.getGraph()
  assert.equal(snap.nodes.length, 2)
  for (const n of snap.nodes) assert.match(n.id, /^n_[0-9a-f]{12}$/)
  assert.equal(snap.chains.length, 1)
  assert.match(snap.chains[0].id, /^arg_/)
  const own = snap.nodes.find((n) => n.name === 'Ownership moves')!
  assert.equal(snap.evidence[0].propositionId, own.id)
})

test('mergeFindings links existing ids and dedupes names and chains', () => {
  const before = g.getGraph()
  const own = before.nodes.find((n) => n.name === 'Ownership moves')!
  const bor = before.nodes.find((n) => n.name === 'Borrowing')!
  const r = g.mergeFindings(
    {
      propositions: [
        { id: own.id, name: 'Ownership moves', statement: '' },
        { id: 'tmp', name: 'borrowing', statement: 'dup by name' }
      ],
      chains: [{ premises: [own.id], conclusion: 'tmp' }],
      evidence: []
    },
    's2',
    'rust'
  )
  assert.equal(r.added, 0)
  assert.equal(r.linked, 2)
  assert.equal(r.chains, 0, 'same premise→conclusion chain must not be duplicated')
  const after = g.getGraph()
  assert.equal(after.nodes.length, 2)
  const own2 = after.nodes.find((n) => n.id === own.id)!
  assert.deepEqual(own2.sessions.sort(), ['s1', 's2'])
  assert.equal(own2.statement, own.statement, 'statement must survive a link line')
  assert.ok(after.nodes.find((n) => n.id === bor.id)!.sessions.includes('s2'))
})

test('searchNodes ranks lexical matches and deleteNode hides nodes', () => {
  const hits = g.searchNodes('reference borrow', { language: 'rust' })
  assert.equal(hits[0]?.name, 'Borrowing')
  assert.equal(g.searchNodes('borrow', { language: 'python' }).length, 0)
  g.deleteNode(hits[0].id)
  assert.equal(g.getGraph().nodes.some((n) => n.id === hits[0].id), false)
})

test('forgetSession removes that session\'s evidence', () => {
  assert.ok(g.getGraph().evidence.some((e) => e.sessionId === 's1'))
  g.forgetSession('s1')
  assert.equal(g.getGraph().evidence.some((e) => e.sessionId === 's1'), false)
})
