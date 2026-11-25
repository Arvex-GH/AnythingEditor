import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ANYTHING_DATA_DIR = mkdtempSync(join(tmpdir(), 'ae-tools-'))
let t: typeof import('../src/main/agent/tools')
before(async () => {
  t = await import('../src/main/agent/tools')
})

const names = (phase: Parameters<typeof t.toolsForPhase>[0]) => t.toolsForPhase(phase).map((s) => s.function.name)

test('each phase exposes the right tools', () => {
  assert.ok(names('probe').includes('probe_done'))
  assert.ok(!names('probe').includes('plan_init'))
  for (const p of ['teach', 'project'] as const) {
    assert.ok(names(p).includes('plan_init'))
    assert.ok(!names(p).includes('probe_done'))
  }
  for (const p of ['probe', 'teach', 'project', 'practice'] as const) {
    for (const n of ['quiz', 'ask_user_question', 'assign_exercise', 'write_file', 'read_file', 'get_learner_profile']) assert.ok(names(p).includes(n), `${p} lacks ${n}`)
  }
})

test('tool specs are valid JSON-schema objects', () => {
  for (const s of t.toolsForPhase('teach').concat(t.toolsForPhase('probe'))) {
    assert.equal(s.type, 'function')
    assert.match(s.function.name, /^[a-z_]+$/)
    assert.ok(s.function.description && s.function.description.length > 10)
    assert.equal((s.function.parameters as any).type, 'object')
  }
})

test('validateInteraction rejects malformed interactions', () => {
  assert.equal(t.validateInteraction('quiz', { question: 'q', options: ['a', 'b'], correctIndex: 1 }), null)
  assert.match(t.validateInteraction('quiz', { question: 'q', options: ['a', 'b'], correctIndex: 2 })!, /correctIndex/)
  assert.match(t.validateInteraction('quiz', { question: 'q', options: ['a'] })!, /2 options/)
  assert.equal(t.validateInteraction('quiz', { kind: 'recall', question: 'q', correctAnswer: 'x' }), null)
  assert.match(t.validateInteraction('quiz', { kind: 'recall', question: 'q' })!, /correctAnswer/)
  assert.equal(t.validateInteraction('ask_user_question', { question: 'Which?' }), null)
  assert.ok(t.validateInteraction('assign_exercise', { title: 't' }))
  assert.ok(t.validateInteraction('assign_exercise', { title: 't', instructions: 'i', files: [{ path: 'a' }] }))
  assert.equal(t.validateInteraction('assign_exercise', { title: 't', instructions: 'i', files: [{ path: 'a.rs', content: '' }] }), null)
  assert.equal(t.INTERACTION_TOOLS.has('quiz'), true)
})
