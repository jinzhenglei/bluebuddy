import {
  createSseParser,
  extractDeltaContent,
  extractFinishReason,
  extractReasoningDelta,
  extractToolCallDeltas,
  ToolCallDelta
} from './sse'
import type { ChatMessage, TestResult } from '@shared/types'
import type { OpenAIToolSpec } from '../tools/types'

export interface StreamChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  /** OpenAI function-calling 工具定义；不传 = 纯对话，不带工具能力 */
  tools?: OpenAIToolSpec[]
  /** 外部取消信号：UI 点"停止"时触发，用于提前中断读取循环 */
  signal?: AbortSignal
}

export type GatewayEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call-delta'; delta: ToolCallDelta }
  | { type: 'finish'; reason: string }
  | { type: 'done' }

/**
 * 调用 OpenAI 兼容端点的流式对话接口，产出增量事件（文本、工具调用片段、finish_reason）。
 *
 * 用 AsyncGenerator 而不是回调：调用方（Agent 引擎/IPC 层）可以用 for-await 逐段取出，
 * 天然匹配"每收到一段就推送给渲染进程一次"的需求，且中止/错误处理都走同一段代码。
 * 网络错误、非 200 响应都以异常抛出，由调用方决定如何转成 UI 可见的错误事件——
 * 引擎层不越权猜测"错误该怎么展示"，这是分层设计里很基础的一条原则。
 */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<GatewayEvent> {
  const { baseUrl, apiKey, model, messages, tools, signal } = opts

  const body: Record<string, unknown> = { model, messages, stream: true }
  if (tools && tools.length > 0) body.tools = tools

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const bodyText = await safeReadText(response)
    throw new Error(`模型服务返回 ${response.status}：${bodyText || response.statusText}`)
  }
  if (!response.body) {
    throw new Error('模型服务未返回可读取的响应流')
  }

  const parser = createSseParser()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const events = parser.push(decoder.decode(value, { stream: true }))
      for (const event of events) {
        if (event.kind === 'done') {
          yield { type: 'done' }
          return
        }
        const text = extractDeltaContent(event.payload)
        if (text) yield { type: 'delta', text }
        const reasoning = extractReasoningDelta(event.payload)
        if (reasoning) yield { type: 'reasoning', text: reasoning }
        for (const d of extractToolCallDeltas(event.payload)) {
          yield { type: 'tool-call-delta', delta: d }
        }
        const reason = extractFinishReason(event.payload)
        if (reason) yield { type: 'finish', reason }
      }

      // 中止检查放在读取循环里：AbortController 已能取消 reader.read() 本身，
      // 这里兜底处理"取消发生在上一次 read 与下一次 read 之间"的窄窗口。
      if (signal?.aborted) return
    }

    // 服务端没有显式发 [DONE] 就关闭了连接（少数兼容端点的行为差异）——
    // 视为正常结束，同样补发一个 done 事件，避免 UI 永远卡在"生成中"状态。
    parser.flush()
    yield { type: 'done' }
  } finally {
    reader.releaseLock()
  }
}

/** 非流式一次调用返回的完整 assistant 消息（可能是文本 + tool_calls） */
export interface ChatOnceResult {
  content: string
  tool_calls?: ChatMessage['tool_calls']
  finish_reason?: string
}

/**
 * 非流式单次对话：ProviderConfig.streaming 为 false 时走这里。
 * 一次拿到完整回复 + 可能的工具调用列表。复用同一套错误处理约定（非 200 抛异常）。
 */
export async function chatOnce(
  opts: Omit<StreamChatOptions, 'signal'> & { signal?: AbortSignal }
): Promise<ChatOnceResult> {
  const { baseUrl, apiKey, model, messages, tools, signal } = opts
  const body: Record<string, unknown> = { model, messages, stream: false }
  if (tools && tools.length > 0) body.tools = tools

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const bodyText = await safeReadText(response)
    throw new Error(`模型服务返回 ${response.status}：${bodyText || response.statusText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string; tool_calls?: ChatMessage['tool_calls'] }
      finish_reason?: string
    }>
  }
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content ?? '',
    tool_calls: choice?.message?.tool_calls,
    finish_reason: choice?.finish_reason
  }
}

/**
 * 连通性测试：发一条最小非流式请求，只看成败，不关心内容。
 * 用非流式是因为这条路径只需要"能不能通"，不需要打字机效果，实现更简单、失败更快。
 */
export async function testConnection(
  opts: Omit<StreamChatOptions, 'messages' | 'signal' | 'tools'>
): Promise<TestResult> {
  try {
    const response = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false
      })
    })

    if (!response.ok) {
      const bodyText = await safeReadText(response)
      return { ok: false, message: `HTTP ${response.status}：${bodyText || response.statusText}` }
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const firstContent = data.choices?.[0]?.message?.content
    return {
      ok: true,
      message: firstContent ? `模型回复：${firstContent.slice(0, 20)}` : '连接成功'
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
