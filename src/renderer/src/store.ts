import { useSyncExternalStore } from 'react'
import type { AgentEvent, Session, SessionListItem, Settings, StreamDraft } from '@shared/types'
import { api, on } from './api'

export type View = { kind: 'home' } | { kind: 'session'; id: string } | { kind: 'settings'; tab?: string } | { kind: 'graph' }

export interface Toast {
  id: number
  level: 'info' | 'error'
  message: string
}

export interface AppState {
  settings: Settings | null
  sessions: SessionListItem[]
  view: View
  sessionCache: Record<string, Session>
  drafts: Record<string, StreamDraft | null>
  status: Record<string, { status: string; detail?: string }>
  extracting: Record<string, boolean>
  toasts: Toast[]
  composerInsert: { sessionId: string; text: string; label: string; nonce: number } | null
}

let state: AppState = {
  settings: null,
  sessions: [],
  view: { kind: 'home' },
  sessionCache: {},
  drafts: {},
  status: {},
  extracting: {},
  toasts: [],
  composerInsert: null
}

const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(state)
  )
}

let toastId = 0
export function toast(message: string, level: 'info' | 'error' = 'info') {
  const id = ++toastId
  setState((s) => ({ toasts: [...s.toasts, { id, level, message }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === 'error' ? 7000 : 3500)
}

export async function navigate(view: View) {
  const prev = state.view
  if (prev.kind === 'session' && (view.kind !== 'session' || view.id !== prev.id)) {
    api.leaveSession(prev.id).catch(() => {})
  }
  setState({ view })
  if (view.kind === 'session' && !state.sessionCache[view.id]) {
    const s = await api.getSession(view.id)
    if (s) setState((st) => ({ sessionCache: { ...st.sessionCache, [s.id]: s } }))
  }
}

export async function refreshSessions() {
  const sessions = await api.listSessions()
  setState({ sessions })
}

export async function refreshSettings() {
  setState({ settings: await api.getSettings() })
}

export function initStore() {
  refreshSettings().catch((e) => toast(String(e.message ?? e), 'error'))
  refreshSessions().catch(() => {})
  on('agent:event', (ev: AgentEvent) => {
    switch (ev.type) {
      case 'session':
        setState((s) => ({ sessionCache: { ...s.sessionCache, [ev.session.id]: ev.session } }))
        break
      case 'sessions':
        setState({ sessions: ev.sessions })
        break
      case 'draft':
        setState((s) => ({ drafts: { ...s.drafts, [ev.sessionId]: ev.draft } }))
        break
      case 'status':
        if (ev.status === 'extracting') setState((s) => ({ extracting: { ...s.extracting, [ev.sessionId]: ev.detail !== 'done' } }))
        else setState((s) => ({ status: { ...s.status, [ev.sessionId]: { status: ev.status, detail: ev.detail } } }))
        break
      case 'notice':
        toast(ev.message, ev.level)
        break
    }
  })
  on('editor:ask', (p: { sessionId: string; file: string; line1: number; line2: number; text: string; ft?: string }) => {
    const name = p.file.split(/[\\/]/).pop()
    const label = `${name}:${p.line1}${p.line2 !== p.line1 ? `-${p.line2}` : ''}`
    const text = `From \`${label}\`:\n\`\`\`${p.ft ?? ''}\n${p.text}\n\`\`\`\n`
    setState({ composerInsert: { sessionId: p.sessionId, text, label, nonce: Date.now() } })
  })
}

export function isBusy(sessionId: string): boolean {
  const st = state.status[sessionId]?.status
  return st === 'thinking' || st === 'tool' || !!state.sessions.find((s) => s.id === sessionId)?.busy
}
