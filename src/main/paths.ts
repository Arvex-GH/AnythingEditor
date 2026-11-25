import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

let dataDir: string | null = null

/** Mutable state lives in <userData>/data (overridable with ANYTHING_DATA_DIR). */
export function getDataDir(): string {
  if (!dataDir) {
    dataDir = process.env.ANYTHING_DATA_DIR || join(app.getPath('userData'), 'data')
    mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

export function dataPath(...parts: string[]): string {
  const p = join(getDataDir(), ...parts)
  return p
}

export function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

/** Immutable app resources (prompts, nvim config). */
export function resourcesDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'resources')
  return join(app.getAppPath(), 'resources')
}
