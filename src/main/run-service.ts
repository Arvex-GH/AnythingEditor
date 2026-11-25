import type { RunResult, Session } from '@shared/types'
import { send } from './bus'
import { runFile, type RunHandle } from './runner'
import { editor } from './editor/manager'

let current: { id: string; handle: RunHandle } | null = null

function start(session: Session, file: string, stdin: string | undefined, source: 'user' | 'agent'): { id: string; handle: RunHandle } {
  current?.handle.kill()
  const id = `run_${Date.now().toString(36)}`
  send('run:event', { type: 'start', runId: id, command: editor.rel(session, file), source, sessionId: session.id })
  const handle = runFile(file, session.workspace, {
    stdin,
    timeoutMs: source === 'agent' ? 30_000 : 120_000,
    onData: (stream, data) => send('run:event', { type: 'data', runId: id, stream, data })
  })
  current = { id, handle }
  handle.promise.then((result) => {
    send('run:event', { type: 'end', runId: id, result, sessionId: session.id })
    if (current?.id === id) current = null
  })
  return current
}

export async function runForUser(session: Session, file: string, stdin?: string): Promise<RunResult> {
  await editor.saveAll()
  return start(session, file, stdin, 'user').handle.promise
}

export async function runForAgent(session: Session, file: string, stdin: string | undefined, signal: AbortSignal): Promise<RunResult> {
  await editor.saveAll()
  const r = start(session, file, stdin, 'agent')
  const onAbort = () => r.handle.kill()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await r.handle.promise
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function stopRun(): void {
  current?.handle.kill()
}
