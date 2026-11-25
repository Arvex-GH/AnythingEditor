import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { on } from '../api'

const THEME = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5'
}

export interface TerminalHandle {
  term: Terminal
  fit: () => { cols: number; rows: number }
  focus: () => void
}

/**
 * xterm.js host for Neovim. Calls onReady with the measured size so the main
 * process can spawn nvim at the right dimensions.
 */
export function NvimTerminal({ fontSize, onReady, focusSignal }: { fontSize: number; onReady: (h: TerminalHandle) => void; focusSignal?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void)[] = []
    ;(async () => {
      try {
        await document.fonts.load(`${fontSize}px "MesloLGS NF"`)
        await document.fonts.load(`bold ${fontSize}px "MesloLGS NF"`)
      } catch {
        /* fall back to system fonts */
      }
      if (disposed || !host.current) return
      const term = new Terminal({
        fontFamily: '"MesloLGS NF", "Cascadia Mono", Consolas, monospace',
        fontSize,
        lineHeight: 1.12,
        theme: THEME,
        allowProposedApi: true,
        cursorBlink: false,
        scrollback: 0,
        macOptionIsMeta: true,
        drawBoldTextInBrightColors: false,
        minimumContrastRatio: 1
      })
      termRef.current = term
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      const uni = new Unicode11Addon()
      term.loadAddon(uni)
      term.unicode.activeVersion = '11'
      term.open(host.current)
      try {
        const gl = new WebglAddon()
        gl.onContextLoss(() => gl.dispose())
        term.loadAddon(gl)
      } catch {
        /* canvas/DOM renderer fallback */
      }
      fitAddon.fit()

      // Clipboard: Ctrl+Shift+C / Ctrl+Shift+V, plus OSC 52 from Neovim.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
          navigator.clipboard.readText().then((t) => t && window.api.ptyWrite(t))
          return false
        }
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
          const sel = term.getSelection()
          if (sel) navigator.clipboard.writeText(sel)
          return false
        }
        return true
      })
      term.parser.registerOscHandler(52, (data) => {
        const idx = data.indexOf(';')
        const payload = idx >= 0 ? data.slice(idx + 1) : data
        if (payload && payload !== '?') {
          try {
            const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
            navigator.clipboard.writeText(new TextDecoder().decode(bytes))
          } catch {
            /* ignore */
          }
        }
        return true
      })

      term.onData((d) => window.api.ptyWrite(d))
      term.onBinary((d) => window.api.ptyWrite(d))
      cleanup.push(on('pty:data', (d: string) => term.write(d)))

      const doFit = () => {
        try {
          fitAddon.fit()
          window.api.ptyResize(term.cols, term.rows)
        } catch {
          /* ignore */
        }
        return { cols: term.cols, rows: term.rows }
      }
      let t: number | undefined
      const ro = new ResizeObserver(() => {
        window.clearTimeout(t)
        t = window.setTimeout(doFit, 40)
      })
      ro.observe(host.current)
      cleanup.push(() => ro.disconnect())
      onReady({ term, fit: doFit, focus: () => term.focus() })
      term.focus()
    })()
    return () => {
      disposed = true
      cleanup.forEach((f) => f())
      cleanup = []
      termRef.current?.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize])

  useEffect(() => {
    if (focusSignal) termRef.current?.focus()
  }, [focusSignal])

  return <div className="terminal-host" ref={host} onMouseDown={() => setTimeout(() => termRef.current?.focus(), 0)} />
}
