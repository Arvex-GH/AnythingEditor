/**
 * The agent turn loop. A turn makes as many model calls as needed, executing
 * tools between them, until the model answers without tools or poses an
 * interaction (question / quiz / exercise) that waits for the learner.
 */
import { statSync } from 'node:fs'
import type { ChatMessage, PendingInteraction, Session } from '@shared/types'
import { languageInfo } from '@shared/languages'
import { emitAgent } from '../bus'
import { getSession, saveSession, listSessions } from '../store/sessions'
import { activeProvider } from '../store/settings'
import { newId, nowIso } from '../store/fsutil'
import { editor } from '../editor/manager'
import { runForAgent } from '../run-service'
import { getSettings } from '../store/settings'
import { streamChat, parseArgs, type WireMessage } from './llm'
import { buildSystemPrompt } from './prompts'
import { INTERACTION_TOOLS, executeTool, toolsForPhase, validateInteraction } from './tools'
import { maybeCompact } from './compaction'
import { scheduleExtraction } from './extraction'

const running = new Map<string, AbortController>()
const MAX_STEPS = 30

export function isBusy(sessionId: string): boolean {
  return running.has(sessionId)
}

function msg(partial: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  return { id: newId('m_'), createdAt: nowIso(), ...partial }
}

function publish(session: Session) {
  emitAgent({ type: 'session', session })
  emitAgent({ type: 'sessions', sessions: listSessions().map((s) => ({ ...s, busy: running.has(s.id) })) })
}

function status(sessionId: string, s: 'idle' | 'thinking' | 'tool' | 'error' | 'extracting', detail?: string) {
  emitAgent({ type: 'status', sessionId, status: s, detail })
}

/** Project the stored record into provider wire messages. */
export function toWire(session: Session): WireMessage[] {
  const out: WireMessage[] = [{ role: 'system', content: buildSystemPrompt(session) }]
  const start = session.compaction?.uptoIndex ?? 0
  if (session.compaction) {
    out.push({ role: 'user', content: `[Summary of the earlier part of this session — written by you for yourself]\n${session.compaction.summary}` })
    out.push({ role: 'assistant', content: 'Understood. Continuing from there.' })
  }
  const msgs = session.messages.slice(start).filter((m) => !m.error)
  const answered = new Set(msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role === 'assistant') {
      const w: WireMessage = { role: 'assistant', content: m.content ?? '' }
      if (m.tool_calls?.length) w.tool_calls = m.tool_calls
      out.push(w)
      // Repair: tool calls without results (aborted turns) get a synthetic result,
      // except the currently pending interaction (never sent while pending anyway).
      const missing = (m.tool_calls ?? []).filter((tc) => !answered.has(tc.id) && tc.id !== session.pending?.toolCallId)
      // results must come right after the assistant message; collect following tool msgs first
      const following: WireMessage[] = []
      while (i + 1 < msgs.length && msgs[i + 1].role === 'tool') {
        const t = msgs[++i]
        following.push({ role: 'tool', tool_call_id: t.tool_call_id, content: t.content ?? '' })
      }
      out.push(...following)
      for (const tc of missing) out.push({ role: 'tool', tool_call_id: tc.id, content: '(interrupted — this call did not complete)' })
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content ?? '' })
    } else {
      out.push({ role: 'user', content: m.content ?? '' })
    }
  }
  return out
}

function autoTitle(session: Session, text: string) {
  if (session.title && session.title !== 'New session') return
  const first = text.replace(/\s+/g, ' ').trim()
  session.title = `${languageInfo(session.language).name}: ${first.length > 48 ? first.slice(0, 46) + '…' : first}`
}

// ─── public entry points ────────────────────────────────────────────────

export async function sendUserMessage(sessionId: string, text: string, meta?: Record<string, unknown>): Promise<void> {
  const session = getSession(sessionId)
  if (!session) throw new Error('Session not found')
  if (running.has(sessionId)) throw new Error('The tutor is still working — wait or press Stop.')
  if (session.pending) {
    // The learner wrote in chat instead of answering: close the interaction.
    session.messages.push(
      msg({ role: 'tool', tool_call_id: session.pending.toolCallId, name: session.pending.kind, content: 'The learner did not answer this directly and wrote in the chat instead (see next message).', meta: { skipped: true } })
    )
    session.pending = undefined
  }
  autoTitle(session, text)
  session.messages.push(msg({ role: 'user', content: text, meta }))
  saveSession(session)
  publish(session)
  await runTurn(sessionId)
}

export async function answerInteraction(sessionId: string, toolCallId: string, answer: any): Promise<void> {
  const session = getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const p = session.pending
  if (!p || p.toolCallId !== toolCallId) throw new Error('This question is no longer open.')
  if (running.has(sessionId)) throw new Error('The tutor is still working.')
  let content: string
  let meta: Record<string, unknown> = { answer }
  if (p.kind === 'ask_user_question') {
    const picked: string[] = answer.selected ?? []
    content = `The learner answered: ${picked.length ? picked.map((x) => `"${x}"`).join(', ') : '(no option picked)'}${answer.text ? `\nIn their own words: ${answer.text}` : ''}`
  } else if (p.kind === 'quiz') {
    const q = p.input
    if (q.kind === 'recall') {
      content = answer.dontKnow
        ? "The learner said they don't know (a genuine gap, not a wrong answer)."
        : `The learner's answer: """${answer.text ?? ''}"""\nYour committed answer: ${q.correctAnswer}\nGrade it strictly: name exactly what he got right and what he missed.`
    } else {
      const ci = Number(q.correctIndex)
      if (answer.dontKnow) {
        content = `The learner chose "I don't know" (a genuine gap). Correct answer: "${q.options[ci]}".${answer.thinking ? ` Their thinking: ${answer.thinking}` : ''}`
        meta = { ...meta, correct: false }
      } else {
        const sel = Number(answer.selectedIndex)
        const correct = sel === ci
        meta = { ...meta, correct }
        content =
          `The learner picked: "${q.options[sel]}" — ${correct ? 'CORRECT' : 'INCORRECT'}${correct ? '' : ` (correct: "${q.options[ci]}")`}.` +
          `${typeof answer.confidence === 'number' ? ` Confidence: ${answer.confidence}% (chance is ${Math.round(100 / q.options.length)}%).` : ''}` +
          `\nTheir thinking: ${answer.thinking?.trim() ? answer.thinking : '(none given)'}`
      }
    }
  } else {
    const sub = await collectSubmission(session, p, answer.note)
    content = sub.content
    meta = { ...meta, ...sub.meta }
  }
  session.messages.push(msg({ role: 'tool', tool_call_id: p.toolCallId, name: p.kind, content, meta }))
  session.pending = undefined
  saveSession(session)
  publish(session)
  await runTurn(sessionId)
}

/** Submit from the editor (button or <leader>as). */
export async function submitExercise(sessionId: string, note?: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) throw new Error('Session not found')
  if (session.pending?.kind === 'assign_exercise') return answerInteraction(sessionId, session.pending.toolCallId, { note })
  // No open exercise: ask for a review of the current file.
  const st = await editor.state(session)
  const file = st?.file ? editor.rel(session, st.file) : undefined
  let text = note?.trim() || 'Please review my code.'
  if (file) {
    const r = await editor.readFile(session, file)
    if (r) text += `\n\nFile \`${file}\`:\n\`\`\`${languageInfo(session.language).id}\n${r.text.slice(0, 12000)}\n\`\`\``
  }
  return sendUserMessage(sessionId, text, { review: file })
}

export function stopTurn(sessionId: string): void {
  running.get(sessionId)?.abort()
}

async function collectSubmission(session: Session, p: PendingInteraction, note?: string): Promise<{ content: string; meta: Record<string, unknown> }> {
  const input = p.input
  await editor.saveAll()
  const paths: string[] = []
  const add = (x?: string) => {
    if (x && !paths.includes(x)) paths.push(x)
  }
  add(input.open)
  for (const f of input.files ?? []) add(f.path)
  // Also include other files the learner touched since the exercise was posed.
  const since = new Date(p.createdAt).getTime()
  for (const f of editor.listFiles(session)) {
    if (f.dir || paths.length >= 8) continue
    try {
      if (statSync(f.path).mtimeMs > since + 500) add(f.rel)
    } catch {
      /* ignore */
    }
  }
  if (paths.length === 0) {
    const st = await editor.state(session)
    if (st?.file) add(editor.rel(session, st.file))
  }
  const parts: string[] = [`The learner submitted the exercise "${input.title}".`, `Learner's note: ${note?.trim() || '(none)'}`]
  for (const rel of paths) {
    try {
      const r = await editor.readFile(session, rel)
      if (!r) continue
      const lines = r.text.split('\n')
      parts.push(`=== ${rel} (${lines.length} lines) ===\n${lines.map((l, i) => `${String(i + 1).padStart(3)}│ ${l}`).join('\n').slice(0, 12000)}`)
    } catch {
      /* outside workspace */
    }
  }
  let runResult: unknown
  const runPath = input.runPath === '' ? undefined : (input.runPath ?? input.open ?? input.files?.[0]?.path)
  if (runPath && getSettings().agent.allowRunCode) {
    try {
      const abs = editor.resolvePath(session, runPath)
      const res = await runForAgent(session, abs, undefined, new AbortController().signal)
      runResult = res
      parts.push(`=== run: ${res.command} (exit ${res.exitCode}${res.timedOut ? ', timed out' : ''}) ===\n--- stdout ---\n${res.stdout.slice(0, 5000) || '(empty)'}\n--- stderr ---\n${res.stderr.slice(0, 3000) || '(empty)'}`)
    } catch (err: any) {
      parts.push(`=== run failed: ${err.message} ===`)
    }
  }
  if (editor.hasLiveDiagnostics(session)) {
    const d = await editor.diagnostics(session)
    if (d.length) parts.push(`=== LSP diagnostics ===\n${d.slice(0, 40).map((x) => `${editor.rel(session, x.file)}:${x.line}:${x.col} ${x.severity}: ${x.message}`).join('\n')}`)
  }
  return { content: parts.join('\n\n'), meta: { files: paths, run: runResult } }
}

// ─── the loop ───────────────────────────────────────────────────────────

export async function runTurn(sessionId: string): Promise<void> {
  if (running.has(sessionId)) return
  const ac = new AbortController()
  running.set(sessionId, ac)
  let session = getSession(sessionId)!
  publish(session)
  let handoff = false
  let draftTimer: NodeJS.Timeout | null = null
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      session = getSession(sessionId)!
      const provider = activeProvider(session.providerId)
      if (!provider) throw new Error('No AI provider configured. Open Settings → Providers and add an OpenAI-compatible endpoint.')
      status(sessionId, 'thinking')
      await maybeCompact(session, provider, ac.signal)

      const messageId = newId('m_')
      let lastDraft = 0
      const result = await streamChat({
        provider,
        model: session.model,
        messages: toWire(session),
        tools: toolsForPhase(session.phase),
        signal: ac.signal,
        onDelta: (acc) => {
          const now = Date.now()
          const emit = () => {
            lastDraft = Date.now()
            emitAgent({
              type: 'draft',
              sessionId,
              draft: { messageId, content: acc.content, reasoning: acc.reasoning, toolCalls: acc.toolCalls.map((t) => ({ name: t.name, arguments: t.arguments })) }
            })
          }
          if (draftTimer) clearTimeout(draftTimer)
          if (now - lastDraft > 50) emit()
          else draftTimer = setTimeout(emit, 50)
        }
      })
      if (draftTimer) clearTimeout(draftTimer)
      session.usage = {
        prompt: (session.usage?.prompt ?? 0) + (result.usage?.prompt_tokens ?? 0),
        completion: (session.usage?.completion ?? 0) + (result.usage?.completion_tokens ?? 0)
      }
      const assistant: ChatMessage = {
        id: messageId,
        createdAt: nowIso(),
        role: 'assistant',
        content: result.content,
        reasoning: result.reasoning || undefined,
        tool_calls: result.toolCalls.length ? result.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })) : undefined
      }
      session.messages.push(assistant)
      saveSession(session)
      emitAgent({ type: 'draft', sessionId, draft: null })
      publish(session)

      if (!assistant.tool_calls?.length) {
        if (handoff) {
          handoff = false
          session.phase = session.mode === 'project' ? 'project' : 'teach'
          session.messages.push(
            msg({
              role: 'user',
              hidden: true,
              content:
                session.mode === 'project'
                  ? '[AnythingEditor] The measuring phase is complete; the assessment is in your context. You are now the project mentor. Plan the build milestones with plan_init, present them briefly, and ask the learner to confirm.'
                  : '[AnythingEditor] The measuring phase is complete; the assessment is in your context. You are now the teacher. Plan the minimal path with plan_init, present it briefly, and ask the learner to confirm before teaching.'
            })
          )
          saveSession(session)
          publish(session)
          scheduleExtraction(sessionId, true)
          continue
        }
        break
      }

      // Execute tools in order; the first valid interaction becomes pending.
      let posed = false
      for (const tc of assistant.tool_calls) {
        if (ac.signal.aborted) break
        const name = tc.function.name
        let args: any
        try {
          args = parseArgs(tc.function.arguments)
        } catch (err: any) {
          session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: `Error: ${err.message}. Retry with valid JSON arguments.` }))
          continue
        }
        if (INTERACTION_TOOLS.has(name)) {
          if (posed) {
            session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: 'Not shown: only one question or exercise at a time. Ask it after the learner answers the first one.' }))
            continue
          }
          const invalid = validateInteraction(name, args)
          if (invalid) {
            session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: `Error: ${invalid}. Fix the call and try again.` }))
            continue
          }
          if (name === 'assign_exercise') {
            try {
              for (const f of args.files ?? []) await editor.writeFile(session, f.path, f.content, false)
              const open = args.open || args.files?.[0]?.path
              if (open) await editor.openFile(session, open)
            } catch (err: any) {
              session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: `Error writing exercise files: ${err.message}` }))
              continue
            }
          }
          session.pending = { toolCallId: tc.id, kind: name as PendingInteraction['kind'], input: args, createdAt: nowIso() }
          posed = true
          continue
        }
        status(sessionId, 'tool', name)
        try {
          const out = await executeTool(name, args, { session, signal: ac.signal })
          session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: out.content, meta: out.meta }))
          if (out.handoff) handoff = true
        } catch (err: any) {
          session.messages.push(msg({ role: 'tool', tool_call_id: tc.id, name, content: `Error: ${err.message}` }))
        }
        saveSession(session)
        publish(session)
      }
      saveSession(session)
      publish(session)
      if (posed) break // wait for the learner
    }
  } catch (err: any) {
    const aborted = err?.name === 'AbortError' || ac.signal.aborted
    session = getSession(sessionId)!
    if (!aborted) {
      console.error('[agent]', err)
      session.messages.push(msg({ role: 'assistant', content: `⚠️ ${err?.message ?? String(err)}`, error: true }))
      status(sessionId, 'error', err?.message)
    } else {
      session.messages.push(msg({ role: 'assistant', content: '⏹ Stopped.', error: true }))
    }
    saveSession(session)
  } finally {
    if (draftTimer) clearTimeout(draftTimer)
    running.delete(sessionId)
    emitAgent({ type: 'draft', sessionId, draft: null })
    status(sessionId, 'idle')
    const s = getSession(sessionId)
    if (s) publish(s)
    scheduleExtraction(sessionId, false)
  }
}
