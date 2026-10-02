import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { ToolCall } from '@shared/types'
import { ToolRegistry } from './registry'
import { Tool, ToolContext, ToolResult } from './types'
import { LocalWorkspace } from '../workspace/local'

/** 造一个假 ctx，只用 workspace + fetch 两个字段，其余测试自己覆写 */
function fakeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspace: new LocalWorkspace(process.cwd()),
    fetch: vi.fn() as unknown as typeof fetch,
    ...overrides
  }
}

function makeCall(name: string, args: unknown, id = 'c1'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
  }
}

describe('ToolRegistry 基础', () => {
  it('register + get + list 正常工作', () => {
    const r = new ToolRegistry()
    const t: Tool<{ x: number }> = {
      name: 'noop',
      description: 'do nothing',
      parameters: z.object({ x: z.number() }),
      requiresApproval: false,
      async execute(input): Promise<ToolResult> {
        return { ok: true, content: `got ${input.x}` }
      }
    }
    r.register(t)
    expect(r.get('noop')).toBe(t as unknown)
    expect(r.list().map((x) => x.name)).toEqual(['noop'])
  })

  it('重名注册抛错', () => {
    const r = new ToolRegistry()
    const mk = (): Tool<{ a: string }> => ({
      name: 'dup',
      description: '',
      parameters: z.object({ a: z.string() }),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: '' }
      }
    })
    r.register(mk())
    expect(() => r.register(mk())).toThrow(/Duplicate tool name/)
  })

  it('unregister 删除已注册工具；不存在返回 false', () => {
    const r = new ToolRegistry()
    expect(r.unregister('ghost')).toBe(false)
    r.register({
      name: 'tmp',
      description: '',
      parameters: z.object({}),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: '' }
      }
    })
    expect(r.unregister('tmp')).toBe(true)
    expect(r.get('tmp')).toBeUndefined()
  })
})

describe('ToolRegistry.call 错误路径', () => {
  it('未注册的工具返回 ok=Unknown tool', async () => {
    const r = new ToolRegistry()
    const res = await r.call(makeCall('ghost', {}), fakeCtx())
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Unknown tool/)
  })

  it('非法 JSON arguments 返回 ok=false', async () => {
    const r = new ToolRegistry()
    r.register({
      name: 'p',
      description: '',
      parameters: z.object({ a: z.string() }),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: 'never' }
      }
    })
    const res = await r.call(makeCall('p', '{not json'), fakeCtx())
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Invalid JSON/)
  })

  it('空字符串 arguments 视为 {} 传给 zod', async () => {
    const r = new ToolRegistry()
    const exec = vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'x' }))
    r.register({
      name: 'opt',
      description: '',
      parameters: z.object({ a: z.string().optional() }),
      requiresApproval: false,
      execute: exec
    })
    const res = await r.call(makeCall('opt', ''), fakeCtx())
    expect(res.ok).toBe(true)
    expect(exec).toHaveBeenCalledWith({}, expect.anything())
  })

  it('zod 校验失败返回错误摘要（不抛异常）', async () => {
    const r = new ToolRegistry()
    r.register({
      name: 'v',
      description: '',
      parameters: z.object({ n: z.number().min(10) }),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: '' }
      }
    })
    const res = await r.call(makeCall('v', { n: 3 }), fakeCtx())
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Argument validation failed/)
    expect(res.content).toMatch(/n/)
  })

  it('execute 抛异常被吞下转成 ok=false', async () => {
    const r = new ToolRegistry()
    r.register({
      name: 'boom',
      description: '',
      parameters: z.object({}),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        throw new Error('kaboom')
      }
    })
    const res = await r.call(makeCall('boom', {}), fakeCtx())
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/kaboom/)
  })
})

describe('ToolRegistry.toOpenAiSpecs', () => {
  it('产出符合 OpenAI function-calling 结构 + 剥掉 $schema', () => {
    const r = new ToolRegistry()
    r.register({
      name: 'demo',
      description: 'a demo',
      parameters: z.object({ path: z.string() }),
      requiresApproval: false,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: '' }
      }
    })
    const specs = r.toOpenAiSpecs()
    expect(specs).toHaveLength(1)
    expect(specs[0].type).toBe('function')
    expect(specs[0].function.name).toBe('demo')
    expect(specs[0].function.description).toBe('a demo')
    expect(specs[0].function.parameters).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    })
    expect(specs[0].function.parameters.$schema).toBeUndefined()
  })

  it('外部工具（MCP）自带 parametersJsonSchema 时优先直发，不经 zod 转换', () => {
    const r = new ToolRegistry()
    r.register({
      name: 'mcp_x_echo',
      description: '[MCP:x] echo',
      parameters: z.unknown(),
      parametersJsonSchema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg']
      },
      requiresApproval: true,
      async execute(): Promise<ToolResult> {
        return { ok: true, content: '' }
      }
    })
    const spec = r.toOpenAiSpecs()[0]
    expect(spec.function.parameters).toEqual({
      type: 'object',
      properties: { msg: { type: 'string' } },
      required: ['msg']
    })
  })
})
