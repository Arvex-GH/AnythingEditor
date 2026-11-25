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
  if (r.status !== 0) {
    // Never fail `npm install` over this; `npm run dev` will report it clearly.
    console.warn('[AnythingEditor] Could not download Electron. Retry with: node node_modules/electron/install.js')
    process.exit(process.env.npm_lifecycle_event === 'postinstall' ? 0 : 1)
  }
}
