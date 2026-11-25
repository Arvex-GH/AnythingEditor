// Types shared between the main process, the preload bridge and the renderer.

export type SessionMode = 'learn' | 'project' | 'practice'

/**
 * Phases (adapted from the LearnHarness measure → plan → teach arc):
 *  - probe:    measure what the learner already knows (graph + questions + code tasks)
 *  - teach:    plan a minimal path and teach one reasoning step at a time
 *  - project:  build a learner-chosen project together, never handing out solutions
 *  - practice: varied problems drawn from the knowledge graph
 */
export type Phase = 'probe' | 'teach' | 'project' | 'practice'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
  reasoning?: string
  createdAt: string
  /** Not shown in the chat UI (e.g. phase hand-off steering). */
  hidden?: boolean
  /** UI metadata (answers, grading, run output...). Never sent to the model. */
  meta?: Record<string, unknown>
  /** Marks a provider error message shown in the UI only. */
  error?: boolean
}

export type PlanStatus = 'todo' | 'current' | 'done'

export interface PlanNode {
  id: string
  title: string
  detail?: string
  dependsOn: string[]
  status: PlanStatus
}

export interface Plan {
  goal: string
  nodes: PlanNode[]
  updatedAt: string
}

export interface ProbeStrand {
  strand: string
  assessment: string
  level?: 'none' | 'beginner' | 'intermediate' | 'advanced'
}

export interface Assessment {
  goal: string
  summary: string
  strands: ProbeStrand[]
  createdAt: string
}

export type PendingKind = 'ask_user_question' | 'quiz' | 'assign_exercise'

export interface PendingInteraction {
  toolCallId: string
  kind: PendingKind
  input: any
  createdAt: string
}

export interface Session {
  id: string
  title: string
  language: string
  mode: SessionMode
  phase: Phase
  goal?: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  assessment?: Assessment
  plan?: Plan
  pending?: PendingInteraction
  workspace: string
  compaction?: { summary: string; uptoIndex: number; at: string }
  extraction?: { uptoIndex: number; at: string }
  summary?: string
  providerId?: string
  model?: string
  usage?: { prompt: number; completion: number }
}

export interface SessionListItem {
  id: string
  title: string
  language: string
  mode: SessionMode
  phase: Phase
  createdAt: string
  updatedAt: string
  summary?: string
  busy?: boolean
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  /** Extra HTTP headers, e.g. for OpenRouter or gateways. */
  headers?: Record<string, string>
  temperature?: number
  /** Context budget in characters before older history is compacted. */
  contextChars?: number
  /** Optional reasoning effort for models that support it. */
  reasoningEffort?: '' | 'low' | 'medium' | 'high'
}

export type EditorMode = 'neovim' | 'builtin'

export interface Settings {
  providers: Provider[]
  activeProviderId?: string
  /** Optional cheaper model used for background extraction/compaction. */
  backgroundProviderId?: string
  editor: {
    mode: EditorMode
    nvimPath: string
    /** Use the bundled LazyVim config (isolated) or the user's own nvim config. */
    config: 'lazyvim' | 'user'
    fontSize: number
    extraExtras: string[]
  }
  agent: {
    allowRunCode: boolean
    quizStyle: 'choice' | 'recall' | 'mixed'
    learnerName: string
    language: string
  }
  ui: { chatWidth: number; sidebarCollapsed: boolean }
  workspaceRoot: string
}

export interface GraphNode {
  id: string
  name: string
  statement: string
  language: string
  aliases: string[]
  sessions: string[]
  createdAt: string
  updatedAt: string
}

export interface GraphChain {
  id: string
  premises: string[]
  conclusion: string
  sessions: string[]
  createdAt: string
}

export interface Evidence {
  at: string
  sessionId: string
  language: string
  topic: string
  propositionId?: string
  outcome: 'demonstrated' | 'shaky' | 'gap' | 'misconception'
  note: string
}

export interface GraphSnapshot {
  nodes: GraphNode[]
  chains: GraphChain[]
  evidence: Evidence[]
}

export interface StreamDraft {
  messageId: string
  content: string
  reasoning: string
  toolCalls: { name: string; arguments: string }[]
}

export type AgentEvent =
  | { type: 'session'; session: Session }
  | { type: 'sessions'; sessions: SessionListItem[] }
  | { type: 'draft'; sessionId: string; draft: StreamDraft | null }
  | { type: 'status'; sessionId: string; status: 'idle' | 'thinking' | 'tool' | 'extracting' | 'error'; detail?: string }
  | { type: 'notice'; level: 'info' | 'error'; message: string }

export interface RunResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  command: string
  durationMs: number
  timedOut?: boolean
  error?: string
}

export type RunEvent =
  | { type: 'start'; runId: string; command: string }
  | { type: 'data'; runId: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'end'; runId: string; result: RunResult }

export interface Diagnostic {
  line: number
  col: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string
}

export interface EditorState {
  file?: string
  line?: number
  col?: number
  mode?: string
}

export interface EditorStatus {
  sessionId: string | null
  mode: EditorMode
  running: boolean
  error?: string
  workspace?: string
}

/** Sent from main to the built-in editor (renderer). */
export type EditorCommand =
  | { type: 'open'; path: string }
  | { type: 'reload'; path: string }

export interface DoctorItem {
  id: string
  name: string
  purpose: string
  found: boolean
  path?: string
  version?: string
  install?: { kind: 'winget' | 'npm' | 'shell' | 'url'; value: string; label: string }
  optional?: boolean
}

export interface LanguageInfo {
  id: string
  name: string
  extensions: string[]
  mainFile: string
  icon: string
  color: string
}

export interface FileEntry {
  path: string
  rel: string
  size: number
  dir: boolean
}
