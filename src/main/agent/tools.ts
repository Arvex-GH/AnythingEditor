/**
 * The tutor's tools. "Interaction" tools (ask_user_question, quiz,
 * assign_exercise) end the agent's turn; the learner's answer becomes the
 * tool result later — the LearnHarness question pattern.
 */
import type { Phase, PlanNode, Session } from '@shared/types'
import { languageInfo } from '@shared/languages'
import type { ToolSpec } from './llm'
import { editor } from '../editor/manager'
import { allSessions } from '../store/sessions'
import { getGraph, searchNodes } from '../store/graph'
import { getSettings } from '../store/settings'
import { nowIso } from '../store/fsutil'
import { runForAgent } from '../run-service'

export const INTERACTION_TOOLS = new Set(['ask_user_question', 'quiz', 'assign_exercise'])

const str = (description: string) => ({ type: 'string', description })

const SPECS: Record<string, ToolSpec['function']> = {
  ask_user_question: {
    name: 'ask_user_question',
    description:
      'Ask the learner a question that has NO right answer (goal, background, preference, what next). Ends your turn; the answer arrives as this tool\'s result. Offer 2-5 short options; the learner can always type their own answer. Example: {"question":"What do you want to build with Rust?","options":[{"label":"CLI tools (Recommended)"},{"label":"Web backends"},{"label":"Games"}]}',
    parameters: {
      type: 'object',
      properties: {
        question: str('The question (markdown).'),
        options: {
          type: 'array',
          items: { type: 'object', properties: { label: str('Short option text'), description: str('Optional one-line detail') }, required: ['label'] },
          description: 'Suggested answers. May be empty for a free-text question.'
        },
        multiSelect: { type: 'boolean', description: 'Allow picking several options.' }
      },
      required: ['question']
    }
  },
  quiz: {
    name: 'quiz',
    description:
      'Ask a graded question with a known correct answer. Ends your turn; the learner\'s answer (with confidence + reasoning) arrives as the result. kind "choice": provide 3-5 symmetric options, write `explanation` (why the right one is right) BEFORE `correctIndex`. kind "recall": provide `correctAnswer` (the committed answer with its reasoning) — you grade the learner\'s free text. Questions may contain fenced code. Example: {"kind":"choice","question":"What does this print?\\n```python\\nx=[1]\\ny=x\\ny.append(2)\\nprint(x)\\n```","options":["[1]","[1, 2]","[2]","An error"],"explanation":"y and x name the same list object, so appending through y is visible through x.","correctIndex":1}',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['choice', 'recall'] },
        question: str('The question (markdown, may include code blocks).'),
        options: { type: 'array', items: { type: 'string' }, description: 'choice: the options (bare claims, no reasoning inside).' },
        explanation: str('choice: why the correct option is correct. Shown after answering.'),
        correctIndex: { type: 'integer', description: 'choice: 0-based index of the correct option.' },
        correctAnswer: str('recall: the committed correct answer with reasoning.'),
        planNodeId: str('Optional: the plan node this question checks.')
      },
      required: ['kind', 'question']
    }
  },
  assign_exercise: {
    name: 'assign_exercise',
    description:
      'Give the learner a hands-on coding task in the editor. Writes the starter files, opens the main one, shows the task card, and ends your turn. The learner submits when done; the result contains his code, run output and diagnostics. Kinds: write (from scratch / extend), fill_in (skeleton with TODOs), fix_bug (code with a bug), predict (predict the output, then run), refactor. Keep it focused on ONE idea.',
    parameters: {
      type: 'object',
      properties: {
        title: str('Short title, e.g. "Borrow instead of clone"'),
        kind: { type: 'string', enum: ['write', 'fill_in', 'fix_bug', 'predict', 'refactor'] },
        instructions: str('Markdown instructions: what to do, acceptance criteria, optional hint policy.'),
        files: {
          type: 'array',
          description: 'Starter files to create/overwrite (paths relative to the workspace). May be empty if he works in existing files.',
          items: { type: 'object', properties: { path: str('Relative path'), content: str('Full file content') }, required: ['path', 'content'] }
        },
        open: str('Path of the file to open for the learner (defaults to the first file).'),
        runPath: str('Path to run on submission (defaults to `open`). Use "" to skip running.'),
        planNodeId: str('Optional: the plan node this exercise belongs to.')
      },
      required: ['title', 'instructions']
    }
  },
  write_file: {
    name: 'write_file',
    description: 'Create or overwrite a file in the session workspace and open it in the editor. Use for examples, scaffolding and demonstrations — not to solve the learner\'s exercises for him.',
    parameters: {
      type: 'object',
      properties: { path: str('Relative path, e.g. "examples/borrow.rs"'), content: str('Full file content'), open: { type: 'boolean', description: 'Open it in the editor (default true).' } },
      required: ['path', 'content']
    }
  },
  read_file: {
    name: 'read_file',
    description: 'Read a workspace file. Returns the LIVE editor buffer if it is open (including unsaved edits), with line numbers.',
    parameters: { type: 'object', properties: { path: str('Relative path') }, required: ['path'] }
  },
  open_file: {
    name: 'open_file',
    description: 'Open a workspace file in the editor (creates an empty file if missing), optionally at a line.',
    parameters: { type: 'object', properties: { path: str('Relative path'), line: { type: 'integer' } }, required: ['path'] }
  },
  list_files: {
    name: 'list_files',
    description: 'List the files in the session workspace.',
    parameters: { type: 'object', properties: {} }
  },
  get_editor_state: {
    name: 'get_editor_state',
    description: 'Which file and line the learner is currently looking at in the editor.',
    parameters: { type: 'object', properties: {} }
  },
  get_diagnostics: {
    name: 'get_diagnostics',
    description: 'LSP diagnostics (compile errors, warnings) for a file or all open files. Only available in Neovim mode.',
    parameters: { type: 'object', properties: { path: str('Optional relative path') } }
  },
  run_code: {
    name: 'run_code',
    description: 'Run a workspace file with the appropriate toolchain (cargo/rustc, python, dotnet, go, node, gcc, java, ...). Returns exit code, stdout and stderr. Output is also shown to the learner in the Run panel.',
    parameters: { type: 'object', properties: { path: str('Relative path of the file to run'), stdin: str('Optional standard input') }, required: ['path'] }
  },
  get_learner_profile: {
    name: 'get_learner_profile',
    description: 'What the knowledge graph and past sessions say about the learner for a language: past assessments, recorded evidence (demonstrated / shaky / gap), covered propositions, and his experience in OTHER languages. Call this first when probing or practising.',
    parameters: { type: 'object', properties: { language: str('Language id, e.g. "rust". Defaults to the session language.') } }
  },
  list_sessions: {
    name: 'list_sessions',
    description: 'List the learner\'s past sessions (all languages), most recent first, with summaries.',
    parameters: { type: 'object', properties: { language: str('Optional language filter') } }
  },
  search_knowledge: {
    name: 'search_knowledge',
    description: 'Search the learner\'s knowledge graph for propositions (ideas he was taught) matching a query, with statements and how they connect.',
    parameters: { type: 'object', properties: { query: str('Words to search for'), language: str('Optional language filter') }, required: ['query'] }
  },
  probe_done: {
    name: 'probe_done',
    description:
      "Conclude the measuring phase and hand off to teaching (or project building). Call ONCE, with no question outstanding, when the goal is clear and the evidence suffices to choose a starting point. The input IS the learner assessment the teacher plans from: per strand, what he reliably reasons from (floor), where his reasoning ran out (ceiling), misconceptions, and what's untested. After it succeeds, write one short closing sentence and end your turn.",
    parameters: {
      type: 'object',
      properties: {
        goal: str('The concrete goal of this session, in one sentence.'),
        summary: str('Overall synthesis: where he stands and where teaching should start.'),
        strands: {
          type: 'array',
          items: {
            type: 'object',
            properties: { strand: str('Dependency strand, e.g. "ownership & moves"'), level: { type: 'string', enum: ['none', 'beginner', 'intermediate', 'advanced'] }, assessment: str('Floor, ceiling, misconceptions, untested bounds.') },
            required: ['strand', 'assessment']
          }
        }
      },
      required: ['goal', 'summary', 'strands']
    }
  },
  plan_init: {
    name: 'plan_init',
    description: 'Create or replace the lesson/project plan: the minimal tree of landmarks from the learner\'s edge to the goal. 4-12 nodes; ids short like "n1". Shown to the learner as a map.',
    parameters: {
      type: 'object',
      properties: {
        goal: str('The goal the plan reaches.'),
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: str('Short id'), title: str('Landmark title'), detail: str('One sentence on what it covers'), dependsOn: { type: 'array', items: { type: 'string' } } },
            required: ['id', 'title']
          }
        }
      },
      required: ['goal', 'nodes']
    }
  },
  plan_update: {
    name: 'plan_update',
    description: 'Mark plan landmarks as current or done as teaching progresses.',
    parameters: {
      type: 'object',
      properties: { nodeId: str('Plan node id'), status: { type: 'string', enum: ['todo', 'current', 'done'] } },
      required: ['nodeId', 'status']
    }
  }
}

const EDITOR_TOOLS = ['write_file', 'read_file', 'open_file', 'list_files', 'get_editor_state', 'get_diagnostics', 'run_code']
const MEMORY_TOOLS = ['get_learner_profile', 'list_sessions', 'search_knowledge']

export function toolsForPhase(phase: Phase): ToolSpec[] {
  let names: string[]
  switch (phase) {
    case 'probe':
      names = ['ask_user_question', 'quiz', 'assign_exercise', ...EDITOR_TOOLS, ...MEMORY_TOOLS, 'probe_done']
      break
    case 'teach':
    case 'project':
      names = ['ask_user_question', 'quiz', 'assign_exercise', ...EDITOR_TOOLS, 'plan_init', 'plan_update', ...MEMORY_TOOLS]
      break
    case 'practice':
      names = ['ask_user_question', 'quiz', 'assign_exercise', ...EDITOR_TOOLS, ...MEMORY_TOOLS]
      break
  }
  if (!getSettings().agent.allowRunCode) names = names.filter((n) => n !== 'run_code')
  return names.map((n) => ({ type: 'function', function: SPECS[n] }))
}

export interface ToolContext {
  session: Session
  signal: AbortSignal
}

export interface ToolOutcome {
  /** Text the model sees as the tool result. */
  content: string
  /** UI metadata stored on the tool message. */
  meta?: Record<string, unknown>
  /** Phase change requested (probe_done). */
  handoff?: boolean
}

function numbered(text: string): string {
  const lines = text.split('\n')
  const w = String(lines.length).length
  return lines.map((l, i) => `${String(i + 1).padStart(w)}│ ${l}`).join('\n')
}

function truncate(s: string, n = 8000): string {
  return s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} chars]` : s
}

export function learnerProfile(language: string, excludeSession?: string): string {
  const sessions = allSessions().filter((s) => s.id !== excludeSession)
  const graph = getGraph()
  const lang = languageInfo(language)
  const out: string[] = [`# Learner profile — ${lang.name}`]
  const same = sessions.filter((s) => s.language === language).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (same.length === 0) out.push(`No earlier ${lang.name} sessions.`)
  for (const s of same.slice(0, 8)) {
    out.push(`\n## Session "${s.title}" (${s.mode}, ${s.phase}, last active ${s.updatedAt.slice(0, 10)})`)
    if (s.assessment) {
      out.push(`Assessment: ${s.assessment.summary}`)
      for (const st of s.assessment.strands) out.push(`- ${st.strand}${st.level ? ` [${st.level}]` : ''}: ${st.assessment}`)
    }
    if (s.plan) out.push(`Plan progress: ${s.plan.nodes.filter((n) => n.status === 'done').map((n) => n.title).join('; ') || 'none done'} (of ${s.plan.nodes.length})`)
    if (s.summary) out.push(`Summary: ${s.summary}`)
  }
  const ev = graph.evidence.filter((e) => e.language === language && e.sessionId !== excludeSession)
  if (ev.length) {
    const byTopic = new Map<string, typeof ev>()
    for (const e of ev) byTopic.set(e.topic.toLowerCase(), [...(byTopic.get(e.topic.toLowerCase()) ?? []), e])
    out.push('\n## Recorded evidence (latest outcome per topic)')
    for (const [, list] of [...byTopic.entries()].slice(-60)) {
      const last = list[list.length - 1]
      out.push(`- ${last.topic}: ${last.outcome}${list.length > 1 ? ` (${list.length} observations)` : ''} — ${last.note}`)
    }
  }
  const nodes = graph.nodes.filter((n) => n.language === language)
  if (nodes.length) {
    out.push(`\n## Propositions taught so far (${nodes.length})`)
    out.push(nodes.slice(-80).map((n) => `- ${n.name}`).join('\n'))
  }
  const others = new Map<string, { sessions: number; nodes: number; summaries: string[] }>()
  for (const s of sessions.filter((x) => x.language !== language)) {
    const o = others.get(s.language) ?? { sessions: 0, nodes: 0, summaries: [] }
    o.sessions++
    if (s.assessment) o.summaries.push(s.assessment.summary)
    others.set(s.language, o)
  }
  for (const n of graph.nodes.filter((x) => x.language !== language)) {
    const o = others.get(n.language) ?? { sessions: 0, nodes: 0, summaries: [] }
    o.nodes++
    others.set(n.language, o)
  }
  if (others.size) {
    out.push('\n## Experience in other languages (transfers!)')
    for (const [l, o] of others) out.push(`- ${languageInfo(l).name}: ${o.sessions} session(s), ${o.nodes} proposition(s). ${o.summaries.slice(-1)[0] ?? ''}`)
  }
  return out.join('\n')
}

/** Execute a non-interaction tool. */
export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<ToolOutcome> {
  const { session } = ctx
  switch (name) {
    case 'write_file': {
      if (typeof args.path !== 'string' || typeof args.content !== 'string') throw new Error('path and content are required strings')
      const abs = await editor.writeFile(session, args.path, args.content, args.open !== false)
      return { content: `Wrote ${editor.rel(session, abs)} (${args.content.split('\n').length} lines)${args.open !== false ? ' and opened it in the editor' : ''}.`, meta: { path: editor.rel(session, abs) } }
    }
    case 'read_file': {
      const r = await editor.readFile(session, String(args.path ?? ''))
      if (!r) return { content: `File not found: ${args.path}. Use list_files.` }
      return { content: `${args.path}${r.live ? ' (live buffer)' : ''}:\n${truncate(numbered(r.text), 12000)}`, meta: { path: args.path } }
    }
    case 'open_file': {
      const abs = await editor.openFile(session, String(args.path ?? ''), typeof args.line === 'number' ? args.line : undefined)
      return { content: `Opened ${editor.rel(session, abs)}.`, meta: { path: editor.rel(session, abs) } }
    }
    case 'list_files': {
      const files = editor.listFiles(session)
      return { content: files.length ? files.map((f) => (f.dir ? `${f.rel}/` : `${f.rel} (${f.size} B)`)).join('\n') : 'The workspace is empty.' }
    }
    case 'get_editor_state': {
      const st = await editor.state(session)
      if (!st?.file) return { content: 'No file is open in the editor.' }
      return { content: `Learner is at ${editor.rel(session, st.file)}${st.line ? `:${st.line}:${st.col}` : ''}${st.mode ? ` (mode ${st.mode})` : ''}.` }
    }
    case 'get_diagnostics': {
      if (!editor.hasLiveDiagnostics(session)) return { content: 'Diagnostics are unavailable (the built-in editor has no LSP, or this session is not open). Use run_code to see compiler errors.' }
      const d = await editor.diagnostics(session, args.path)
      if (!d.length) return { content: 'No diagnostics — the language server reports no problems (it may still be starting).' }
      return { content: d.slice(0, 60).map((x) => `${editor.rel(session, x.file)}:${x.line}:${x.col} ${x.severity}: ${x.message}${x.source ? ` [${x.source}]` : ''}`).join('\n') }
    }
    case 'run_code': {
      if (!getSettings().agent.allowRunCode) return { content: 'Running code is disabled by the learner in settings.' }
      const abs = editor.resolvePath(session, String(args.path ?? ''))
      const res = await runForAgent(session, abs, typeof args.stdin === 'string' ? args.stdin : undefined, ctx.signal)
      return {
        content: `$ ${res.command}\nexit code: ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}\n--- stdout ---\n${truncate(res.stdout, 6000) || '(empty)'}\n--- stderr ---\n${truncate(res.stderr, 4000) || '(empty)'}`,
        meta: { path: editor.rel(session, abs), result: res }
      }
    }
    case 'get_learner_profile':
      return { content: learnerProfile(args.language || session.language, session.id) }
    case 'list_sessions': {
      const list = allSessions()
        .filter((s) => s.id !== session.id && (!args.language || s.language === args.language))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 30)
      if (!list.length) return { content: 'No other sessions yet.' }
      const graph = getGraph()
      return {
        content: list
          .map((s, i) => {
            const n = graph.nodes.filter((x) => x.sessions[0] === s.id).length
            return `${i + 1}. "${s.title}" — ${languageInfo(s.language).name}, ${s.mode}/${s.phase}, ${n} propositions, last active ${s.updatedAt.slice(0, 10)}${s.summary ? `\n   ${s.summary}` : ''}`
          })
          .join('\n')
      }
    }
    case 'search_knowledge': {
      const hits = searchNodes(String(args.query ?? ''), { language: args.language, limit: 15 })
      if (!hits.length) return { content: 'No matching propositions in the knowledge graph.' }
      const graph = getGraph()
      return {
        content: hits
          .map((n) => {
            const supports = graph.chains.filter((c) => c.premises.includes(n.id)).length
            const derived = graph.chains.filter((c) => c.conclusion === n.id).length
            return `- [${languageInfo(n.language).name}] ${n.name}: ${n.statement}${supports || derived ? ` (supports ${supports}, derived by ${derived} chains)` : ''}`
          })
          .join('\n')
      }
    }
    case 'probe_done': {
      if (session.phase !== 'probe') return { content: 'The probe is already concluded — probe_done fires exactly once.' }
      if (!Array.isArray(args.strands) || args.strands.length === 0) throw new Error('strands must be a non-empty array')
      session.assessment = {
        goal: String(args.goal ?? ''),
        summary: String(args.summary ?? ''),
        strands: args.strands.map((s: any) => ({ strand: String(s.strand ?? ''), assessment: String(s.assessment ?? ''), level: s.level })),
        createdAt: nowIso()
      }
      session.goal = session.assessment.goal || session.goal
      return { content: 'Assessment recorded. The teaching phase starts after your closing sentence.', handoff: true }
    }
    case 'plan_init': {
      if (!Array.isArray(args.nodes) || args.nodes.length === 0) throw new Error('nodes must be a non-empty array')
      const ids = new Set<string>()
      const nodes: PlanNode[] = args.nodes.map((n: any, i: number) => {
        const id = String(n.id || `n${i + 1}`)
        ids.add(id)
        return { id, title: String(n.title ?? id), detail: n.detail ? String(n.detail) : undefined, dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.map(String) : [], status: 'todo' as const }
      })
      for (const n of nodes) n.dependsOn = n.dependsOn.filter((d) => ids.has(d) && d !== n.id)
      // keep progress if replanning with the same ids
      for (const n of nodes) {
        const prev = session.plan?.nodes.find((p) => p.id === n.id)
        if (prev) n.status = prev.status
      }
      session.plan = { goal: String(args.goal ?? session.goal ?? ''), nodes, updatedAt: nowIso() }
      return { content: `Plan saved with ${nodes.length} nodes. Present it briefly and ask the learner to confirm before teaching.` }
    }
    case 'plan_update': {
      if (!session.plan) return { content: 'There is no plan yet — call plan_init first.' }
      const node = session.plan.nodes.find((n) => n.id === args.nodeId)
      if (!node) return { content: `Unknown plan node "${args.nodeId}". Valid ids: ${session.plan.nodes.map((n) => n.id).join(', ')}` }
      if (args.status === 'current') for (const n of session.plan.nodes) if (n.status === 'current') n.status = 'todo'
      node.status = args.status
      session.plan.updatedAt = nowIso()
      return { content: `Plan node ${node.id} is now ${node.status}.` }
    }
    default:
      return { content: `Unknown tool "${name}".` }
  }
}

/** Validate an interaction tool call before it is shown to the learner. */
export function validateInteraction(name: string, args: any): string | null {
  if (name === 'ask_user_question') {
    if (!args.question || typeof args.question !== 'string') return 'question (string) is required'
    if (args.options && !Array.isArray(args.options)) return 'options must be an array of {label}'
    return null
  }
  if (name === 'quiz') {
    if (!args.question) return 'question is required'
    if (args.kind === 'recall') return args.correctAnswer ? null : 'recall quizzes need correctAnswer'
    if (!Array.isArray(args.options) || args.options.length < 2) return 'choice quizzes need at least 2 options'
    const ci = Number(args.correctIndex)
    if (!Number.isInteger(ci) || ci < 0 || ci >= args.options.length) return 'correctIndex must be a valid 0-based option index'
    return null
  }
  if (name === 'assign_exercise') {
    if (!args.title || !args.instructions) return 'title and instructions are required'
    if (args.files && !Array.isArray(args.files)) return 'files must be an array of {path, content}'
    for (const f of args.files ?? []) if (typeof f?.path !== 'string' || typeof f?.content !== 'string') return 'each file needs path and content strings'
    return null
  }
  return 'not an interaction tool'
}
