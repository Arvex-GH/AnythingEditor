// Test bootstrap: TypeScript via tsx, with `electron` mapped to a stub (see tsconfig.test.json).
import { fileURLToPath } from 'node:url'
process.env.TSX_TSCONFIG_PATH = fileURLToPath(new URL('../tsconfig.test.json', import.meta.url))
await import('tsx')
