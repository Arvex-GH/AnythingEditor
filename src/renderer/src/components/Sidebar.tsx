import { useState } from 'react'
import type { SessionListItem } from '@shared/types'
import { api } from '../api'
import { navigate, refreshSessions, setState, toast, useStore } from '../store'
import { Icon } from './Icon'
import { LangDot } from './LangBadge'
import logoUrl from '../assets/logo.png'

function groupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Older'
}

const PHASE_LABEL: Record<string, string> = { probe: 'measuring', teach: 'learning', project: 'building', practice: 'practice' }

export function Sidebar() {
  const sessions = useStore((s) => s.sessions)
  const view = useStore((s) => s.view)
  const collapsed = useStore((s) => s.settings?.ui.sidebarCollapsed ?? false)
  const status = useStore((s) => s.status)
  const [confirm, setConfirm] = useState<SessionListItem | null>(null)
  const activeId = view.kind === 'session' ? view.id : null

  const toggle = async () => {
    const st = (await api.getSettings())
    st.ui.sidebarCollapsed = !st.ui.sidebarCollapsed
    setState({ settings: await api.saveSettings(st) })
  }

  const groups: [string, SessionListItem[]][] = []
  for (const s of sessions) {
    const g = groupLabel(s.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(s)
    else groups.push([g, [s]])
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-head">
        <img className="logo" src={logoUrl} alt="AnythingEditor" onClick={toggle} title="Toggle sidebar" style={{ cursor: 'pointer', background: 'none' }} />
        <div className="brand">
          Anything<span>Editor</span>
        </div>
      </div>
      <button className="btn primary new-btn" onClick={() => navigate({ kind: 'home' })} title="New session">
        <Icon name="plus" size={15} />
        <span className="label">New session</span>
      </button>
      <div className="session-list">
        {sessions.length === 0 && !collapsed && <div className="help" style={{ padding: '12px 10px' }}>Your sessions will appear here.</div>}
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="session-group">{g}</div>
            {list.map((s) => {
              const st = status[s.id]?.status
              const busy = s.busy || st === 'thinking' || st === 'tool'
              return (
                <div key={s.id} className={`session-item ${activeId === s.id ? 'active' : ''}`} onClick={() => navigate({ kind: 'session', id: s.id })} title={s.title}>
                  <LangDot language={s.language} />
                  <div className="meta">
                    <div className="title">{s.title}</div>
                    <div className="sub">
                      {busy && <span className="spinner" />}
                      <span>{PHASE_LABEL[s.phase] ?? s.phase}</span>
                      <span>·</span>
                      <span>{s.mode}</span>
                    </div>
                  </div>
                  {!collapsed && (
                    <button
                      className="icon-btn del"
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirm(s)
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <button className={`nav-item ${view.kind === 'graph' ? 'active' : ''}`} onClick={() => navigate({ kind: 'graph' })} title="Knowledge graph">
          <Icon name="graph" />
          <span className="label">Knowledge graph</span>
        </button>
        <button className={`nav-item ${view.kind === 'settings' ? 'active' : ''}`} onClick={() => navigate({ kind: 'settings' })} title="Settings">
          <Icon name="settings" />
          <span className="label">Settings</span>
        </button>
        <button className="nav-item" onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name="sidebar" />
          <span className="label">Collapse</span>
        </button>
      </div>
      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete “{confirm.title}”?</h3>
            <p>The conversation is removed. Ideas it added to your knowledge graph are kept. You can also delete the session's code workspace.</p>
            <div className="row-actions">
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  await api.deleteSession(confirm.id, false)
                  if (activeId === confirm.id) navigate({ kind: 'home' })
                  setConfirm(null)
                  refreshSessions()
                }}
              >
                Delete chat
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  try {
                    await api.deleteSession(confirm.id, true)
                  } catch (e: any) {
                    toast(e.message, 'error')
                  }
                  if (activeId === confirm.id) navigate({ kind: 'home' })
                  setConfirm(null)
                  refreshSessions()
                }}
              >
                Delete chat + code
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
