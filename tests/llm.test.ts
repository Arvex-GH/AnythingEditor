import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endpoint, parseArgs } from '../src/main/agent/llm'

test('endpoint normalizes base URLs', () => {
  assert.equal(endpoint('https://api.openai.com/v1', '/chat/completions'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(endpoint('https://api.openai.com/v1/', '/models'), 'https://api.openai.com/v1/models')
  assert.equal(endpoint('http://localhost:11434/v1/chat/completions', '/chat/completions'), 'http://localhost:11434/v1/chat/completions')
})

test('parseArgs is lenient with model output', () => {
  assert.deepEqual(parseArgs(''), {})
  assert.deepEqual(parseArgs('{"a":1}'), { a: 1 })
  assert.deepEqual(parseArgs('```json\n{"path":"main.rs"}\n```'), { path: 'main.rs' })
  assert.deepEqual(parseArgs('Sure! {"x": [1,2]} done'), { x: [1, 2] })
})
