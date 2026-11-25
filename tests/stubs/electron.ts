// Minimal Electron stub so main-process modules can be unit tested in plain Node.
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = {
  isPackaged: false,
  getPath: () => join(tmpdir(), 'anythingeditor-test-userdata'),
  getAppPath: () => process.cwd(),
  getVersion: () => '0.0.0-test'
}
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
}
export const BrowserWindow = { getAllWindows: () => [] as unknown[] }
export const ipcMain = { handle: () => {}, on: () => {} }
export const shell = { openPath: async () => '', openExternal: async () => {} }
export default { app, safeStorage, BrowserWindow, ipcMain, shell }
