import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { vim, Vim } from '@replit/codemirror-vim'
import type { EditorCommand, FileEntry } from '@shared/types'
import { api, on } from '../api'
import { toast } from '../store'
import { Icon } from './Icon'

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#1a1b26', color: '#c0caf5' },
    '.cm-gutters': { backgroundColor: '#1a1b26', color: '#3b4261', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#292e4266' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#737aa2' },
    '.cm-cursor': { borderLeftColor: '#c0caf5' },
    '.cm-fat-cursor': { background: '#7aa2f7 !important', color: '#1a1b26 !important' },
    '.cm-panels': { backgroundColor: '#16161e', color: '#a9b1d6' },
    '.cm-vim-panel input': { color: '#c0caf5' }
  },
  { dark: true }
)

let exDefined = false

export function BuiltinEditor({ sessionId, workspace, onFile }: { sessionId: string; workspace: string; onFile: (rel: string | undefined) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const current = useRef<string | undefined>(undefined)
  const saveTimer = useRef<number | undefined>(undefined)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [newName, setNewName] = useState<string | null>(null)

  const refreshFiles = () => api.files(sessionId).then(setFiles).catch(() => {})

  const save = async () => {
    const v = view.current
    const rel = current.current
    if (!v || !rel) return
    window.clearTimeout(saveTimer.current)
    await api.writeFile(sessionId, rel, v.state.doc.toString()).catch((e) => toast(e.message, 'error'))
  }

  const open = async (pathOrRel: string) => {
    const rel = pathOrRel.startsWith(workspace) ? pathOrRel.slice(workspace.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') : pathOrRel
    if (current.current && current.current !== rel) await save()
    const text = await api.readFile(sessionId, rel)
    current.current = rel
    setActive(rel)
    onFile(rel)
    api.builtinFile(sessionId, `${workspace}/${rel}`).catch(() => {})
    const v = view.current
    if (!v) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
    const desc = LanguageDescription.matchFilename(languages, rel)
    if (desc) {
      const support = await desc.load()
      v.dispatch({ effects: langComp.current.reconfigure(support) })
    } else v.dispatch({ effects: langComp.current.reconfigure([]) })
    v.focus()
  }

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          vim(),
          basicSetup,
          keymap.of([indentWithTab]),
          oneDark,
          theme,
          langComp.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && current.current) {
              window.clearTimeout(saveTimer.current)
              saveTimer.current = window.setTimeout(save, 400)
            }
          })
        ]
      })
    })
    view.current = v
    if (!exDefined) {
      exDefined = true
      Vim.defineEx('write', 'w', () => window.dispatchEvent(new CustomEvent('ae-save')))
      Vim.defineEx('submit', 'sub', () => window.dispatchEvent(new CustomEvent('ae-submit')))
    }
    const onSave = () => save().then(() => toast('Saved'))
    window.addEventListener('ae-save', onSave)
    refreshFiles().then(() => undefined)
    const offCmd = on('editor:command', (c: EditorCommand) => {
      if (c.type === 'open') open(c.path)
      else if (c.type === 'reload' && current.current && c.path.replace(/\\/g, '/').endsWith(current.current)) open(c.path)
    })
    const offFiles = on('editor:files', (p: { sessionId: string }) => p.sessionId === sessionId && refreshFiles())
    return () => {
      save()
      window.removeEventListener('ae-save', onSave)
      offCmd()
      offFiles()
      v.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Open the most recent file if nothing is open yet.
  useEffect(() => {
    if (!current.current && files.some((f) => !f.dir)) {
      const first = files.find((f) => !f.dir)!
      open(first.rel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  return (
    <>
      <div className="file-tree">
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px 6px', gap: 4 }}>
          <span className="help" style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10.5 }}>
            Files
          </span>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            title="New file"
            onClick={() => setNewName('')}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {newName !== null && (
          <input
            className="input"
            style={{ margin: '0 8px 6px', width: 'calc(100% - 16px)', padding: '3px 6px', fontSize: 12 }}
            autoFocus
            placeholder="path/to/file.ext"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => setNewName(null)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') setNewName(null)
              if (e.key === 'Enter' && newName.trim()) {
                const name = newName.trim()
                setNewName(null)
                await api.newFile(sessionId, name).catch((err) => toast(err.message, 'error'))
                await refreshFiles()
                open(name)
              }
            }}
          />
        )}
        {files.length === 0 && <div className="help" style={{ padding: '4px 10px' }}>Empty — your tutor will add files.</div>}
        {files.map((f) => (
          <div key={f.rel} className={`row ${f.dir ? 'dir' : ''} ${active === f.rel ? 'active' : ''}`} style={{ paddingLeft: 10 + (f.rel.split('/').length - 1) * 12 }} onClick={() => !f.dir && open(f.rel)} title={f.rel}>
            <Icon name={f.dir ? 'folder' : 'file'} size={12} /> {f.rel.split('/').pop()}
          </div>
        ))}
      </div>
      <div className="cm-host" ref={host} />
    </>
  )
}
