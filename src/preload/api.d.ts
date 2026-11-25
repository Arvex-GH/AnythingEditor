export interface Api {
  invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, cb: (payload: any) => void) => () => void
  ptyWrite: (data: string) => void
  ptyResize: (cols: number, rows: number) => void
  platform: string
}
declare global {
  interface Window {
    api: Api
  }
}
