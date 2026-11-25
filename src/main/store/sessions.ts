import { readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Session, SessionListItem, SessionMode } from '@shared/types'
import { dataPath, ensureDir } from '../paths'
import { getSettings } from './settings'
import { readJson, writeJson, newId, nowIso } from './fsutil'

const dir = () => ensureDir(dataPath('sessions'))
const cache = new Map<string, Session>()
let loaded = false

function loadAll(): void {
  if (loaded) return
  loaded = true
  for (const f of readdirSync(dir())) {
    if (!f.endsWith('.json')) continue
    const s = readJson<Session | null>(join(dir(), f), null)
    if (s && s.id) {
      s.messages ??= []
      cache.set(s.id, s)
    }
  }
}

export function listSessions(): SessionListItem[] {
  loadAll()
  return [...cache.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((s) => ({
      id: s.id,
      title: s.title,
      language: s.language,
      mode: s.mode,
      phase: s.phase,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      summary: s.summary
    }))
}

export function allSessions(): Session[] {
  loadAll()
  return [...cache.values()]
}

export function getSession(id: string): Session | undefined {
  loadAll()
  return cache.get(id)
}

export function saveSession(s: Session, touch = true): void {
  if (touch) s.updatedAt = nowIso()
  cache.set(s.id, s)
  writeJson(join(dir(), `${s.id}.json`), s)
}

export function createSession(opts: { language: string; mode: SessionMode; title?: string; workspace?: string }): Session {
  loadAll()
  const id = newId('s_')
  const workspace = opts.workspace || join(getSettings().workspaceRoot, id)
  mkdirSync(workspace, { recursive: true })
  const now = nowIso()
  const s: Session = {
    id,
    title: opts.title || 'New session',
    language: opts.language,
    mode: opts.mode,
    phase: opts.mode === 'practice' ? 'practice' : 'probe',
    createdAt: now,
    updatedAt: now,
    messages: [],
    workspace
  }
  saveSession(s)
  return s
}

export function deleteSession(id: string, deleteWorkspace: boolean): void {
  const s = getSession(id)
  cache.delete(id)
  const f = join(dir(), `${id}.json`)
  if (existsSync(f)) rmSync(f)
  if (s && deleteWorkspace && s.workspace.startsWith(getSettings().workspaceRoot)) {
    try {
      rmSync(s.workspace, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
