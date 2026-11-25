/** A tiny msgpack-RPC client for Neovim's --listen socket / named pipe. */
import { connect, type Socket } from 'node:net'
import { EventEmitter } from 'node:events'
import { encode, Decoder } from '@msgpack/msgpack'

export class NvimRpc extends EventEmitter {
  private socket: Socket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private decoder = new Decoder()
  channelId = 0
  closed = false

  static async connectWithRetry(address: string, timeoutMs = 15000): Promise<NvimRpc> {
    const start = Date.now()
    let lastErr: unknown
    while (Date.now() - start < timeoutMs) {
      try {
        const rpc = new NvimRpc()
        await rpc.open(address)
        return rpc
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    throw new Error(`Could not connect to Neovim at ${address}: ${String(lastErr)}`)
  }

  private open(address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(address)
      const onError = (err: Error) => {
        sock.destroy()
        reject(err)
      }
      sock.once('error', onError)
      sock.once('connect', () => {
        sock.off('error', onError)
        this.socket = sock
        sock.on('error', (err) => this.emit('error', err))
        sock.on('close', () => {
          this.closed = true
          for (const p of this.pending.values()) p.reject(new Error('Neovim connection closed'))
          this.pending.clear()
          this.emit('close')
        })
        this.pump(sock)
        resolve()
      })
    })
  }

  private async pump(sock: Socket) {
    try {
      for await (const msg of this.decoder.decodeStream(sock as AsyncIterable<Uint8Array>)) this.handle(msg as any[])
    } catch (err) {
      if (!this.closed) this.emit('error', err)
    }
  }

  private handle(msg: any[]) {
    if (!Array.isArray(msg)) return
    const type = msg[0]
    if (type === 1) {
      const [, id, err, result] = msg
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (err) p.reject(new Error(Array.isArray(err) ? String(err[1]) : typeof err === 'object' ? JSON.stringify(err) : String(err)))
      else p.resolve(result)
    } else if (type === 2) {
      this.emit('notification', msg[1], msg[2])
    } else if (type === 0) {
      // Requests from nvim to us: answer with nil so nvim never blocks.
      const [, id, method, params] = msg
      this.emit('request', method, params)
      this.socket?.write(encode([1, id, null, null]))
    }
  }

  request<T = any>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.socket || this.closed) return Promise.reject(new Error('Neovim is not connected'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket!.write(encode([0, id, method, params]))
    })
  }

  lua<T = any>(code: string, args: unknown[] = []): Promise<T> {
    return this.request<T>('nvim_exec_lua', [code, args])
  }

  close() {
    this.closed = true
    this.socket?.destroy()
  }
}
