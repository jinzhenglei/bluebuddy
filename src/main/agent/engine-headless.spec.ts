import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ChatMessage } from '@shared/types'
import { runAgentTurn, type AgentEvent, type LlmCallFn } from './engine'
import { createDefaultRegistry } from '../tools'
import { LocalWorkspace } from '../workspace/local'
import type { ToolContext } from '../tools/types'

/**
 * 架构命门验证（Stage 6 / S6c）：Agent 引擎是纯逻辑库，不依赖 Electron。
 *
 * 本用例在**普通 Node 进程（vitest 环境，无 Electron）**里，仅 import 引擎 + 内置工具 +
 * LocalWorkspace，用一段脚本化的假 LLM 编排「一次真实的工具调用任务」：
 *   模型请求 write_file → 引擎经 registry 让 LocalWorkspace 真的在临时目录写文件
 *   → 回填 tool 结果 + 产出 artifact 事件 → 模型再答一句收尾 → turn-end=stop。
 * 全程没有任何 Electron API，跑通即证明"引擎可被 Node 直接 import 跑一次任务"。
 */

let tmpRoot: string
beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-headless-'))
})
afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

/** 脚本化假 LLM：第一次要求写文件，拿到工具结果后第二次直接给结论文本 */
function scriptedLlm(counter: { calls: number }): LlmCallFn {
  return async function* () {
    counter.calls += 1
    if (counter.calls === 1) {
      yield {
        type: 'tool-call-delta',
        delta: {
          index: 0,
          id: 'call_write',
          name: 'write_file',
          argsChunk: JSON.stringify({ path: 'hello.txt', content: 'hi from headless node' })
        }
      }
      yield { type: 'finish', reason: 'tool_calls' }
      yield { type: 'done' }
    } else {
      yield { type: 'delta', text: '已经把 hello.txt 写好了。' }
      yield { type: 'finish', reason: 'stop' }
      yield { type: 'done' }
    }
  }
}

describe('Agent 引擎纯 Node（无 Electron）跑通一次任务', () => {
  it('在普通 Node 进程里 import 引擎并完成 工具调用→写盘→artifact→收尾', async () => {
    // 关键前提断言：当前进程确实没有 Electron —— 引擎不靠它也能跑
    expect(process.versions.electron).toBeUndefined()

    const counter = { calls: 0 }
    const toolCtx: ToolContext = {
      workspace: new LocalWorkspace(tmpRoot),
      fetch: (() => {
        throw new Error('本用例不应触发网络')
      }) as unknown as typeof fetch
    }
    const messages: ChatMessage[] = [{ role: 'user', content: '把 hello.txt 写成一句话' }]
    const events: AgentEvent[] = []

    for await (const ev of runAgentTurn({
      llmCall: scriptedLlm(counter),
      registry: createDefaultRegistry(),
      toolCtx,
      messages,
      systemPrompt: '你是测试环境下的助手。'
    })) {
      events.push(ev)
    }

    // 假 LLM 被调了两次：一次发起工具，一次给结论
    expect(counter.calls).toBe(2)

    // 引擎产出了工具成功结果与 artifact 事件
    const toolResult = events.find((e) => e.type === 'tool-result')
    expect(toolResult).toMatchObject({ type: 'tool-result', ok: true })
    const artifact = events.find((e) => e.type === 'artifact')
    expect(artifact).toMatchObject({ type: 'artifact', artifact: { relPath: 'hello.txt' } })

    // 以正常结束（非 error / max-iterations）
    const end = events.at(-1)
    expect(end).toMatchObject({ type: 'turn-end', reason: 'stop' })

    // 工具真的通过 LocalWorkspace 落到了磁盘（证明执行链路端到端可用）
    const written = await fs.readFile(path.join(tmpRoot, 'hello.txt'), 'utf-8')
    expect(written).toBe('hi from headless node')

    // 会话消息被正确追加：assistant(带 tool_calls) → tool(结果) → assistant(收尾文本)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(messages[1].tool_calls?.[0]?.function.name).toBe('write_file')
    expect(messages[3].content).toContain('hello.txt')
  })
})
