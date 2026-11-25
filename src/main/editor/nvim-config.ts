/**
 * Installs the bundled LazyVim configuration into an isolated Neovim profile
 * (XDG_* + NVIM_APPNAME), so the learner's own nvim setup is never touched.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BASE_LAZY_EXTRAS, LANGUAGES, findLanguage } from '@shared/languages'
import { dataPath, resourcesDir } from '../paths'
import { getSettings } from '../store/settings'

export const NVIM_APPNAME = 'anything-nvim'

export function nvimRoots() {
  const root = dataPath('nvim')
  return {
    root,
    config: join(root, 'config'),
    data: join(root, 'data'),
    state: join(root, 'state'),
    cache: join(root, 'cache'),
    appConfig: join(root, 'config', NVIM_APPNAME)
  }
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Copy managed files (always) and user-owned files (only if missing). */
export function installNvimConfig(): string {
  const { appConfig } = nvimRoots()
  const src = join(resourcesDir(), 'nvim')
  mkdirSync(appConfig, { recursive: true })
  for (const file of walk(src)) {
    const rel = relative(src, file)
    const dest = join(appConfig, rel)
    const managed = readFileSync(file, 'utf8').startsWith('-- Managed by AnythingEditor')
    if (managed || !existsSync(dest)) {
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(file, dest)
    }
  }
  return appConfig
}

/** lazyvim.json: base extras + extras for every language the learner studies. */
export function syncLazyExtras(languages: string[]): void {
  const { appConfig } = nvimRoots()
  const file = join(appConfig, 'lazyvim.json')
  let data: { extras?: string[]; version?: number; install_version?: number; news?: Record<string, string> } = {}
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    data = {}
  }
  const wanted = new Set<string>(data.extras ?? [])
  const add = (e: string) => wanted.add(e.startsWith('lazyvim.') ? e : `lazyvim.plugins.extras.${e}`)
  BASE_LAZY_EXTRAS.forEach(add)
  getSettings().editor.extraExtras.forEach(add)
  for (const id of languages) findLanguage(id)?.lazyExtras.forEach(add)
  // Only keep extras LazyVim knows about (guard against typos in settings).
  const knownLang = new Set(LANGUAGES.flatMap((l) => l.lazyExtras))
  const extras = [...wanted].filter((e) => !e.startsWith('lazyvim.plugins.extras.lang.') || knownLang.has(e.replace('lazyvim.plugins.extras.', '')) || (data.extras ?? []).includes(e))
  extras.sort()
  const next = { extras, install_version: data.install_version ?? 8, news: data.news ?? {}, version: data.version ?? 8 }
  writeFileSync(file, JSON.stringify(next, null, 2))
}

export function nvimEnv(): Record<string, string> {
  const r = nvimRoots()
  return {
    XDG_CONFIG_HOME: r.config,
    XDG_DATA_HOME: r.data,
    XDG_STATE_HOME: r.state,
    XDG_CACHE_HOME: r.cache,
    NVIM_APPNAME
  }
}
