import { describe, it, expect } from 'vitest'
import {
  createSseParser,
  extractDeltaContent,
  extractToolCallDeltas,
  extractFinishReason,
  extractReasoningDelta
} from './sse'

describe('createSseParser', () => {
  it('解析单条完整 data 事件', () => {
    const parser = createSseParser()
    const events = parser.push('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')
    expect(events).toEqual([
      { kind: 'data', payload: '{"choices":[{"delta":{"content":"你好"}}]}' }
    ])
  })

  it('跨 chunk 断行时不丢事件：一行被拆成两次 push', () => {
    const parser = createSseParser()
    const part1 = parser.push('data: {"choi')
    // 尚未收到空行分隔，不应该产出任何完整事件
    expect(part1).toEqual([])
    const part2 = parser.push('ces":[{"delta":{"content":"世"}}]}\n\n')
    expect(part2).toEqual([{ kind: 'data', payload: '{"choices":[{"delta":{"content":"世"}}]}' }])
  })

  it('一个 chunk 内包含多条事件时按顺序全部产出', () => {
    const parser = createSseParser()
    const events = parser.push(
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n'
    )
    expect(events).toEqual([
      { kind: 'data', payload: '{"choices":[{"delta":{"content":"A"}}]}' },
      { kind: 'data', payload: '{"choices":[{"delta":{"content":"B"}}]}' }
    ])
  })

  it('收到 [DONE] 时产出 done 事件', () => {
    const parser = createSseParser()
    const events = parser.push('data: [DONE]\n\n')
    expect(events).toEqual([{ kind: 'done' }])
  })

  it('忽略 SSE 注释行（以冒号开头的 keep-alive）', () => {
    const parser = createSseParser()
    const events = parser.push(': keep-alive\n\ndata: {"choices":[{"delta":{"content":"X"}}]}\n\n')
    expect(events).toEqual([{ kind: 'data', payload: '{"choices":[{"delta":{"content":"X"}}]}' }])
  })

  it('flush 时残留的不完整行被丢弃，不产出假事件', () => {
    const parser = createSseParser()
    parser.push('data: {"incomplete": true')
    expect(parser.flush()).toEqual([])
  })
})

describe('extractDeltaContent', () => {
  it('正常提取 delta.content', () => {
    expect(extractDeltaContent('{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好')
  })

  it('delta 无 content 字段（如仅 role 变更的首包）返回空串', () => {
    expect(extractDeltaContent('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe('')
  })

  it('choices 为空数组返回空串，不抛异常', () => {
    expect(extractDeltaContent('{"choices":[]}')).toBe('')
  })

  it('非法 JSON 返回空串，不抛异常（防御式：单条脏数据不应中断整个流）', () => {
    expect(extractDeltaContent('not json at all')).toBe('')
  })
})

describe('extractToolCallDeltas', () => {
  it('首个包带 id+name，无 arguments 也提取', () => {
    const d = extractToolCallDeltas(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '' }
                }
              ]
            }
          }
        ]
      })
    )
    expect(d).toEqual([{ index: 0, id: 'call_1', name: 'read_file', argsChunk: '' }])
  })

  it('后续包仅带 arguments 片段', () => {
    const d = extractToolCallDeltas(
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }]
      })
    )
    expect(d).toEqual([{ index: 0, argsChunk: '{"path":' }])
  })

  it('多个 index 并行时分别返回', () => {
    const d = extractToolCallDeltas(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'a' } },
                { index: 1, function: { arguments: 'b' } }
              ]
            }
          }
        ]
      })
    )
    expect(d).toHaveLength(2)
    expect(d[0].index).toBe(0)
    expect(d[1].index).toBe(1)
  })

  it('无 tool_calls 字段时返回空数组', () => {
    expect(
      extractToolCallDeltas(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }))
    ).toEqual([])
  })

  it('非法 JSON 不抛异常', () => {
    expect(extractToolCallDeltas('not json')).toEqual([])
  })
})

describe('extractFinishReason', () => {
  it('提取 choices[0].finish_reason', () => {
    expect(
      extractFinishReason(JSON.stringify({ choices: [{ finish_reason: 'tool_calls' }] }))
    ).toBe('tool_calls')
  })

  it('未带 finish_reason 时返回 undefined', () => {
    expect(extractFinishReason(JSON.stringify({ choices: [{ delta: {} }] }))).toBeUndefined()
  })

  it('非法 JSON 不抛异常', () => {
    expect(extractFinishReason('garbage')).toBeUndefined()
  })
})

describe('extractReasoningDelta', () => {
  it('提取 delta.reasoning_content（DeepSeek/mimo 系思考字段）', () => {
    expect(
      extractReasoningDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: '思1' } }] }))
    ).toBe('思1')
  })

  it('reasoning_content 缺失时兼容回退 delta.reasoning', () => {
    expect(
      extractReasoningDelta(JSON.stringify({ choices: [{ delta: { reasoning: 'r' } }] }))
    ).toBe('r')
  })

  it('无思考字段 / 非法 JSON 返回空串', () => {
    expect(extractReasoningDelta(JSON.stringify({ choices: [{ delta: { content: 'x' } }] }))).toBe(
      ''
    )
    expect(extractReasoningDelta('garbage')).toBe('')
  })
})
