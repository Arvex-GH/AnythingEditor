import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error('[store] failed to read', path, err)
    return fallback
  }
}

/** Atomic-ish write: temp file + rename. */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  const out: T[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      /* skip corrupt line */
    }
  }
  return out
}

export function appendJsonl(path: string, values: unknown[]): void {
  if (values.length === 0) return
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, values.map((v) => JSON.stringify(v)).join('\n') + '\n', 'utf8')
}

export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return prefix + rand
}

export function nowIso(): string {
  return new Date().toISOString()
}
