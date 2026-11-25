import { BrowserWindow } from 'electron'
import type { AgentEvent } from '@shared/types'

export function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function emitAgent(ev: AgentEvent): void {
  send('agent:event', ev)
}
