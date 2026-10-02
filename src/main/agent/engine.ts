import type { ChatMessage, ToolCall } from '@shared/types'
import { GatewayEvent } from '../llm/gateway'
import { ToolRegistry } from '../tools/registry'
import { ArtifactDraft, ToolContext } from '../tools/types'

/**
 * 引擎依赖的 LLM 调用抽象。传一个能返回 GatewayEvent 异步可迭代对象的函数即可，
 * 生产环境用 streamChat 的偏封装；测试里换成 mock 脚本，就能对引擎做纯逻辑单测。
 */
export interface LlmCallParams {
  messages: ChatMessage[]
  tools: ReturnType<ToolRegistry['toOpenAiSpecs']>
  signal?: AbortSignal
}
export type LlmCallFn = (params: LlmCallParams) => AsyncGenerator<GatewayEvent>

/** Agent 引擎向外产出的事件（IPC 层直接把它转成 renderer 推送）
 * 注意："approval-required" 不在这里 —— 那个事件的 requestId 属于 IPC 层细节，
 * 引擎只通过 requestApproval 回调向上可时提出询问，具体推什么事件给 UI 由 IPC 层实现。 */
export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; callId: string; ok: boolean; content: string }
  | { type: 'artifact'; callId: string; artifact: ArtifactDraft }
  | {
      type: 'turn-end'
      reason: 'stop' | 'max-iterations' | 'aborted' | 'error'
      error?: string
    }

export interface RunAgentTurnOptions {
  llmCall: LlmCallFn
  registry: ToolRegistry
  toolCtx: ToolContext
  /**
   * 会话消息数组，引擎原地 push 新的 assistant / tool 消息；
   * 上层（IPC/持久化层）在每次 yield 之后决定是否落盘。
   */
  messages: ChatMessage[]
  /** 高危工具批准回调；未提供时默认视为拒绝（安全兜底） */
  requestApproval?: (call: ToolCall, reason: string) => Promise<boolean>
  /**
   * 系统提示词（含技能轻量索引等）。仅拼进每轮喂给 LLM 的消息副本，
   * 不写入持久化 messages —— 技能索引现拼现用，避免入库后逐轮重复。
   */
  systemPrompt?: string
  signal?: AbortSignal
  /** 单次 turn 最多允许多少轮 tool_call→result 循环，防死锁 */
  maxIterations?: number
}

/**
 * 核心 Agent 循环。一轮 = 一次 LLM 调用 + 若有 tool_calls 则依次执行 + 把结果回填进 messages。
 * 只要模型还在请求工具，就继续下一轮，直到：
 *   - 模型不再要求调用工具（finish_reason=stop 或没有 tool_calls） → reason='stop'
 *   - 达到 maxIterations → reason='max-iterations'
 *   - signal 中止 → reason='aborted'
 *   - LLM 调用抛异常 → reason='error'
 *
 * 所有对外副作用（工具执行、事件推送、批准询问）都通过参数注入，让引擎本身可被纯逻辑测试。
 */
/** 迭代用尽时，追加到最后一次「只答题」调用的收尾指令（只进喂给模型的副本，不入库） */
const WRAP_UP_DIRECTIVE =
  '已达到最大工具调用步数。请停止请求任何工具，基于以上已获得的信息，直接用面向用户的语言给出最终结论。'

export async function* runAgentTurn(opts: RunAgentTurnOptions): AsyncGenerator<AgentEvent> {
  const {
    llmCall,
    registry,
    toolCtx,
    messages,
    requestApproval,
    signal,
    systemPrompt,
    maxIterations = 6
  } = opts

  const toolSpecs = registry.toOpenAiSpecs()

  /** 一次流式调用的聚合容器 */
  interface Agg {
    text: string
    reasoning: string
    byIndex: Map<number, { id: string; name: string; args: string }>
  }
  const newAgg = (): Agg => ({ text: '', reasoning: '', byIndex: new Map() })

  // 基于当前 messages 现拼喂给 LLM 的副本：reasoning / createdAt 字段剥离
  // （只供人回看与 UI 展示，进上下文既浪费 token 又会干扰模型）；
  // 有 systemPrompt 且尚未含 system 时前置一条
  const toCallMessages = (): ChatMessage[] => {
    const stripped = messages.map(stripForLlm)
    return systemPrompt && stripped[0]?.role !== 'system'
      ? [{ role: 'system', content: systemPrompt }, ...stripped]
      : stripped
  }

  // 跑一次 LLM 流式调用：向外产出增量事件，同时把文本 / 思考 / 工具调用聚合进 agg
  async function* streamPass(
    callMessages: ChatMessage[],
    tools: ReturnType<ToolRegistry['toOpenAiSpecs']>,
    agg: Agg
  ): AsyncGenerator<AgentEvent> {
    for await (const ev of llmCall({ messages: callMessages, tools, signal })) {
      if (signal?.aborted) break
      if (ev.type === 'delta') {
        agg.text += ev.text
        yield { type: 'text-delta', text: ev.text }
      } else if (ev.type === 'reasoning') {
        // 思考内容透传给 UI 展示，同时累进本轮 assistant 消息落库，但不混进正文 content
        agg.reasoning += ev.text
        yield { type: 'reasoning-delta', text: ev.text }
      } else if (ev.type === 'tool-call-delta') {
        const cur = agg.byIndex.get(ev.delta.index) ?? { id: '', name: '', args: '' }
        if (ev.delta.id) cur.id = ev.delta.id
        if (ev.delta.name) cur.name = ev.delta.name
        if (ev.delta.argsChunk) cur.args += ev.delta.argsChunk
        agg.byIndex.set(ev.delta.index, cur)
      }
      // finish / done 事件不需要向外透传，循环结束后基于聚合结果决定
    }
  }

  const buildCalls = (agg: Agg): ToolCall[] =>
    [...agg.byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({
        id: v.id,
        type: 'function' as const,
        function: { name: v.name, arguments: v.args }
      }))

  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) {
      yield { type: 'turn-end', reason: 'aborted' }
      return
    }

    const agg = newAgg()
    try {
      yield* streamPass(toCallMessages(), toolSpecs, agg)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'turn-end', reason: 'error', error: message }
      return
    }

    if (signal?.aborted) {
      yield { type: 'turn-end', reason: 'aborted' }
      return
    }

    const calls = buildCalls(agg)

    // 追加 assistant 消息（含 tool_calls / reasoning）到会话
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: agg.text,
      ...(agg.reasoning ? { reasoning: agg.reasoning } : {}),
      ...(calls.length > 0 ? { tool_calls: calls } : {})
    }
    messages.push(assistantMsg)

    if (calls.length === 0) {
      yield { type: 'turn-end', reason: 'stop' }
      return
    }

    // 依次执行工具调用
    for (const call of calls) {
      if (signal?.aborted) {
        yield { type: 'turn-end', reason: 'aborted' }
        return
      }
      yield { type: 'tool-call', call }

      const tool = registry.get(call.function.name)
      const needsApproval = tool?.requiresApproval === true
      if (needsApproval) {
        const parsedInput = safeParseJson(call.function.arguments)
        // approvalReason 是工具侧回调，拿到的是 zod 校验前的原始 JSON；一旦抛异常会
        // 沿生成器冒泡打断整个 turn（表现为莫名错误 + 卡在"执行中"）。这里兜底降级为默认文案。
        let reason: string
        try {
          reason = tool!.approvalReason
            ? tool!.approvalReason(parsedInput)
            : `Tool ${call.function.name} requires approval`
        } catch {
          reason = `Tool ${call.function.name} requires approval`
        }
        const approved = requestApproval ? await requestApproval(call, reason) : false
        if (!approved) {
          const reject = 'User rejected this tool call.'
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: reject,
            name: call.function.name
          })
          yield { type: 'tool-result', callId: call.id, ok: false, content: reject }
          continue
        }
      }

      const result = await registry.call(call, toolCtx)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.content,
        name: call.function.name
      })
      yield { type: 'tool-result', callId: call.id, ok: result.ok, content: result.content }
      if (result.artifact) {
        yield { type: 'artifact', callId: call.id, artifact: result.artifact }
      }
    }
    // 进入下一轮：把更新后的 messages 再喂给 LLM
  }

  // 迭代用尽仍停在工具结果上：做最后一次「只答题、不给工具」的收尾调用，
  // 保证用户总能看到最终结论 —— 否则会出现「技能调了、活干了，但没有结果输出」。
  if (signal?.aborted) {
    yield { type: 'turn-end', reason: 'aborted' }
    return
  }
  const wrap = newAgg()
  const wrapMessages: ChatMessage[] = [
    ...toCallMessages(),
    { role: 'user', content: WRAP_UP_DIRECTIVE }
  ]
  try {
    yield* streamPass(wrapMessages, [], wrap)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'turn-end', reason: 'error', error: message }
    return
  }
  if (signal?.aborted) {
    yield { type: 'turn-end', reason: 'aborted' }
    return
  }
  // 收尾有正文才落 assistant 消息（避免空消息）；仍无内容则如实以 max-iterations 结束
  if (wrap.text || wrap.reasoning) {
    messages.push({
      role: 'assistant',
      content: wrap.text,
      ...(wrap.reasoning ? { reasoning: wrap.reasoning } : {})
    })
    yield { type: 'turn-end', reason: wrap.text ? 'stop' : 'max-iterations' }
    return
  }
  yield { type: 'turn-end', reason: 'max-iterations' }
}

function safeParseJson(s: string): unknown {
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

/** 剥离 reasoning / createdAt 字段（不喂回 LLM）；两字段都缺的消息原样返回 */
function stripForLlm(m: ChatMessage): ChatMessage {
  if (m.reasoning === undefined && m.createdAt === undefined) return m
  const copy = { ...m }
  delete copy.reasoning
  delete copy.createdAt
  return copy
}
