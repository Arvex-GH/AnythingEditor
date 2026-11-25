/**
 * Neovim (LazyVim) running inside a pseudo-terminal, rendered by xterm.js in
 * the renderer. A second channel (msgpack-RPC over --listen) lets the tutor
 * open files, write code into live buffers (undoable with `u`), read unsaved
 * buffers and LSP diagnostics.
 */
import * as pty from '@lydell/node-pty'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import type { Diagnostic, EditorState } from '@shared/types'
import { NvimRpc } from './rpc'

const isWin = process.platform === 'win32'
let counter = 0

const LUA_SETUP = String.raw`
local chan = ...
vim.g.anything_chan = chan
local M = {}
local is_win = vim.fn.has('win32') == 1
local function norm(p)
  p = vim.fs.normalize(vim.fn.fnamemodify(p, ':p'))
  if is_win then p = p:lower() end
  return p
end
function M.notify(ev, data)
  if vim.g.anything_chan then pcall(vim.rpcnotify, vim.g.anything_chan, 'anything', ev, data or vim.empty_dict()) end
end
function M.find_buf(path)
  local target = norm(path)
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) then
      local n = vim.api.nvim_buf_get_name(b)
      if n ~= '' and norm(n) == target then return b end
    end
  end
end
local function normal_win()
  local cur = vim.api.nvim_get_current_win()
  local function ok(w)
    local b = vim.api.nvim_win_get_buf(w)
    return vim.bo[b].buftype == '' and vim.api.nvim_win_get_config(w).relative == ''
  end
  if ok(cur) then return cur end
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do if ok(w) then return w end end
  return cur
end
function M.open(path, line)
  local w = normal_win()
  vim.api.nvim_set_current_win(w)
  local b = M.find_buf(path)
  if b then vim.api.nvim_win_set_buf(w, b) else vim.cmd('edit ' .. vim.fn.fnameescape(path)) end
  if line and line > 0 then pcall(vim.api.nvim_win_set_cursor, w, { line, 0 }) end
  return true
end
function M.read(path)
  local b = M.find_buf(path)
  if not b then return vim.NIL end
  return table.concat(vim.api.nvim_buf_get_lines(b, 0, -1, false), '\n')
end
function M.is_modified(path)
  local b = M.find_buf(path)
  return b ~= nil and vim.bo[b].modified
end
-- The file is already written to disk by the app; mirror it into the buffer
-- so undo history is kept and the learner can press u to undo the tutor.
function M.set(path, text)
  local b = M.find_buf(path)
  if not b then return false end
  local lines = vim.split(text, '\n', { plain = true })
  if #lines > 1 and lines[#lines] == '' then table.remove(lines) end
  vim.api.nvim_buf_set_lines(b, 0, -1, false, lines)
  vim.bo[b].modified = false
  return true
end
function M.reload(path)
  local b = M.find_buf(path)
  if b then vim.api.nvim_buf_call(b, function() vim.cmd('silent! checktime') end) end
end
function M.diagnostics(path)
  local sev = { 'error', 'warning', 'info', 'hint' }
  local out = {}
  local bufs = {}
  if path and path ~= '' then
    local b = M.find_buf(path)
    if b then bufs = { b } end
  else
    bufs = vim.api.nvim_list_bufs()
  end
  for _, b in ipairs(bufs) do
    for _, d in ipairs(vim.diagnostic.get(b)) do
      table.insert(out, {
        file = vim.api.nvim_buf_get_name(b),
        line = d.lnum + 1, col = d.col + 1,
        severity = sev[d.severity] or 'info',
        message = d.message, source = d.source or vim.NIL,
      })
    end
  end
  return out
end
function M.state()
  local b = vim.api.nvim_get_current_buf()
  local c = vim.api.nvim_win_get_cursor(0)
  return { file = vim.api.nvim_buf_get_name(b), line = c[1], col = c[2] + 1, mode = vim.api.nvim_get_mode().mode }
end
function M.save_all() vim.cmd('silent! wall') end
_G.AnythingEditor = M

vim.api.nvim_create_user_command('AnythingSubmit', function()
  M.save_all(); M.notify('submit', { file = vim.api.nvim_buf_get_name(0) })
end, { desc = 'Submit the current exercise to your tutor' })
vim.api.nvim_create_user_command('AnythingRun', function()
  M.save_all(); M.notify('run', { file = vim.api.nvim_buf_get_name(0) })
end, { desc = 'Run the current file' })
vim.api.nvim_create_user_command('AnythingAsk', function(o)
  local lines = vim.api.nvim_buf_get_lines(0, o.line1 - 1, o.line2, false)
  M.notify('ask', { file = vim.api.nvim_buf_get_name(0), line1 = o.line1, line2 = o.line2, text = table.concat(lines, '\n'), ft = vim.bo.filetype })
end, { range = true, desc = 'Ask the tutor about the selection' })
vim.keymap.set('n', '<leader>as', '<cmd>AnythingSubmit<cr>', { desc = 'Submit exercise to tutor' })
vim.keymap.set('n', '<leader>ar', '<cmd>AnythingRun<cr>', { desc = 'Run current file' })
vim.keymap.set('n', '<leader>aa', '<cmd>AnythingAsk<cr>', { desc = 'Ask tutor about this line' })
vim.keymap.set('x', '<leader>aa', ':AnythingAsk<cr>', { desc = 'Ask tutor about selection', silent = true })
local grp = vim.api.nvim_create_augroup('AnythingEditor', { clear = true })
vim.api.nvim_create_autocmd('BufWritePost', { group = grp, callback = function(a) M.notify('saved', { file = a.match }) end })
vim.api.nvim_create_autocmd('BufEnter', { group = grp, callback = function(a)
  if vim.bo[a.buf].buftype == '' and a.match ~= '' then M.notify('focus', { file = a.match }) end
end })
return true
`

export interface NvimStartOptions {
  nvimPath: string
  workspace: string
  file?: string
  cols: number
  rows: number
  env: Record<string, string>
  onData: (data: string) => void
  onExit: (code: number) => void
  onNotify: (event: string, data: any) => void
}

export class NvimEditor {
  readonly kind = 'neovim' as const
  private term: pty.IPty
  rpc: NvimRpc | null = null
  private address: string
  private exited = false
  private ready: Promise<void>

  constructor(private opts: NvimStartOptions) {
    counter++
    this.address = isWin ? `\\\\.\\pipe\\anythingeditor-${process.pid}-${counter}` : join(tmpdir(), `anythingeditor-${process.pid}-${counter}.sock`)
    if (!isWin && existsSync(this.address)) unlinkSync(this.address)
    const args = ['--listen', this.address]
    if (opts.file) args.push(opts.file)
    const env = { ...process.env, ...opts.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    delete env.NVIM // never attach to a parent nvim
    delete env.NVIM_LISTEN_ADDRESS
    this.term = pty.spawn(opts.nvimPath, args, {
      name: 'xterm-256color',
      cols: Math.max(20, opts.cols),
      rows: Math.max(5, opts.rows),
      cwd: opts.workspace,
      env
    })
    this.term.onData((d) => opts.onData(d))
    this.term.onExit(({ exitCode }) => {
      this.exited = true
      this.rpc?.close()
      opts.onExit(exitCode)
    })
    this.ready = this.connect()
  }

  private async connect() {
    const rpc = await NvimRpc.connectWithRetry(this.address, 30000)
    this.rpc = rpc
    const info = await rpc.request<[number, unknown]>('nvim_get_api_info', [])
    rpc.channelId = info[0]
    await rpc.lua(LUA_SETUP, [rpc.channelId])
    rpc.on('notification', (method: string, args: any[]) => {
      if (method === 'anything') this.opts.onNotify(String(args?.[0]), args?.[1] ?? {})
    })
    rpc.on('error', () => {})
  }

  whenReady(timeoutMs = 30000): Promise<boolean> {
    return Promise.race([this.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]).catch(() => false)
  }

  get alive() {
    return !this.exited
  }

  write(data: string) {
    if (!this.exited) this.term.write(data)
  }

  resize(cols: number, rows: number) {
    if (!this.exited) {
      try {
        this.term.resize(Math.max(20, cols), Math.max(5, rows))
      } catch {
        /* ignore */
      }
    }
  }

  private async call<T>(fn: string, ...args: unknown[]): Promise<T | null> {
    if (!(await this.whenReady(2000)) || !this.rpc || this.rpc.closed) return null
    try {
      return await this.rpc.lua<T>(`return AnythingEditor.${fn}(...)`, args)
    } catch (err) {
      console.error('[nvim]', fn, err)
      return null
    }
  }

  async open(path: string, line?: number) {
    await this.call('open', path, line ?? 0)
  }

  async readBuffer(path: string): Promise<string | null> {
    const r = await this.call<string | null>('read', path)
    return typeof r === 'string' ? r : null
  }

  async setBuffer(path: string, text: string): Promise<boolean> {
    return (await this.call<boolean>('set', path, text)) === true
  }

  async diagnostics(path?: string): Promise<(Diagnostic & { file: string })[]> {
    return (await this.call<(Diagnostic & { file: string })[]>('diagnostics', path ?? '')) ?? []
  }

  async state(): Promise<EditorState | null> {
    return await this.call<EditorState>('state')
  }

  async saveAll() {
    await this.call('save_all')
  }

  async dispose() {
    if (this.exited) return
    try {
      if (this.rpc && !this.rpc.closed) {
        await Promise.race([this.rpc.lua('vim.cmd("silent! wall")', []), new Promise((r) => setTimeout(r, 800))])
        this.rpc.request('nvim_command', ['qa!']).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (!this.exited) {
        try {
          this.term.kill()
        } catch {
          /* ignore */
        }
      }
    }, 600)
  }
}
