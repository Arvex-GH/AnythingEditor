import type { DoctorItem, EditorMode, EditorStatus, FileEntry, GraphSnapshot, Provider, RunResult, Session, SessionListItem, SessionMode, Settings } from '@shared/types'

const i = window.api.invoke

export const api = {
  appInfo: () => i<{ version: string; platform: string; dataDir: string; nvimConfig: string }>('app:info'),
  getSettings: () => i<Settings>('settings:get'),
  saveSettings: (s: Settings) => i<Settings>('settings:save', s),
  testProvider: (p: Provider) => i<{ reply: string; ms: number }>('provider:test', p),
  listModels: (p: Provider) => i<string[]>('provider:models', p),
  listSessions: () => i<SessionListItem[]>('sessions:list'),
  getSession: (id: string) => i<Session | null>('sessions:get', id),
  createSession: (o: { language?: string; mode: SessionMode; text: string; workspace?: string }) => i<Session>('sessions:create', o),
  deleteSession: (id: string, deleteWorkspace: boolean) => i('sessions:delete', id, deleteWorkspace),
  updateSession: (id: string, patch: { title?: string; providerId?: string; model?: string; language?: string }) => i<Session>('sessions:update', id, patch),
  leaveSession: (id: string) => i('sessions:leave', id),
  send: (id: string, text: string, meta?: Record<string, unknown>) => i('chat:send', id, text, meta),
  answer: (id: string, toolCallId: string, answer: unknown) => i('chat:answer', id, toolCallId, answer),
  submit: (id: string, note?: string) => i('chat:submit', id, note),
  stop: (id: string) => i('chat:stop', id),
  retry: (id: string) => i('chat:retry', id),
  editorStart: (id: string, cols: number, rows: number, mode?: EditorMode) => i<EditorStatus>('editor:start', id, cols, rows, mode),
  editorStop: () => i('editor:stop'),
  editorStatus: () => i<EditorStatus>('editor:status'),
  files: (id: string) => i<FileEntry[]>('editor:files', id),
  readFile: (id: string, path: string) => i<string>('editor:read', id, path),
  writeFile: (id: string, path: string, content: string) => i('editor:write', id, path, content),
  openFile: (id: string, path: string) => i<string>('editor:open', id, path),
  newFile: (id: string, path: string) => i<string>('editor:new-file', id, path),
  builtinFile: (id: string, path?: string) => i('editor:builtin-file', id, path),
  run: (id: string, path?: string, stdin?: string) => i<RunResult>('run:file', id, path, stdin),
  stopRun: () => i('run:stop'),
  graph: () => i<GraphSnapshot>('graph:get'),
  deleteNode: (id: string) => i('graph:delete-node', id),
  doctor: (languages?: string[]) => i<DoctorItem[]>('doctor:check', languages),
  toolchains: () => i<DoctorItem[]>('doctor:toolchains'),
  install: (item: { kind: string; value: string }) => i<{ ok: boolean; code: number | null }>('doctor:install', item),
  refreshPath: () => i('doctor:refresh-path'),
  resetNvimConfig: () => i('nvim:reset-config'),
  openNvimConfig: () => i('nvim:open-config'),
  openPath: (p: string) => i('shell:open-path', p),
  openExternal: (url: string) => i('shell:open-external', url),
  pickFolder: () => i<string | null>('dialog:pick-folder')
}

export const on = window.api.on
