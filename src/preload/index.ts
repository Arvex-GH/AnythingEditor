import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const EVENTS = ['agent:event', 'pty:data', 'pty:exit', 'editor:status', 'editor:command', 'editor:files', 'editor:focus', 'editor:saved', 'editor:ask', 'run:event', 'doctor:output']

const api = {
  invoke: async (channel: string, ...args: unknown[]) => {
    const res = await ipcRenderer.invoke(channel, ...args)
    if (!res?.ok) throw new Error(res?.error ?? 'Unknown error')
    return res.value
  },
  on: (channel: string, cb: (payload: any) => void) => {
    if (!EVENTS.includes(channel)) throw new Error(`Unknown event ${channel}`)
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  ptyWrite: (data: string) => ipcRenderer.send('pty:write', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
