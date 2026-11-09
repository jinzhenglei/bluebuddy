import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnPrompt } from '@shared/types'
import { buildTrajectory, downloadTrajectory, type TurnView } from './turn-trajectory'

function turn(partial: Partial<TurnView> = {}): TurnView {
  return {
    key: 0,
    userText: '帮我统计字数',
    userMsgId: 'u1',
    process: [],
    answer: '完成',
    answerId: 'a1',
    feedback: null,
    live: false,
    durationSec: 3,
    ...partial
  }
}

describe('buildTrajectory', () => {
  it('带提示词快照时写入 promptSnapshot（旧快照无 model 时为 null）', () => {
    const withModel = buildTrajectory(turn(), 's1', 2, { prompt: 'SYS v1', model: 'gpt-x' })
    expect(withModel.promptSnapshot).toEqual({ system: 'SYS v1', model: 'gpt-x' })
    const noModel = buildTrajectory(turn(), 's1', 2, { prompt: 'SYS v1' } satisfies TurnPrompt)
    expect(noModel.promptSnapshot).toEqual({ system: 'SYS v1', model: null })
  })

  it('无快照（旧数据）时 promptSnapshot 如实为 null', () => {
    const data = buildTrajectory(turn(), 's1', 0, null)
    expect(data.promptSnapshot).toBeNull()
    expect(data.version).toBe(2)
  })

  it('process 展平为 steps：工具结果保留 ok 成败标记，未返回结果为 null', () => {
    const data = buildTrajectory(
      turn({
        process: [
          { kind: 'reasoning', text: '想' },
          {
            kind: 'tools',
            calls: [
              {
                call: {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'echo', arguments: '{"msg":"hi"}' }
                },
                result: { ok: true, content: 'echo:hi' }
              },
              {
                call: {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'run_command', arguments: '{"cmd":"x"}' }
                },
                result: { ok: false, content: 'exit 1' }
              },
              {
                call: { id: 'c3', type: 'function', function: { name: 'ghost', arguments: '{}' } }
              }
            ]
          },
          { kind: 'text', text: '中间叙述' }
        ]
      }),
      's1',
      0,
      null
    )
    expect(data.steps).toEqual([
      { kind: 'reasoning', text: '想' },
      {
        kind: 'tool',
        name: 'echo',
        arguments: '{"msg":"hi"}',
        result: { ok: true, content: 'echo:hi' }
      },
      {
        kind: 'tool',
        name: 'run_command',
        arguments: '{"cmd":"x"}',
        result: { ok: false, content: 'exit 1' }
      },
      { kind: 'tool', name: 'ghost', arguments: '{}', result: null },
      { kind: 'text', text: '中间叙述' }
    ])
  })

  it('基本字段映射：轮次序号、耗时、反馈与 answerId', () => {
    const data = buildTrajectory(
      turn({ feedback: 'down', durationSec: null, answerId: 'a9' }),
      'sess',
      5,
      null
    )
    expect(data).toMatchObject({
      format: 'bluebuddy-trajectory',
      sessionId: 'sess',
      turnIndex: 5,
      durationSec: null,
      userText: '帮我统计字数',
      answer: '完成',
      answerId: 'a9',
      feedback: 'down'
    })
  })
})

describe('downloadTrajectory', () => {
  const getTurnPrompt = vi.fn()
  let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn> }
  let captured: string | null

  beforeEach(() => {
    getTurnPrompt.mockReset()
    captured = null
    anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('window', { api: { messages: { getTurnPrompt } } })
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          captured = parts.join('')
        }
      }
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn()
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按 userMsgId 取提示词快照一并写入导出 JSON', async () => {
    getTurnPrompt.mockResolvedValue({ prompt: 'SYS v1', model: 'gpt-x' })
    await downloadTrajectory(turn(), 's1', 0)
    expect(getTurnPrompt).toHaveBeenCalledWith('u1')
    const data = JSON.parse(captured!)
    expect(data.promptSnapshot).toEqual({ system: 'SYS v1', model: 'gpt-x' })
    expect(anchor.click).toHaveBeenCalled()
  })

  it('无 userMsgId（live/乐观消息）不查快照，promptSnapshot 为 null', async () => {
    await downloadTrajectory(turn({ userMsgId: null }), 's1', 0)
    expect(getTurnPrompt).not.toHaveBeenCalled()
    const data = JSON.parse(captured!)
    expect(data.promptSnapshot).toBeNull()
  })

  it('旧数据查不到快照时 promptSnapshot 为 null', async () => {
    getTurnPrompt.mockResolvedValue(null)
    await downloadTrajectory(turn(), 's1', 0)
    const data = JSON.parse(captured!)
    expect(data.promptSnapshot).toBeNull()
  })
})
