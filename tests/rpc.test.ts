import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encode, Decoder } from '@msgpack/msgpack'
import { NvimRpc } from '../src/main/editor/rpc'

test('NvimRpc speaks msgpack-rpc: requests, errors and notifications', async () => {
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\ae-test-${process.pid}` : join(mkdtempSync(join(tmpdir(), 'ae-rpc-')), 'nvim.sock')
  const server = createServer(async (c) => {
    const dec = new Decoder()
    for await (const msg of dec.decodeStream(c as AsyncIterable<Uint8Array>)) {
      const [, id, method, params] = msg as [number, number, string, unknown[]]
      if (method === 'nvim_eval') c.write(encode([1, id, null, (params[0] as string) === '1+1' ? 2 : null]))
      else if (method === 'boom') c.write(encode([1, id, [0, 'E5108: boom'], null]))
      else {
        c.write(encode([2, 'anything', ['submit', { note: 'hi' }]]))
        c.write(encode([1, id, null, 'ok']))
      }
    }
  })
  await new Promise<void>((r) => server.listen(sock, r))
  const rpc = await NvimRpc.connectWithRetry(sock, 3000)
  try {
    assert.equal(await rpc.request('nvim_eval', ['1+1']), 2)
    await assert.rejects(rpc.request('boom', []), /E5108: boom/)
    const note = new Promise((r) => rpc.once('notification', (m: string, a: unknown) => r([m, a])))
    assert.equal(await rpc.request('other', []), 'ok')
    assert.deepEqual(await note, ['anything', ['submit', { note: 'hi' }]])
  } finally {
    rpc.close()
    server.close()
  }
})
