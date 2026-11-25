/** Environment checks + one-click installs (winget on Windows, hints on Linux). */
import spawn from 'cross-spawn'
import { execFileSync } from 'node:child_process'
import type { DoctorItem } from '@shared/types'
import { findLanguage, LANGUAGES } from '@shared/languages'
import { which, clearWhichCache, firstAvailable } from './runner'
import { send } from './bus'
import { getSettings } from './store/settings'
import { allSessions } from './store/sessions'

const isWin = process.platform === 'win32'

function version(cmd: string, args = ['--version']): string | undefined {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, windowsHide: true })
    return out.split('\n')[0].trim().slice(0, 80)
  } catch {
    return undefined
  }
}

function tool(id: string, name: string, purpose: string, cmds: string[], winget: string | undefined, linux: string | undefined, optional = false): DoctorItem {
  const found = firstAvailable(cmds)
  const install: DoctorItem['install'] = isWin
    ? winget
      ? { kind: 'winget', value: winget, label: `winget install ${winget}` }
      : undefined
    : linux
      ? { kind: 'shell', value: linux, label: linux }
      : undefined
  return { id, name, purpose, found: !!found, path: found ? (which(found) ?? undefined) : undefined, install, optional }
}

export function runDoctor(languages?: string[]): DoctorItem[] {
  clearWhichCache()
  const s = getSettings()
  const items: DoctorItem[] = []
  const nvimCmd = s.editor.nvimPath || 'nvim'
  const nvim = tool('nvim', 'Neovim ≥ 0.11', 'The editor (LazyVim requires 0.11+)', [nvimCmd], 'Neovim.Neovim', 'Download the AppImage from https://github.com/neovim/neovim/releases')
  if (nvim.found) nvim.version = version(nvim.path!)
  items.push(nvim)
  const git = tool('git', 'Git', 'Installs LazyVim plugins', ['git'], 'Git.Git', 'sudo apt install git')
  if (git.found) git.version = version('git')
  items.push(git)
  items.push(tool('cc', 'C compiler', 'Builds treesitter parsers (syntax highlighting) and runs C/C++', ['gcc', 'clang', 'cc', 'zig'], 'BrechtSanders.WinLibs.POSIX.UCRT', 'sudo apt install build-essential'))
  items.push(tool('rg', 'ripgrep', 'Live grep in LazyVim (<leader>/)', ['rg'], 'BurntSushi.ripgrep.MSVC', 'sudo apt install ripgrep', true))
  items.push(tool('fd', 'fd', 'Fast file finder for the LazyVim picker', ['fd', 'fdfind'], 'sharkdp.fd', 'sudo apt install fd-find', true))
  items.push(tool('lazygit', 'lazygit', 'Git UI inside LazyVim (<leader>gg)', ['lazygit'], 'JesseDuffield.lazygit', 'See https://github.com/jesseduffield/lazygit#installation', true))
  items.push(tool('node', 'Node.js', 'Many language servers installed by Mason need it', ['node'], 'OpenJS.NodeJS.LTS', 'sudo apt install nodejs npm', true))
  const langs = new Set(languages ?? allSessions().map((x) => x.language))
  for (const id of langs) {
    const l = findLanguage(id)
    if (!l || l.toolchain.length === 0) continue
    items.push({ ...tool(`lang:${l.id}`, `${l.name} toolchain`, `Run ${l.name} code (${l.toolchain.join(' / ')})`, l.toolchain, l.winget, l.linuxHint), optional: false })
    if (!isWin && !l.linuxHint && l.url) items[items.length - 1].install = { kind: 'url', value: l.url, label: l.url }
    if (isWin && !l.winget && l.url) items[items.length - 1].install = { kind: 'url', value: l.url, label: l.url }
  }
  return items
}

export function languageToolchainItems(): DoctorItem[] {
  return LANGUAGES.filter((l) => l.toolchain.length).map((l) => tool(`lang:${l.id}`, l.name, l.toolchain.join(' / '), l.toolchain, l.winget, l.linuxHint, true))
}

/** Reload PATH from the registry after an install (Windows). */
function refreshPath(): void {
  if (!isWin) return
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    ).trim()
    if (out) {
      process.env.PATH = out
      process.env.Path = out
    }
  } catch {
    /* ignore */
  }
  clearWhichCache()
}

export function install(item: { kind: string; value: string }): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    let cmd: string
    let args: string[]
    if (item.kind === 'winget') {
      cmd = 'winget'
      args = ['install', '--id', item.value, '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']
    } else if (item.kind === 'npm') {
      cmd = 'npm'
      args = ['install', '-g', item.value]
    } else {
      send('doctor:output', `Run this in a terminal:\n  ${item.value}\n`)
      resolve({ ok: false, code: null })
      return
    }
    send('doctor:output', `$ ${cmd} ${args.join(' ')}\n`)
    const child = spawn(cmd, args, { windowsHide: true })
    child.stdout?.on('data', (d: Buffer) => send('doctor:output', d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => send('doctor:output', d.toString('utf8')))
    child.on('error', (err) => {
      send('doctor:output', `\n${err.message}\n`)
      resolve({ ok: false, code: null })
    })
    child.on('close', (code) => {
      refreshPath()
      send('doctor:output', `\nFinished with exit code ${code}.\n`)
      resolve({ ok: code === 0, code })
    })
  })
}

export { refreshPath }
