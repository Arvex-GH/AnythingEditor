/**
 * Knowledge extraction (adapted from LearnHarness's extractor → auditor →
 * merger pipeline, collapsed into one model call + a deterministic merger):
 * after a stretch of session, the model reports
 *   - propositions: the TRUE core ideas taught (new, or links to existing ids)
 *   - chains: premises that jointly entail a conclusion
 *   - evidence: what the learner demonstrated or struggled with
 *   - a short session summary for future sessions' probes.
 */
import type { ChatMessage, Session } from '@shared/types'
import { languageInfo } from '@shared/languages'
import { emitAgent } from '../bus'
import { getSession, saveSession } from '../store/sessions'
import { backgroundProvider } from '../store/settings'
import { getGraph, mergeFindings, searchNodes, type Findings } from '../store/graph'
import { nowIso } from '../store/fsutil'
import { streamChat, parseArgs, type ToolSpec } from './llm'

const inFlight = new Set<string>()
const MIN_NEW_MESSAGES = 8

const SUBMIT: ToolSpec = {
  type: 'function',
  function: {
    name: 'submit_findings',
    description: 'Submit the findings for this stretch of the session.',
    parameters: {
      type: 'object',
      properties: {
        propositions: {
          type: 'array',
          description:
            'Core ideas this stretch taught. For an idea the graph already holds, reuse its existing id ("n_…") verbatim and repeat its name. For a new idea use a local id like "p1" with a short name and a precise, self-contained statement.',
          items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, statement: { type: 'string' } }, required: ['id', 'name', 'statement'] }
        },
        chains: {
          type: 'array',
          description: 'Reasoning chains: premises (ids) that JOINTLY entail the conclusion (id). Only real derivations.',
          items: { type: 'object', properties: { premises: { type: 'array', items: { type: 'string' } }, conclusion: { type: 'string' } }, required: ['premises', 'conclusion'] }
        },
        evidence: {
          type: 'array',
          description: 'What the learner showed in quizzes, exercises and explanations. One entry per topic observed.',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              propositionId: { type: 'string' },
              outcome: { type: 'string', enum: ['demonstrated', 'shaky', 'gap', 'misconception'] },
              note: { type: 'string', description: 'One sentence: the specific observation.' }
            },
            required: ['topic', 'outcome', 'note']
          }
        },
        sessionSummary: { type: 'string', description: "3-6 sentences: the session's goal, what was covered so far, where the learner stands now, and what comes next." },
        sessionTitle: { type: 'string', description: 'A short descriptive session title (max 6 words), e.g. "Rust ownership & borrowing".' }
      },
      required: ['propositions', 'chains', 'evidence', 'sessionSummary']
    }
  }
}

const INSTRUCTIONS = `You are the extraction stage of a programming-learning application. You read one stretch of a tutoring session and report what it taught for the learner's global knowledge graph, plus evidence about the learner.

THE GRAPH holds TRUE ideas about programming and the language — never anything about the learner: not "the learner understands X" but X. A misconception enters as its TRUE correction. Each statement is one self-contained idea at full precision that stands alone for a reader who never saw this session (e.g. name "Move semantics on assignment", statement "Assigning a non-Copy value to another variable moves ownership; the original variable can no longer be used.").

Extract the load-bearing ideas — what a reference on the language would teach — not every example or aside. Examples, exercise specifics and restatements are not core ideas.

CHAINS: premises that JOINTLY entail a conclusion. Foundations at the bottom, derived ideas above. Only real derivations; skip narrative connections.

IDENTITY: when an idea is already in EXISTING IDEAS, reference its id verbatim instead of restating it. Paraphrases of an existing idea ARE that idea.

EVIDENCE is separate: from the learner's quiz answers, exercise submissions and messages, record what he demonstrated, where he was shaky, real gaps and misconceptions. Be specific and honest.

Submit everything with one submit_findings call. Include every field even when empty.`

function renderStretch(msgs: ChatMessage[]): string {
  const out: string[] = []
  for (const m of msgs) {
    if (m.error) continue
    if (m.role === 'user') {
      if (!m.hidden) out.push(`LEARNER: ${m.content}`)
      continue
    }
    if (m.role === 'tool') {
      const c = m.content ?? ''
      if (m.name === 'quiz' || m.name === 'ask_user_question') out.push(`LEARNER ANSWER: ${c}`)
      else if (m.name === 'assign_exercise') out.push(`LEARNER SUBMISSION:\n${c.slice(0, 3000)}`)
      else if (m.name === 'run_code') out.push(`RUN RESULT: ${c.slice(0, 800)}`)
      continue
    }
    if (m.content?.trim()) out.push(`TUTOR: ${m.content}`)
    for (const tc of m.tool_calls ?? []) {
      let a: any = {}
      try {
        a = parseArgs(tc.function.arguments)
      } catch {
        continue
      }
      if (tc.function.name === 'quiz') {
        out.push(`QUIZ: ${a.question}${a.options ? `\nOptions: ${a.options.join(' | ')}\nCorrect: ${a.options[a.correctIndex]} — ${a.explanation ?? ''}` : `\nCorrect answer: ${a.correctAnswer}`}`)
      } else if (tc.function.name === 'assign_exercise') {
        out.push(`EXERCISE "${a.title}": ${a.instructions}\n${(a.files ?? []).map((f: any) => `--- ${f.path}\n${String(f.content).slice(0, 1500)}`).join('\n')}`)
      } else if (tc.function.name === 'write_file') {
        out.push(`TUTOR WROTE ${a.path}:\n${String(a.content ?? '').slice(0, 1500)}`)
      } else if (tc.function.name === 'probe_done') {
        out.push(`ASSESSMENT: ${a.summary}\n${(a.strands ?? []).map((s: any) => `- ${s.strand}: ${s.assessment}`).join('\n')}`)
      } else if (tc.function.name === 'ask_user_question') {
        out.push(`QUESTION: ${a.question}`)
      }
    }
  }
  return out.join('\n\n')
}

export function scheduleExtraction(sessionId: string, force: boolean): void {
  const s = getSession(sessionId)
  if (!s || inFlight.has(sessionId)) return
  const from = s.extraction?.uptoIndex ?? 0
  const fresh = s.messages.slice(from).filter((m) => !m.error && !m.hidden)
  if (fresh.length === 0) return
  if (!force && fresh.length < MIN_NEW_MESSAGES) return
  inFlight.add(sessionId)
  extract(sessionId)
    .catch((err) => console.error('[extraction]', err))
    .finally(() => inFlight.delete(sessionId))
}

/** Force extraction of whatever is left (e.g. when leaving a session). */
export function flushExtraction(sessionId: string): void {
  scheduleExtraction(sessionId, true)
}

async function extract(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  const provider = backgroundProvider()
  if (!session || !provider) return
  const from = session.extraction?.uptoIndex ?? 0
  const upto = session.messages.length
  const stretch = renderStretch(session.messages.slice(from, upto))
  if (!stretch.trim()) return
  emitAgent({ type: 'status', sessionId, status: 'extracting' })
  const graph = getGraph()
  const own = graph.nodes.filter((n) => n.sessions.includes(sessionId))
  const candidates = searchNodes(stretch.slice(0, 20000), { language: session.language, limit: 30 }).filter((n) => !own.some((o) => o.id === n.id))
  const existing = [...own, ...candidates]
  const lang = languageInfo(session.language)
  const prompt = [
    `LANGUAGE: ${lang.name}`,
    session.summary ? `SESSION SO FAR (your earlier summary): ${session.summary}` : '',
    existing.length ? `EXISTING IDEAS (reuse ids verbatim):\n${existing.map((n) => `- ${n.id} :: ${n.name} — ${n.statement}`).join('\n')}` : 'EXISTING IDEAS: (none yet)',
    `\nSTRETCH:\n${stretch.slice(0, 120_000)}`
  ]
    .filter(Boolean)
    .join('\n\n')
  try {
    const res = await streamChat({
      provider,
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: prompt }
      ],
      tools: [SUBMIT],
      toolChoice: { type: 'function', function: { name: 'submit_findings' } },
      temperature: 0.2
    }).catch(async (err) => {
      // Some servers don't support forced tool_choice objects.
      if (String(err?.message).includes('tool_choice')) {
        return streamChat({ provider, messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: prompt }], tools: [SUBMIT], toolChoice: 'required', temperature: 0.2 })
      }
      throw err
    })
    let raw = res.toolCalls.find((t) => t.name === 'submit_findings')?.arguments
    if (!raw && res.content) raw = res.content // JSON in content fallback
    if (!raw) return
    const f = parseArgs(raw) as Findings & { sessionSummary?: string; sessionTitle?: string }
    const stats = mergeFindings(f, sessionId, session.language)
    const fresh = getSession(sessionId)
    if (!fresh) return
    if (f.sessionSummary) fresh.summary = f.sessionSummary
    if (f.sessionTitle && f.sessionTitle.length < 60) fresh.title = f.sessionTitle
    fresh.extraction = { uptoIndex: upto, at: nowIso() }
    saveSession(fresh, false)
    emitAgent({ type: 'session', session: fresh })
    console.log(`[extraction] ${sessionId}: +${stats.added} ideas, ${stats.linked} linked, +${stats.chains} chains`)
  } finally {
    emitAgent({ type: 'status', sessionId, status: 'extracting', detail: 'done' })
  }
}
