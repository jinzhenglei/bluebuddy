import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { z } from 'zod'
import type { McpHttpConfig, McpServerInfo, McpServerStatus, McpStdioConfig } from '@shared/types'
import type { DbStore } from '../db/store'
import type { ToolRegistry } from '../tools/registry'
import type { Tool, ToolResult } from '../tools/types'

/**
 * MCP 客户端管理器（Stage 5）：BlueBuddy 作为 MCP host。
 *
 * 生命周期：DB mcp_servers 登记 × 运行时连接池。启用/添加时 connect
 * （initialize → tools/list），把每个远端工具包装成本地 Tool 注册进
 * ToolRegistry，模型即可 function-call；停用/删除即 unregister + close。
 *
 * 安全模型：MCP 服务器进程跑在用户全权下，**不受 Workspace 沙箱约束**，
 * 因此包装出的工具一律 requiresApproval=true，统一过 PermissionGate。
 * 参数校验交给 MCP 服务端（对方自带 inputSchema），本地 zod 只透传。
 */

interface ConnEntry {
  client: Client
  toolNames: string[]
}

interface StatusEntry {
  status: 'connected' | 'error'
  error?: string
  tools: string[]
}

/** 服务器名/工具名里的非字母数字下划线统一换成 _，保证工具名对模型友好 */
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** MCP content[] → 回填模型的纯文本 */
function contentToText(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : JSON.stringify(content ?? null)
  }
  return content
    .map((c) => {
      if (c && typeof c === 'object') {
        const rec = c as Record<string, unknown>
        if (rec.type === 'text') return String(rec.text ?? '')
        if (rec.type === 'image' || rec.type === 'audio') return `[${rec.type} 内容已省略]`
      }
      return JSON.stringify(c)
    })
    .join('\n')
}

export class McpManager {
  private conns = new Map<string, ConnEntry>()
  private statuses = new Map<string, StatusEntry>()

  constructor(private opts: { db: DbStore; toolRegistry: ToolRegistry }) {}

  /** 工具名规则：mcp_<服务器>_<工具>，避免与内置工具撞名 */
  toolName(serverName: string, toolName: string): string {
    return `mcp_${slug(serverName)}_${slug(toolName)}`
  }

  /** 启动时调用：并行连接所有启用服务器，单挂不拖全局（状态记 error） */
  async init(): Promise<void> {
    const servers = this.opts.db.listMcpServers().filter((s) => s.enabled)
    await Promise.allSettled(servers.map((s) => this.connect(s)))
  }

  async connect(server: McpServerInfo): Promise<void> {
    await this.disconnect(server.id)
    const client = new Client({ name: 'bluebuddy', version: '0.1.0' })
    try {
      if (server.transport === 'stdio') {
        const cfg = server.config as McpStdioConfig
        await client.connect(
          new StdioClientTransport({
            command: cfg.command,
            args: cfg.args ?? [],
            env: cfg.env ? { ...getDefaultEnvironment(), ...cfg.env } : undefined
          })
        )
      } else {
        const cfg = server.config as McpHttpConfig
        const opts = cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined
        // 魔搭托管端点两种形态都有：sse 标记走 SSE，默认 Streamable HTTP
        await client.connect(
          cfg.sse
            ? new SSEClientTransport(new URL(cfg.url), opts)
            : new StreamableHTTPClientTransport(new URL(cfg.url), opts)
        )
      }
      const { tools } = await client.listTools()
      const wrapped = tools.map((t) => this.wrapTool(server, t, client))
      for (const w of wrapped) {
        // 重连/重名场景先下架旧的，避免 register 抛 Duplicate
        if (this.opts.toolRegistry.get(w.name)) this.opts.toolRegistry.unregister(w.name)
        this.opts.toolRegistry.register(w)
      }
      const names = wrapped.map((w) => w.name)
      this.conns.set(server.id, { client, toolNames: names })
      this.statuses.set(server.id, { status: 'connected', tools: names })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await client.close()
      } catch {
        // 连接失败后的 close 可能再抛，忽略
      }
      this.statuses.set(server.id, { status: 'error', error: msg, tools: [] })
      throw err
    }
  }

  async disconnect(id: string): Promise<void> {
    const entry = this.conns.get(id)
    if (!entry) {
      this.statuses.delete(id)
      return
    }
    for (const name of entry.toolNames) this.opts.toolRegistry.unregister(name)
    this.conns.delete(id)
    this.statuses.delete(id)
    try {
      await entry.client.close()
    } catch {
      // 子进程/连接已死时 close 抛错无碍，工具已下架
    }
  }

  /** 管理页数据源：登记信息 + 运行时状态 */
  listStatus(): McpServerStatus[] {
    return this.opts.db.listMcpServers().map((s) => {
      const st = this.statuses.get(s.id)
      return {
        ...s,
        status: !s.enabled ? ('disabled' as const) : (st?.status ?? ('error' as const)),
        error: st?.error,
        tools: st?.tools ?? []
      }
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    this.opts.db.setMcpServerEnabled(id, enabled)
    const row = this.opts.db.getMcpServer(id)
    if (!row) return { ok: false, error: '服务器不存在' }
    if (!enabled) {
      await this.disconnect(id)
      return { ok: true }
    }
    try {
      await this.connect(row)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async add(input: {
    name: string
    transport: 'stdio' | 'http'
    config: McpServerInfo['config']
    displayName?: string
    hubId?: string
    description?: string
    category?: string[]
    sourceUrl?: string
    stars?: number
    callVolume?: number
    readme?: string
    toolsDoc?: McpServerInfo['toolsDoc']
    license?: string
    publisher?: string
    iconUrl?: string
    updatedAt?: number
    viewCount?: number
  }): Promise<{ ok: boolean; server?: McpServerInfo; error?: string }> {
    try {
      const row = this.opts.db.addMcpServer(input)
      try {
        await this.connect(row)
      } catch (err) {
        // 登记保留（状态 error），用户可改配置后重连
        return {
          ok: true,
          server: row,
          error: `已登记但连接失败：${err instanceof Error ? err.message : String(err)}`
        }
      }
      return { ok: true, server: row }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.opts.db.deleteMcpServer(id)
  }

  async reconnect(id: string): Promise<{ ok: boolean; error?: string }> {
    const row = this.opts.db.getMcpServer(id)
    if (!row) return { ok: false, error: '服务器不存在' }
    if (!row.enabled) return { ok: false, error: '服务器已停用，请先启用' }
    try {
      await this.connect(row)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 退出时调用：关掉所有子进程/连接 */
  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.conns.keys()].map((id) => this.disconnect(id)))
  }

  /** 远端工具 → 本地 Tool：名字加前缀、描述标来源、一律批准、调用转发 tools/call */
  private wrapTool(
    server: McpServerInfo,
    tool: { name: string; description?: string; inputSchema?: unknown },
    client: Client
  ): Tool<unknown> {
    const name = this.toolName(server.name, tool.name)
    const remoteName = tool.name
    return {
      name,
      description: `[MCP:${server.name}] ${tool.description ?? remoteName}`,
      // 透传占位：运行时校验由 MCP 服务端按自己的 inputSchema 做
      parameters: z.unknown(),
      parametersJsonSchema:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: 'object' as const },
      requiresApproval: true,
      approvalReason: (input: unknown) =>
        `MCP 工具 ${name}（服务器 ${server.name}），参数：${JSON.stringify(input ?? {}).slice(0, 200)}`,
      execute: async (input: unknown): Promise<ToolResult> => {
        const res = await client.callTool({
          name: remoteName,
          arguments: (input ?? {}) as Record<string, unknown>
        })
        const text = contentToText(res.content)
        return {
          ok: res.isError !== true,
          content: text || '(空响应)'
        }
      }
    }
  }
}
