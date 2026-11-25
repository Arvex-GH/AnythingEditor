import { memo, useEffect, useMemo, useRef } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s/)[0].toLowerCase()
      const alias: Record<string, string> = { rs: 'rust', 'c#': 'csharp', cs: 'csharp', py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', ps1: 'powershell', kt: 'kotlin', golang: 'go', 'c++': 'cpp' }
      const l = alias[language] ?? language
      let html: string
      try {
        html = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l }).value : hljs.highlightAuto(text).value
      } catch {
        html = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
      }
      return `<pre><button class="btn small copy" data-copy>Copy</button><code class="hljs language-${l}">${html}</code></pre>`
    }
  }
})

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    const raw = marked.parse(text ?? '', { async: false }) as string
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-copy', 'target'] })
  }, [text])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.matches('[data-copy]')) {
        const code = t.parentElement?.querySelector('code')?.textContent ?? ''
        navigator.clipboard.writeText(code)
        t.textContent = 'Copied'
        setTimeout(() => (t.textContent = 'Copy'), 1200)
      }
      const a = t.closest('a') as HTMLAnchorElement | null
      if (a && a.href.startsWith('http')) {
        e.preventDefault()
        window.api.invoke('shell:open-external', a.href)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [])
  return <div ref={ref} className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />
})
