import { safeStorage } from 'electron'
import { join } from 'node:path'
import type { Provider, Settings } from '@shared/types'
import { dataPath, getDataDir } from '../paths'
import { readJson, writeJson, newId } from './fsutil'

const SETTINGS_FILE = () => dataPath('settings.json')
const AUTH_FILE = () => dataPath('auth.json')

function defaults(): Settings {
  return {
    providers: [],
    editor: {
      mode: 'neovim',
      nvimPath: '',
      config: 'lazyvim',
      fontSize: 14,
      extraExtras: []
    },
    agent: { allowRunCode: true, quizStyle: 'mixed', learnerName: '', language: '' },
    ui: { chatWidth: 460, sidebarCollapsed: false },
    workspaceRoot: join(getDataDir(), 'workspaces')
  }
}

/** API keys are stored separately and encrypted with the OS keychain when available. */
type AuthFile = Record<string, { enc?: string; plain?: string }>

function loadKeys(): Record<string, string> {
  const raw = readJson<AuthFile>(AUTH_FILE(), {})
  const out: Record<string, string> = {}
  for (const [id, v] of Object.entries(raw)) {
    try {
      if (v.enc && safeStorage.isEncryptionAvailable()) out[id] = safeStorage.decryptString(Buffer.from(v.enc, 'base64'))
      else if (v.plain) out[id] = v.plain
    } catch {
      /* unreadable key */
    }
  }
  return out
}

function saveKeys(keys: Record<string, string>): void {
  const out: AuthFile = {}
  const canEncrypt = safeStorage.isEncryptionAvailable()
  for (const [id, key] of Object.entries(keys)) {
    if (!key) continue
    out[id] = canEncrypt ? { enc: safeStorage.encryptString(key).toString('base64') } : { plain: key }
  }
  writeJson(AUTH_FILE(), out)
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const d = defaults()
  const stored = readJson<Partial<Settings>>(SETTINGS_FILE(), {})
  const keys = loadKeys()
  const s: Settings = {
    ...d,
    ...stored,
    editor: { ...d.editor, ...(stored.editor ?? {}) },
    agent: { ...d.agent, ...(stored.agent ?? {}) },
    ui: { ...d.ui, ...(stored.ui ?? {}) },
    providers: (stored.providers ?? []).map((p) => ({ ...p, apiKey: keys[p.id] ?? '' }))
  }
  if (process.env.ANYTHING_BASE_URL && s.providers.length === 0) {
    // Handy for development and CI: configure a provider via the environment.
    s.providers.push({
      id: 'env',
      name: 'Environment',
      baseUrl: process.env.ANYTHING_BASE_URL,
      apiKey: process.env.ANYTHING_API_KEY ?? '',
      model: process.env.ANYTHING_MODEL ?? 'gpt-4o-mini'
    })
    s.activeProviderId = 'env'
  }
  cache = s
  return s
}

export function saveSettings(next: Settings): Settings {
  const providers = next.providers.map((p) => ({ ...p, id: p.id || newId('prov_') }))
  const keys: Record<string, string> = {}
  for (const p of providers) keys[p.id] = p.apiKey
  saveKeys(keys)
  const toDisk = { ...next, providers: providers.map(({ apiKey: _k, ...rest }) => rest) }
  writeJson(SETTINGS_FILE(), toDisk)
  cache = { ...next, providers }
  if (!cache.activeProviderId || !providers.some((p) => p.id === cache!.activeProviderId)) {
    cache.activeProviderId = providers[0]?.id
  }
  return cache
}

export function activeProvider(preferId?: string): Provider | undefined {
  const s = getSettings()
  return (
    s.providers.find((p) => p.id === preferId) ??
    s.providers.find((p) => p.id === s.activeProviderId) ??
    s.providers[0]
  )
}

export function backgroundProvider(): Provider | undefined {
  const s = getSettings()
  return s.providers.find((p) => p.id === s.backgroundProviderId) ?? activeProvider()
}

/** Settings as sent to the renderer: keys are masked. */
export function publicSettings(): Settings {
  const s = getSettings()
  return { ...s, providers: s.providers.map((p) => ({ ...p, apiKey: p.apiKey ? '••••••••' + p.apiKey.slice(-4) : '' })) }
}

/** Merge settings coming from the renderer, keeping keys the UI only saw masked. */
export function mergeFromRenderer(incoming: Settings): Settings {
  const current = getSettings()
  const providers = incoming.providers.map((p) => {
    const prev = current.providers.find((c) => c.id === p.id)
    const masked = p.apiKey.startsWith('••••')
    return { ...p, apiKey: masked ? (prev?.apiKey ?? '') : p.apiKey }
  })
  return saveSettings({ ...incoming, providers })
}

export function resolveProviderFromRenderer(p: Provider): Provider {
  if (p.apiKey.startsWith('••••')) {
    const prev = getSettings().providers.find((c) => c.id === p.id)
    return { ...p, apiKey: prev?.apiKey ?? '' }
  }
  return p
}
