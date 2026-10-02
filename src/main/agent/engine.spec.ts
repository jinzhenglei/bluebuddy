import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { ChatMessage, ToolCall } from '@shared/types'
import { GatewayEvent } from '../llm/gateway'
import { LocalWorkspace } from '../workspace/local'
import { ToolRegistry } from '../tools/registry'
import { Tool, ToolContext, ToolResult } from '../tools/types'
import { AgentEvent, runAgentTurn, LlmCallFn } from './engine'

let tmpRoot: string
let toolCtx: ToolContext

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-engine-'))
})
afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})
beforeEach(() => {
  toolCtx = {
    workspace: new LocalWorkspace(tmpRoot),
    fetch: vi.fn() as unknown as typeof fetch
  }
})

/** 脚本化 LLM：每次调用按顺序取下一段事件；调用次数超脚本长度时抛错 */
function scriptedLlm(turns: GatewayEvent[][]): LlmCallFn {
  let call = 0
  return async function* () {
    if (call >= turns.length) throw new Error(`scriptedLlm: out of turns at call #${call}`)
    const events = turns[call++]
    for (const e of events) yield e
  }
}

/** 记录每次 llmCall 收到的 messages snapshot，用于断言回填 */
function recordingLlm(turns: GatewayEvent[][], log: ChatMessage[][]): LlmCallFn {
  let call = 0
  return async function* (params) {
    log.push(structuredClone(params.messages))
    const events = turns[call] ?? []
    call++
    for (const e of events) yield e
  }
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

/** 简易 echo 工具：不依赖 workspace */
function echoTool(): Tool<{ msg: string }> {
  return {
    name: 'echo',
    description: 'echo back',
    parameters: z.object({ msg: z.string() }),
    requiresApproval: false,
    async execute(input): Promise<ToolResult> {
      return { ok: true, content: `echo:${input.msg}` }
    }
  }
}

/** 简易高危工具：需要批准 */
function dangerTool(): Tool<{ x: number }> {
  return {
    name: 'danger',
    description: 'dangerous',
    parameters: z.object({ x: z.number() }),
    requiresApproval: true,
    approvalReason: (i) => `about to do dangerous thing with ${(i as { x: number }).x}`,
    async execute(input): Promise<ToolResult> {
      return { ok: true, content: `did:${input.x}` }
    }
  }
}

function tc(id: string, name: string, args: string, index?: number): GatewayEvent {
  return { type: 'tool-call-delta', delta: { index: index ?? 0, id, name, argsChunk: args } }
}

describe('runAgentTurn 单轮文本终止', () => {
  it('没有 tool_calls 时只产出 text-delta + turn-end=stop', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const llm = scriptedLlm([
      [{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'turn-end', reason: 'stop' }
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello' }
    ])
  })
})

describe('runAgentTurn 工具循环', () => {
  it('一次 tool_call → 执行 → 第二轮返回文本 → 结束', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'echo hi' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm(
      [
        // 第 1 轮：模型请求调用 echo
        [
          tc('c1', 'echo', '{"msg":'),
          tc('c1', undefined as unknown as string, '"hi"}'),
          { type: 'finish', reason: 'tool_calls' },
          { type: 'done' }
        ],
        // 第 2 轮：拿到工具结果后回文本
        [{ type: 'delta', text: 'Done: echo:hi' }, { type: 'done' }]
      ],
      log
    )
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(events).toEqual([
      {
        type: 'tool-call',
        call: { id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"msg":"hi"}' } }
      },
      { type: 'tool-result', callId: 'c1', ok: true, content: 'echo:hi' },
      { type: 'text-delta', text: 'Done: echo:hi' },
      { type: 'turn-end', reason: 'stop' }
    ])
    // 第二次调用 LLM 时 messages 应包含 tool 结果
    expect(log[1]).toEqual([
      { role: 'user', content: 'echo hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"msg":"hi"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'echo:hi', name: 'echo' }
    ])
  })

  it('并行多个 tool_calls：按 index 顺序执行', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'do 2' }]
    const llm = scriptedLlm([
      [tc('a', 'echo', '{"msg":"x"}', 0), tc('b', 'echo', '{"msg":"y"}', 1), { type: 'done' }],
      [{ type: 'delta', text: 'ok' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const calls = events.filter((e) => e.type === 'tool-call') as Array<
      Extract<AgentEvent, { type: 'tool-call' }>
    >
    expect(calls.map((c) => c.call.id)).toEqual(['a', 'b'])
    const results = events.filter((e) => e.type === 'tool-result') as Array<
      Extract<AgentEvent, { type: 'tool-result' }>
    >
    expect(results.map((r) => r.content)).toEqual(['echo:x', 'echo:y'])
  })

  it('工具执行错误 → 错误内容原样回填 messages 并继续', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'bad' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm(
      [
        // 参数错误：msg 缺失
        [tc('c1', 'echo', '{}'), { type: 'done' }],
        [{ type: 'delta', text: 'sorry' }, { type: 'done' }]
      ],
      log
    )
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const result = events.find((e) => e.type === 'tool-result') as Extract<
      AgentEvent,
      { type: 'tool-result' }
    >
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Argument validation failed/)
    // 下一轮 tool 消息带错误内容
    const toolMsg = log[1].find((m) => m.role === 'tool')!
    expect(toolMsg.content).toMatch(/Argument validation failed/)
  })
})

describe('runAgentTurn 权限批准', () => {
  it('requiresApproval=true 时调用 requestApproval 回调，传入 call+reason，批准后执行', async () => {
    const registry = new ToolRegistry()
    registry.register(dangerTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }]
    const llm = scriptedLlm([
      [tc('c1', 'danger', '{"x":42}'), { type: 'done' }],
      [{ type: 'delta', text: 'done' }, { type: 'done' }]
    ])
    const approvalCalls: Array<[ToolCall, string]> = []
    const approval = vi.fn(async (call: ToolCall, reason: string) => {
      approvalCalls.push([call, reason])
      return true
    })
    const events = await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, requestApproval: approval })
    )
    expect(approval).toHaveBeenCalledTimes(1)
    const [calledCall, calledReason] = approvalCalls[0]
    expect(calledCall.function.name).toBe('danger')
    expect(calledReason).toBe('about to do dangerous thing with 42')
    expect(events.some((e) => e.type === 'tool-result' && e.content === 'did:42')).toBe(true)
  })

  it('用户拒绝时把 "User rejected" 回填给模型，工具不执行', async () => {
    const registry = new ToolRegistry()
    const executeSpy = vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'ran' }))
    registry.register({
      ...dangerTool(),
      execute: executeSpy
    })
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm(
      [
        [tc('c1', 'danger', '{"x":1}'), { type: 'done' }],
        [{ type: 'delta', text: 'ok I will not' }, { type: 'done' }]
      ],
      log
    )
    const events = await collect(
      runAgentTurn({
        llmCall: llm,
        registry,
        toolCtx,
        messages,
        requestApproval: async () => false
      })
    )
    expect(executeSpy).not.toHaveBeenCalled()
    const rejected = events.find(
      (e) => e.type === 'tool-result' && !(e as Extract<AgentEvent, { type: 'tool-result' }>).ok
    ) as Extract<AgentEvent, { type: 'tool-result' }>
    expect(rejected.content).toMatch(/User rejected/)
    const toolMsg = log[1].find((m) => m.role === 'tool')!
    expect(toolMsg.content).toMatch(/User rejected/)
  })

  it('未提供 requestApproval 时默认视为拒绝（安全兜底）', async () => {
    const registry = new ToolRegistry()
    registry.register(dangerTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }]
    const llm = scriptedLlm([
      [tc('c1', 'danger', '{"x":1}'), { type: 'done' }],
      [{ type: 'delta', text: 'no' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const tr = events.find((e) => e.type === 'tool-result') as Extract<
      AgentEvent,
      { type: 'tool-result' }
    >
    expect(tr.ok).toBe(false)
    expect(tr.content).toMatch(/User rejected/)
  })

  it('approvalReason 抛异常时降级为默认文案，不打断 turn', async () => {
    const badTool: Tool<{ x: number }> = {
      name: 'danger',
      description: 'dangerous',
      parameters: z.object({ x: z.number() }),
      requiresApproval: true,
      approvalReason: () => {
        throw new Error('a.join is not a function')
      },
      async execute(input): Promise<ToolResult> {
        return { ok: true, content: `did:${input.x}` }
      }
    }
    const registry = new ToolRegistry()
    registry.register(badTool)
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }]
    const llm = scriptedLlm([
      [tc('c1', 'danger', '{"x":1}'), { type: 'done' }],
      [{ type: 'delta', text: 'ok' }, { type: 'done' }]
    ])
    const approval = vi.fn(async (_call: ToolCall, reason: string) => {
      // 降级后的默认文案，不含崩溃信息
      expect(reason).toContain('requires approval')
      return true
    })
    const events = await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, requestApproval: approval })
    )
    // 不应出现 turn-end=error，工具正常执行并最终以 stop 结束
    expect(events.some((e) => e.type === 'turn-end' && e.reason === 'error')).toBe(false)
    const tr = events.find((e) => e.type === 'tool-result') as Extract<
      AgentEvent,
      { type: 'tool-result' }
    >
    expect(tr.ok).toBe(true)
    expect(tr.content).toBe('did:1')
  })
})

describe('runAgentTurn 中止与上限', () => {
  it('signal 已 abort 时立即结束不发第一次 LLM 调用', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    const spy = vi.fn()
    const llm: LlmCallFn = async function* (p) {
      spy(p)
      yield { type: 'done' }
    }
    const c = new AbortController()
    c.abort()
    const events = await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, signal: c.signal })
    )
    expect(events).toEqual([{ type: 'turn-end', reason: 'aborted' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('LLM 抛异常时以 turn-end=error 结束', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    const llm: LlmCallFn = async function* () {
      // 先 yield 一个不会向外透传的事件（让 TS 认为这确实是个 generator），然后抛错
      yield { type: 'finish', reason: 'noop' }
      throw new Error('network fail')
    }
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(events).toEqual([{ type: 'turn-end', reason: 'error', error: 'network fail' }])
  })

  it('反复调用工具直到 maxIterations 时以 max-iterations 结束', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'loop' }]
    // 每轮都返回一个 tool_call，永不给 stop 信号
    const llm: LlmCallFn = async function* () {
      yield tc('c', 'echo', '{"msg":"again"}')
      yield { type: 'done' }
    }
    const events = await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, maxIterations: 3 })
    )
    const last = events[events.length - 1]
    expect(last).toEqual({ type: 'turn-end', reason: 'max-iterations' })
    // 3 轮，每轮一次 tool-call + tool-result
    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(3)
  })

  it('迭代用尽后收尾调用产出最终答案并以 stop 结束', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'loop' }]
    // 前两轮各返回一个 tool_call 耗尽迭代；收尾轮（tools=[]）返回正文
    const llm = scriptedLlm([
      [tc('c1', 'echo', '{"msg":"1"}'), { type: 'done' }],
      [tc('c2', 'echo', '{"msg":"2"}'), { type: 'done' }],
      [{ type: 'delta', text: '最终结论' }, { type: 'done' }]
    ])
    const events = await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, maxIterations: 2 })
    )
    expect(events[events.length - 1]).toEqual({ type: 'turn-end', reason: 'stop' })
    // 收尾答案落进 messages 末尾
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: '最终结论' })
    // 只执行了 2 轮工具调用，收尾轮不再调用工具
    expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(2)
  })
})

describe('runAgentTurn 产物事件', () => {
  it('工具返回 artifact 时引擎向外 yield artifact 事件', async () => {
    const registry = new ToolRegistry()
    const writeTool: Tool<{ p: string }> = {
      name: 'w',
      description: '',
      parameters: z.object({ p: z.string() }),
      requiresApproval: false,
      async execute(input, ctx): Promise<ToolResult> {
        await ctx.workspace.writeFile(input.p, 'x')
        return {
          ok: true,
          content: 'wrote',
          artifact: { kind: 'file', name: input.p, relPath: input.p }
        }
      }
    }
    registry.register(writeTool)
    const messages: ChatMessage[] = [{ role: 'user', content: 'go' }]
    const llm = scriptedLlm([
      [tc('c1', 'w', '{"p":"a.txt"}'), { type: 'done' }],
      [{ type: 'delta', text: 'finished' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const art = events.find((e) => e.type === 'artifact') as Extract<
      AgentEvent,
      { type: 'artifact' }
    >
    expect(art.artifact).toMatchObject({ kind: 'file', relPath: 'a.txt' })
    expect(art.callId).toBe('c1')
  })
})

describe('runAgentTurn arguments 组装', () => {
  it('arguments 分多段拼接完整 JSON', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    const llm = scriptedLlm([
      [
        { type: 'tool-call-delta', delta: { index: 0, id: 'c1', name: 'echo' } },
        { type: 'tool-call-delta', delta: { index: 0, argsChunk: '{"msg"' } },
        { type: 'tool-call-delta', delta: { index: 0, argsChunk: ':' } },
        { type: 'tool-call-delta', delta: { index: 0, argsChunk: '"hello"}' } },
        { type: 'done' }
      ],
      [{ type: 'delta', text: 'ok' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const toolCall = events.find((e) => e.type === 'tool-call') as Extract<
      AgentEvent,
      { type: 'tool-call' }
    >
    expect(toolCall.call.function.arguments).toBe('{"msg":"hello"}')
    expect(toolCall.call.id).toBe('c1')
    const result = events.find((e) => e.type === 'tool-result') as Extract<
      AgentEvent,
      { type: 'tool-result' }
    >
    expect(result.content).toBe('echo:hello')
  })

  it('未知工具（未注册）→ tool-result ok=false 内容含 Unknown tool', async () => {
    const registry = new ToolRegistry()
    // 不注册任何工具
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    const llm = scriptedLlm([
      [tc('c1', 'ghost', '{}'), { type: 'done' }],
      [{ type: 'delta', text: 'sorry' }, { type: 'done' }]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    const result = events.find((e) => e.type === 'tool-result') as Extract<
      AgentEvent,
      { type: 'tool-result' }
    >
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Unknown tool/)
  })
})

describe('runAgentTurn system prompt 注入', () => {
  it('提供 systemPrompt 时喂给 LLM 的首条是 system，且不落进持久化 messages', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm([[{ type: 'delta', text: 'ok' }, { type: 'done' }]], log)
    await collect(
      runAgentTurn({ llmCall: llm, registry, toolCtx, messages, systemPrompt: '你是 BlueBuddy' })
    )
    expect(log[0][0]).toEqual({ role: 'system', content: '你是 BlueBuddy' })
    expect(log[0][1]).toEqual({ role: 'user', content: 'hi' })
    // 持久化数组不含 system（技能索引每轮现拼，不入库）
    expect(messages.some((m) => m.role === 'system')).toBe(false)
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' }
    ])
  })

  it('未提供 systemPrompt 时不注入 system 消息', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm([[{ type: 'delta', text: 'ok' }, { type: 'done' }]], log)
    await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(log[0][0].role).toBe('user')
  })

  it('messages 已含 system 时不重复前置', async () => {
    const registry = new ToolRegistry()
    registry.register(echoTool())
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const log: ChatMessage[][] = []
    const llm = recordingLlm(
      [
        [{ type: 'delta', text: 'a' }, { type: 'done' }],
        [{ type: 'delta', text: 'b' }, { type: 'done' }]
      ],
      log
    )
    await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages, systemPrompt: 'SYS' }))
    // 每轮喂给 LLM 的都只有一条 system 在头部
    for (const snapshot of log) {
      expect(snapshot.filter((m) => m.role === 'system')).toHaveLength(1)
    }
  })
})

describe('reasoning-delta 转发', () => {
  it('网关 reasoning chunk 按序透传为 reasoning-delta，且不入库 messages', async () => {
    const registry = new ToolRegistry()
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const llm = scriptedLlm([
      [
        { type: 'reasoning', text: '思1' },
        { type: 'reasoning', text: '思2' },
        { type: 'delta', text: 'ok' },
        { type: 'done' }
      ]
    ])
    const events = await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(events).toEqual([
      { type: 'reasoning-delta', text: '思1' },
      { type: 'reasoning-delta', text: '思2' },
      { type: 'text-delta', text: 'ok' },
      { type: 'turn-end', reason: 'stop' }
    ])
    // 思考内容累进 assistant 消息的 reasoning 字段落库（可回看），但不混进 content
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok', reasoning: '思1思2' }
    ])
  })

  it('喂回 LLM 时剥离 reasoning 字段（不污染上下文）', async () => {
    const registry = new ToolRegistry()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'prev', reasoning: '旧思考' }
    ]
    const log: ChatMessage[][] = []
    const llm = recordingLlm([[{ type: 'delta', text: 'ok' }, { type: 'done' }]], log)
    await collect(runAgentTurn({ llmCall: llm, registry, toolCtx, messages }))
    expect(log[0]).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'prev' }
    ])
  })
})

// 类型导出避免未使用告警
export type _ToolCallExport = ToolCall
