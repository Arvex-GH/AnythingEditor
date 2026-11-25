import { useEffect } from 'react'
import { initStore, useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Home } from './components/Home'
import { SessionView } from './components/SessionView'
import { SettingsPage } from './components/Settings'
import { GraphView } from './components/GraphView'

let initialized = false

export function App() {
  useEffect(() => {
    if (!initialized) {
      initialized = true
      initStore()
    }
  }, [])
  const view = useStore((s) => s.view)
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {view.kind === 'home' && <Home />}
        {view.kind === 'session' && <SessionView key={view.id} sessionId={view.id} />}
        {view.kind === 'settings' && <SettingsPage initialTab={view.tab} />}
        {view.kind === 'graph' && <GraphView />}
      </main>
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
