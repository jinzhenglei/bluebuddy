/**
 * SSE（Server-Sent Events）流解析器。
 *
 * 为什么单独拆出来：网络层（fetch/undici）返回的 Uint8Array 分片边界是任意的，
 * 完全可能把 "data: {...}\n\n" 这一行从中间切断。必须自己维护一个跨分片的缓冲区，
 * 只有凑齐了 SSE 规定的事件分隔符（空行）才算一条完整事件——这是流式解析最容易
 * 出错的地方，所以用纯函数 + 单元测试把它锁死，而不是塞进网络请求代码里顺手写。
 */

export type SseEvent = { kind: 'data'; payload: string } | { kind: 'done' }

export interface SseParser {
  /** 喂入一段原始文本（可能是半行），返回本次新解析出的完整事件 */
  push(chunk: string): SseEvent[]
  /** 流结束时调用：丢弃残留的不完整数据，返回空数组（不产出假事件） */
  flush(): SseEvent[]
}

export function createSseParser(): SseParser {
  // 用 \n\n 作为事件边界；单条事件内可能有多个 data: 行（SSE 规范允许拼接），
  // 但本项目对接的 OpenAI 兼容端点每条事件只有一行 data:，先按这个约定实现，
  // 后续如果发现某端点用多行拼接，再在这里扩展（不需要改调用方）。
  let buffer = ''

  function drain(): SseEvent[] {
    const events: SseEvent[] = []
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())

      // 纯注释行（keep-alive）等没有 data: 的事件块，直接跳过
      if (dataLines.length === 0) {
        separatorIndex = buffer.indexOf('\n\n')
        continue
      }

      const payload = dataLines.join('\n')
      if (payload === '[DONE]') {
        events.push({ kind: 'done' })
      } else {
        events.push({ kind: 'data', payload })
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
    return events
  }

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk
      return drain()
    },
    flush(): SseEvent[] {
      // 流已关闭但缓冲区仍有残留 —— 说明最后一条事件不完整（网络截断/异常关闭），
      // 按防御性原则直接丢弃，不猜测其内容。
      buffer = ''
      return []
    }
  }
}

/**
 * 从一条 SSE data 载荷中提取本次增量文本。
 * 容忍三种"合法但无内容"的情况：delta 里没有 content 字段（如仅 role 变更的首包）、
 * choices 为空数组、JSON 本身脏数据 —— 都返回空串而不抛异常，
 * 保证单条脏数据不会中断整个对话流（这是流式系统常见的鲁棒性要求）。
 */
export function extractDeltaContent(payload: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return ''
  }

  if (typeof parsed !== 'object' || parsed === null) return ''
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''

  const first = choices[0]
  if (typeof first !== 'object' || first === null) return ''
  const delta = (first as { delta?: unknown }).delta
  if (typeof delta !== 'object' || delta === null) return ''
  const content = (delta as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

/**
 * 从 SSE 开包中提取工具调用增量。
 *
 * OpenAI 流式 tool_calls 的约定：
 * - delta.tool_calls 是个数组，每项用 index 区分并发工具调用（0, 1, 2…）
 * - 同一个 index 里：首个包带 id + function.name，后续包只有 function.arguments 片段
 * - arguments 逐段追加，拼接后才是完整 JSON
 *
 * 防御式设计：非法 JSON / 缺字段都返回空数组而不抛异常。
 */
export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argsChunk?: string
}

export function extractToolCallDeltas(payload: string): ToolCallDelta[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return []
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return []
  const delta = (first as { delta?: unknown }).delta
  if (typeof delta !== 'object' || delta === null) return []
  const tc = (delta as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(tc)) return []

  const result: ToolCallDelta[] = []
  for (const item of tc) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    if (typeof o.index !== 'number') continue
    const fn = o.function as Record<string, unknown> | undefined
    const d: ToolCallDelta = { index: o.index }
    if (typeof o.id === 'string') d.id = o.id
    if (fn && typeof fn.name === 'string') d.name = fn.name
    if (fn && typeof fn.arguments === 'string') d.argsChunk = fn.arguments
    result.push(d)
  }
  return result
}

/**
 * 从一条 SSE data 载荷中提取思考过程增量（reasoning）。
 * DeepSeek/mimo 等思考模型在流式 delta 里用 reasoning_content 字段下发内部思考，
 * 少数端点用 reasoning；两者都容忍，缺失/脏数据返回空串（与 extractDeltaContent 同约定）。
 */
export function extractReasoningDelta(payload: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return ''
  }

  if (typeof parsed !== 'object' || parsed === null) return ''
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''

  const first = choices[0]
  if (typeof first !== 'object' || first === null) return ''
  const delta = (first as { delta?: unknown }).delta
  if (typeof delta !== 'object' || delta === null) return ''
  const d = delta as { reasoning_content?: unknown; reasoning?: unknown }
  if (typeof d.reasoning_content === 'string') return d.reasoning_content
  if (typeof d.reasoning === 'string') return d.reasoning
  return ''
}

/** 提取 finish_reason，无则返回 undefined */
export function extractFinishReason(payload: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const r = (first as { finish_reason?: unknown }).finish_reason
  return typeof r === 'string' ? r : undefined
}
