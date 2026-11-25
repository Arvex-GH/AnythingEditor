/**
 * Minimal OpenAI-compatible Chat Completions client with streaming + tool calls.
 * Works with OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, LM Studio,
 * Ollama (/v1), vLLM, llama.cpp server, LiteLLM, Azure-style gateways, ...
 */
import type { Provider } from '@shared/types'

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface CompletionResult {
  content: string
  reasoning: string
  toolCalls: { id: string; name: string; arguments: string }[]
  finishReason: string | null
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface StreamOptions {
  provider: Provider
  model?: string
  messages: WireMessage[]
  tools?: ToolSpec[]
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  signal?: AbortSignal
  onDelta?: (acc: CompletionResult) => void
  temperature?: number
  maxTokens?: number
}

export function endpoint(baseUrl: string, path: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) b = b.slice(0, -'/chat/completions'.length)
  return `${b}${path}`
}

function headers(p: Provider): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/Arvex-GH/AnythingEditor', 'X-Title': 'AnythingEditor' }
  if (p.apiKey) {
    h.Authorization = `Bearer ${p.apiKey}`
    h['api-key'] = p.apiKey // Azure OpenAI style gateways
  }
  return { ...h, ...(p.headers ?? {}) }
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: string
  ) {
    super(message)
  }
}

let streamOptionsUnsupported = new Set<string>()

export async function streamChat(opts: StreamOptions): Promise<CompletionResult> {
  const { provider } = opts
  const body: Record<string, unknown> = {
    model: opts.model || provider.model,
    messages: opts.messages,
    stream: true
  }
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  const temp = opts.temperature ?? provider.temperature
  if (typeof temp === 'number') body.temperature = temp
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort
  if (!streamOptionsUnsupported.has(provider.baseUrl)) body.stream_options = { include_usage: true }

  const url = endpoint(provider.baseUrl, '/chat/completions')
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: headers(provider), body: JSON.stringify(body), signal: opts.signal })
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    throw new LlmError(`Could not reach ${url}: ${err?.message ?? err}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 400 && body.stream_options && /stream_options|include_usage/i.test(text)) {
      streamOptionsUnsupported.add(provider.baseUrl)
      return streamChat(opts)
    }
    if (res.status === 400 && body.reasoning_effort && /reasoning/i.test(text)) {
      return streamChat({ ...opts, provider: { ...provider, reasoningEffort: '' } })
    }
    throw new LlmError(`Provider returned ${res.status}: ${text.slice(0, 800)}`, res.status, text)
  }

  const acc: CompletionResult = { content: '', reasoning: '', toolCalls: [], finishReason: null }
  const ctype = res.headers.get('content-type') ?? ''
  if (ctype.includes('application/json')) {
    // Some servers ignore stream:true.
    const json: any = await res.json()
    applyChoice(acc, json.choices?.[0]?.message ?? {}, true)
    acc.finishReason = json.choices?.[0]?.finish_reason ?? null
    acc.usage = json.usage
    opts.onDelta?.(acc)
    return finalize(acc)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const toolByIndex = new Map<number, { id: string; name: string; arguments: string }>()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) throw new LlmError(`Provider error: ${JSON.stringify(chunk.error).slice(0, 600)}`)
      if (chunk.usage) acc.usage = chunk.usage
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? choice.message ?? {}
      if (typeof delta.content === 'string') acc.content += delta.content
      const r = delta.reasoning_content ?? delta.reasoning ?? delta.thinking
      if (typeof r === 'string') acc.reasoning += r
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : toolByIndex.size
          let slot = toolByIndex.get(idx)
          if (!slot) {
            slot = { id: tc.id ?? '', name: '', arguments: '' }
            toolByIndex.set(idx, slot)
          }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name += tc.function.name
          if (tc.function?.arguments) slot.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
        }
        acc.toolCalls = [...toolByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
      }
      if (choice.finish_reason) acc.finishReason = choice.finish_reason
      opts.onDelta?.(acc)
    }
  }
  return finalize(acc)
}

function applyChoice(acc: CompletionResult, msg: any, full: boolean) {
  if (typeof msg.content === 'string') acc.content = full ? msg.content : acc.content + msg.content
  const r = msg.reasoning_content ?? msg.reasoning
  if (typeof r === 'string') acc.reasoning = r
  if (Array.isArray(msg.tool_calls)) {
    acc.toolCalls = msg.tool_calls.map((tc: any) => ({
      id: tc.id ?? '',
      name: tc.function?.name ?? '',
      arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {})
    }))
  }
}

function finalize(acc: CompletionResult): CompletionResult {
  acc.toolCalls = acc.toolCalls
    .filter((t) => t.name)
    .map((t, i) => ({ ...t, id: t.id || `call_${Date.now().toString(36)}_${i}` }))
  // Some local models put <think> blocks into content.
  const m = acc.content.match(/^\s*<think>([\s\S]*?)<\/think>\s*/)
  if (m) {
    acc.reasoning = (acc.reasoning ? acc.reasoning + '\n' : '') + m[1].trim()
    acc.content = acc.content.slice(m[0].length)
  }
  return acc
}

export async function listModels(provider: Provider): Promise<string[]> {
  const res = await fetch(endpoint(provider.baseUrl, '/models'), { headers: headers(provider) })
  if (!res.ok) throw new LlmError(`GET /models returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status)
  const json: any = await res.json()
  const arr: any[] = json.data ?? json.models ?? []
  return arr.map((m) => m.id ?? m.name).filter(Boolean).sort()
}

/** Lenient JSON parsing for tool arguments produced by models. */
export function parseArgs(raw: string): any {
  if (!raw || !raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    /* fall through */
  }
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1]
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = s.slice(start, end + 1)
    try {
      return JSON.parse(slice)
    } catch {
      try {
        // trailing commas / single quotes
        return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'))
      } catch {
        /* give up */
      }
    }
  }
  throw new Error(`Tool arguments are not valid JSON: ${raw.slice(0, 200)}`)
}
