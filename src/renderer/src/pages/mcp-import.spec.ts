import { describe, expect, it } from 'vitest'
import { parseMcpJson } from './mcp-import'

describe('parseMcpJson（mcp.json 导入解析）', () => {
  it('stdio 条目：command/args/env 完整透传', () => {
    const r = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          fetch: { command: 'uvx', args: ['mcp-server-fetch'], env: { KEY: 'v' } }
        }
      })
    )
    expect(r.error).toBeUndefined()
    expect(r.servers).toEqual([
      {
        name: 'fetch',
        transport: 'stdio',
        config: { command: 'uvx', args: ['mcp-server-fetch'], env: { KEY: 'v' } }
      }
    ])
  })

  it('http 条目：默认 streamable；type=sse 或 /sse 结尾标记 sse；headers 保留', () => {
    const r = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          a: { url: 'https://x/mcp' },
          b: { url: 'https://x/sse', type: 'sse' },
          c: { url: 'https://x/api/sse/', headers: { Authorization: 'Bearer t' } }
        }
      })
    )
    expect(r.servers).toHaveLength(3)
    expect(r.servers[0].config).toEqual({ url: 'https://x/mcp' })
    expect(r.servers[1].config).toEqual({ url: 'https://x/sse', sse: true })
    expect(r.servers[2].config).toEqual({
      url: 'https://x/api/sse/',
      sse: true,
      headers: { Authorization: 'Bearer t' }
    })
    expect(r.servers.every((s) => s.transport === 'http')).toBe(true)
  })

  it('混合批量：可识别的进 servers，不认识的进 skipped', () => {
    const r = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          good: { command: 'npx', args: ['-y', 'x'] },
          weird: { something: 'else' },
          alsoWeird: 'not-an-object'
        }
      })
    )
    expect(r.servers.map((s) => s.name)).toEqual(['good'])
    expect(r.skipped).toEqual(['weird', 'alsoWeird'])
  })

  it('全部不认识 → error 列出条目名', () => {
    const r = parseMcpJson(JSON.stringify({ mcpServers: { x: { foo: 1 } } }))
    expect(r.servers).toHaveLength(0)
    expect(r.error).toContain('x')
  })

  it('坏 JSON / 缺 mcpServers / 空对象 → 明确错误信息', () => {
    expect(parseMcpJson('{oops').error).toContain('JSON 解析失败')
    expect(parseMcpJson('{"servers":{}}').error).toContain('未找到 mcpServers')
    expect(parseMcpJson('{"mcpServers":{}}').error).toContain('没有任何服务器条目')
  })
})
