import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, findLanguage, languageForFile, languageInfo, LANGUAGES } from '../src/shared/languages'

test('findLanguage resolves ids, names and aliases', () => {
  assert.equal(findLanguage('rust')?.id, 'rust')
  assert.equal(findLanguage('C#')?.id, 'csharp')
  assert.equal(findLanguage('dotnet')?.id, 'csharp')
  assert.equal(findLanguage('py')?.id, 'python')
  assert.equal(findLanguage('golang')?.id, 'go')
  assert.equal(findLanguage('klingon'), undefined)
  assert.equal(findLanguage(''), undefined)
})

test('detectLanguage finds languages in free text', () => {
  assert.equal(detectLanguage('I want to learn Rust ownership')?.id, 'rust')
  assert.equal(detectLanguage('teach me C# please')?.id, 'csharp')
  assert.equal(detectLanguage('Build a CLI in C++')?.id, 'cpp')
  assert.equal(detectLanguage('pointers in C')?.id, 'c')
  assert.equal(detectLanguage('async python generators')?.id, 'python')
  assert.equal(detectLanguage('TypeScript generics')?.id, 'typescript')
  assert.equal(detectLanguage('I want to go home and learn to cook'), findLanguage('go'))
  assert.equal(detectLanguage('how do closures work'), undefined)
})

test('languageForFile maps extensions', () => {
  assert.equal(languageForFile('src/main.rs')?.id, 'rust')
  assert.equal(languageForFile('C:\\x\\Program.CS')?.id, 'csharp')
  assert.equal(languageForFile('a/b/main.py')?.id, 'python')
  assert.equal(languageForFile('notes.unknownext'), undefined)
})

test('language table is well formed', () => {
  const ids = new Set<string>()
  for (const l of LANGUAGES) {
    assert.ok(!ids.has(l.id), `duplicate id ${l.id}`)
    ids.add(l.id)
    assert.match(l.color, /^#[0-9a-f]{6}$/i)
    assert.ok(l.mainFile.length > 0)
    for (const e of l.lazyExtras) assert.match(e, /^[a-z]+\.[a-z0-9_.-]+$/)
  }
  assert.equal(languageInfo('nonexistent').id, 'nonexistent')
})
