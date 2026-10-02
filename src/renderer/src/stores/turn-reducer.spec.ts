import { describe, expect, it } from 'vitest'
import type { AgentStreamEvent, ChatMessage } from '@shared/types'
import { appendBlockText, emptyTurn, reduceTurn, type TurnState } from './turn-reducer'

function ev(partial: Record<string, unknown>): AgentStreamEvent {
  return { sessionId: 's1', turnId: 't1', ...partial } as unknown as AgentStreamEvent
}

const base: ChatMessage[] = [{ role: 'user', content: 'hi' }]

function running(): TurnState {
  return { ...emptyTurn(base), activeTurnId: 't1', turnStartedAt: 1000 }
}

describe('appendBlockText', () => {
  it('同类末块拼接，异类开新块', () => {
    let b = appendBlockText([], 'text', 'a')
    b = appendBlockText(b, 'text', 'b')
    expect(b).toEqual([{ kind: 'text', text: 'ab' }])
    b = appendBlockText(b, 'reasoning', 'r')
    expect(b).toEqual([
      { kind: 'text', text: 'ab' },
      { kind: 'reasoning', text: 'r' }
    ])
  })
})

describe('reduceTurn 流式增量', () => {
  it('text-delta 累加进 liveBlocks 尾部文本', () => {
    const t = reduceTurn(running(), ev({ type: 'text-delta', text: 'Hel' }))
    const t2 = reduceTurn(t, ev({ type: 'text-delta', text: 'lo' }))
    expect(t2.liveBlocks).toEqual([{ kind: 'text', text: 'Hello' }])
  })
  it('reasoning 与 text 交替形成时间线', () => {
    let t = reduceTurn(running(), ev({ type: 'reasoning-delta', text: 'think' }))
    t = reduceTurn(t, ev({ type: 'text-delta', text: 'answer' }))
    expect(t.liveBlocks).toEqual([
      { kind: 'reasoning', text: 'think' },
      { kind: 'text', text: 'answer' }
    ])
  })
})

describe('reduceTurn 工具与批准', () => {
  const call = { id: 'c1', type: 'function' as const, function: { name: 'x', arguments: '{}' } }
  it('tool-call 建 pendingToolCalls 并开工具块', () => {
    const t = reduceTurn(running(), ev({ type: 'tool-call', call }))
    expect(t.pendingToolCalls.c1).toEqual({ call })
    expect(t.liveBlocks).toEqual([{ kind: 'tool', callId: 'c1' }])
  })
  it('tool-result 回填结果到对应 call', () => {
    let t = reduceTurn(running(), ev({ type: 'tool-call', call }))
    t = reduceTurn(t, ev({ type: 'tool-result', callId: 'c1', ok: true, content: 'done' }))
    expect(t.pendingToolCalls.c1.result).toEqual({ ok: true, content: 'done' })
  })
  it('tool-result 找不到对应 call 时原样返回', () => {
    const t = reduceTurn(
      running(),
      ev({ type: 'tool-result', callId: 'nope', ok: true, content: '' })
    )
    expect(t).toEqual(running())
  })
  it('approval-required 追加挂起项', () => {
    const t = reduceTurn(
      running(),
      ev({ type: 'approval-required', requestId: 'r1', call, reason: 'why' })
    )
    expect(t.pendingApprovals).toEqual([{ requestId: 'r1', call, reason: 'why' }])
  })
  it('artifact 不改 turn', () => {
    const start = running()
    const t = reduceTurn(
      start,
      ev({ type: 'artifact', callId: 'c1', artifact: { kind: 'file', name: 'f' } })
    )
    expect(t).toBe(start)
  })
})

describe('reduceTurn turn-end 收尾', () => {
  it('stop：清进行态、保留 baseMessages、无错误', () => {
    let t = reduceTurn(running(), ev({ type: 'text-delta', text: 'x' }))
    t = reduceTurn(t, ev({ type: 'turn-end', reason: 'stop' }))
    expect(t.activeTurnId).toBeNull()
    expect(t.turnStartedAt).toBeNull()
    expect(t.liveBlocks).toEqual([])
    expect(t.pendingToolCalls).toEqual({})
    expect(t.pendingApprovals).toEqual([])
    expect(t.lastError).toBeNull()
    expect(t.baseMessages).toEqual(base)
  })
  it('error：记录错误信息', () => {
    const t = reduceTurn(running(), ev({ type: 'turn-end', reason: 'error', error: 'boom' }))
    expect(t.lastError).toBe('boom')
    expect(t.activeTurnId).toBeNull()
  })
})

describe('reduceTurn 并发隔离', () => {
  it('不同 sessionId 的事件各自成 turn（reducer 无跨会话状态）', () => {
    const a = reduceTurn(running(), {
      type: 'text-delta',
      sessionId: 'A',
      turnId: 't',
      text: 'forA'
    })
    expect(a.liveBlocks).toEqual([{ kind: 'text', text: 'forA' }])
    // B 的 turn 不受 A 事件影响
    const b = running()
    expect(b.liveBlocks).toEqual([])
  })
})
