import { describe, expect, it } from 'vitest'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DbStore } from '../db/store'
import { ToolRegistry } from '../tools/registry'
import type { ToolContext } from '../tools/types'
import { McpManager } from './manager'

const FIXTURE = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url))

/** registry.call 需要的最小 ctx（MCP 包装工具不用 workspace/fetch，透传占位即可） */
const CTX = { workspace: {}, fetch: globalThis.fetch } as unknown as ToolContext

interface Harness {
  db: DbStore
  toolRegistry: ToolRegistry
  manager: McpManager
}

function makeHarness(): Harness {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-mcp-'))
  const db = new DbStore(path.join(base, 'db.sqlite'))
  const toolRegistry = new ToolRegistry()
  const manager = new McpManager({ db, toolRegistry })
  return { db, toolRegistry, manager }
}

function addFixtureServer(h: Harness, name = 'fix'): string {
  const row = h.db.addMcpServer({
    name,
    transport: 'stdio',
    config: { command: process.execPath, args: [FIXTURE] }
  })
  return row.id
}

describe('McpManager stdio 端到端', { timeout: 30_000 }, () => {
  it('init 连接启用服务器：工具以 mcp_ 前缀注册、一律批准、外部 schema 直发 OpenAI', async () => {
    const h = makeHarness()
    addFixtureServer(h)
    await h.manager.init()

    const echo = h.toolRegistry.get('mcp_fix_echo')
    expect(echo).toBeDefined()
    expect(echo?.requiresApproval).toBe(true)
    expect(echo?.description).toContain('[MCP:fix]')

    const spec = h.toolRegistry.toOpenAiSpecs().find((s) => s.function.name === 'mcp_fix_echo')
    expect(spec?.function.parameters).toMatchObject({
      properties: { msg: { type: 'string' } },
      required: ['msg']
    })

    await h.manager.shutdown()
    h.db.close()
  })

  it('registry.call 转发 tools/call：成功回填文本，isError 映射 ok=false', async () => {
    const h = makeHarness()
    addFixtureServer(h)
    await h.manager.init()

    const ok = await h.toolRegistry.call(
      {
        id: 'c1',
        type: 'function',
        function: { name: 'mcp_fix_echo', arguments: JSON.stringify({ msg: 'hi' }) }
      },
      CTX
    )
    expect(ok).toMatchObject({ ok: true, content: 'echo:hi' })

    const boom = await h.toolRegistry.call(
      { id: 'c2', type: 'function', function: { name: 'mcp_fix_boom', arguments: '{}' } },
      CTX
    )
    expect(boom).toMatchObject({ ok: false, content: 'kaboom' })

    await h.manager.shutdown()
    h.db.close()
  })

  it('停用即下架、再启用重连恢复；删除后行与工具都没了', async () => {
    const h = makeHarness()
    const id = addFixtureServer(h)
    await h.manager.init()
    expect(h.toolRegistry.get('mcp_fix_echo')).toBeDefined()

    await h.manager.setEnabled(id, false)
    expect(h.toolRegistry.get('mcp_fix_echo')).toBeUndefined()
    expect(h.manager.listStatus()[0]).toMatchObject({ status: 'disabled', tools: [] })

    const on = await h.manager.setEnabled(id, true)
    expect(on.ok).toBe(true)
    expect(h.toolRegistry.get('mcp_fix_echo')).toBeDefined()

    await h.manager.remove(id)
    expect(h.toolRegistry.get('mcp_fix_echo')).toBeUndefined()
    expect(h.db.listMcpServers()).toHaveLength(0)

    await h.manager.shutdown()
    h.db.close()
  })

  it('连接失败不拖垮 init：状态记 error 与错误信息，reconnect 可重试', async () => {
    const h = makeHarness()
    h.db.addMcpServer({
      name: 'dead',
      transport: 'stdio',
      config: { command: 'no-such-binary-bb', args: [] }
    })
    addFixtureServer(h, 'fix')

    await h.manager.init() // 不应抛
    const dead = h.manager.listStatus().find((s) => s.name === 'dead')
    expect(dead?.status).toBe('error')
    expect(dead?.error).toBeTruthy()
    expect(h.toolRegistry.get('mcp_fix_echo')).toBeDefined() // 好服务器不受影响

    await h.manager.shutdown()
    h.db.close()
  })

  it('add 登记即连；连不上也保留登记并返回错误说明', async () => {
    const h = makeHarness()
    const good = await h.manager.add({
      name: 'live',
      transport: 'stdio',
      config: { command: process.execPath, args: [FIXTURE] }
    })
    expect(good.ok).toBe(true)
    expect(good.error).toBeUndefined()
    expect(h.toolRegistry.get('mcp_live_echo')).toBeDefined()

    const bad = await h.manager.add({
      name: 'bad',
      transport: 'stdio',
      config: { command: 'no-such-binary-bb', args: [] }
    })
    expect(bad.ok).toBe(true) // 登记成功
    expect(bad.error).toContain('连接失败')
    expect(h.db.listMcpServers()).toHaveLength(2)

    await h.manager.shutdown()
    h.db.close()
  })
})
