// npm >= 11.20 blocks dependency install scripts unless they are listed in
// "allowScripts". If Electron's binary was never downloaded (older checkouts,
// --ignore-scripts, CI caches), fetch it now so `npm run dev` just works.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let dir
try {
  dir = dirname(require.resolve('electron/package.json'))
} catch {
  process.exit(0)
}
if (!existsSync(join(dir, 'path.txt')) || !existsSync(join(dir, 'dist'))) {
  console.log('[AnythingEditor] Downloading the Electron runtime…')
  const r = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
