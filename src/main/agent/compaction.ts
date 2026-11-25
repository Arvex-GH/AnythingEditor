/**
 * Context compaction: when the session outgrows the provider's budget, the
 * older part is summarized (by the model, for itself) and only the recent
 * tail is sent verbatim. The stored transcript is never modified.
 */
import type { ChatMessage, Provider, Session } from '@shared/types'
import { saveSession } from '../store/sessions'
import { backgroundProvider } from '../store/settings'
import { nowIso } from '../store/fsutil'
import { streamChat } from './llm'

const DEFAULT_BUDGET = 240_000 // characters (~60k tokens)

function size(m: ChatMessage): number {
  return (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + 20
}

export function renderForSummary(msgs: ChatMessage[]): string {
  return msgs
    .filter((m) => !m.error)
    .map((m) => {
      if (m.role === 'user') return `LEARNER: ${m.content}`
      if (m.role === 'tool') return `TOOL RESULT (${m.name}): ${(m.content ?? '').slice(0, 1500)}`
      const calls = (m.tool_calls ?? []).map((t) => `CALL ${t.function.name}(${t.function.arguments.slice(0, 1500)})`).join('\n')
      return `TUTOR: ${m.content ?? ''}${calls ? '\n' + calls : ''}`
    })
    .join('\n\n')
}

export async function maybeCompact(session: Session, provider: Provider, signal: AbortSignal): Promise<void> {
  const budget = provider.contextChars && provider.contextChars > 20_000 ? provider.contextChars : DEFAULT_BUDGET
  const start = session.compaction?.uptoIndex ?? 0
  const tail = session.messages.slice(start)
  const total = tail.reduce((a, m) => a + size(m), 0)
  if (total < budget) return
  // Keep roughly the last 40% verbatim; cut at a learner message boundary.
  let keep = 0
  let cut = session.messages.length
  for (let i = session.messages.length - 1; i > start; i--) {
    keep += size(session.messages[i])
    if (keep > budget * 0.4 && session.messages[i].role === 'user' && !session.messages[i].hidden) {
      cut = i
      break
    }
  }
  if (cut >= session.messages.length - 1 || cut <= start) return
  const older = session.messages.slice(start, cut)
  const prompt = [
    'You are summarizing the earlier part of a programming tutoring session so the tutor can continue seamlessly. Write a dense summary for yourself (max ~600 words):',
    "- the learner's goal and background; what was taught, in order; key code/exercises and how he did",
    '- misconceptions found and whether they were repaired; his current edge; open threads; files in the workspace that matter',
    session.compaction ? `\nEARLIER SUMMARY:\n${session.compaction.summary}` : '',
    `\nTRANSCRIPT:\n${renderForSummary(older).slice(0, 200_000)}`
  ].join('\n')
  const p = backgroundProvider() ?? provider
  const res = await streamChat({ provider: p, messages: [{ role: 'user', content: prompt }], signal, temperature: 0.2 })
  if (!res.content.trim()) return
  session.compaction = { summary: res.content.trim(), uptoIndex: cut, at: nowIso() }
  saveSession(session, false)
}
