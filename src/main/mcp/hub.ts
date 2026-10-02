import type { McpHubItem, McpHubSearchResult, McpToolDoc } from '@shared/types'

/**
 * 魔搭（ModelScope）MCP 市场客户端——只做协议与防御投影，不碰 DB、不碰连接。
 *
 * API 契约（2026-09 实测，匿名可调）：
 * - 列表/搜索：PUT https://www.modelscope.cn/api/v1/dolphin/mcpServers
 *   body {Query, PageNumber(1 起), PageSize, Criterion:[]}
 *   → {Code:200, Success:true, Data:{McpServer:{TotalCount, McpServers[]}}}
 *   行内自带 ChineseName/AbstractCN/Category/Hosted/ServerConfig/CallVolume/Stars。
 *   分类筛选：Criterion 各种形状实测均不生效（未公开），Category 只作展示。
 * - 详情：GET /api/v1/mcpServers/{path}/{name}；Hosted 专属 URL（DeployedUrl）
 *   匿名恒为空串，带「访问令牌」Authorization: Bearer 时才可能返回。
 */

export const MODELSCOPE_BASE_URL = 'https://www.modelscope.cn'

export interface MsHubOpts {
  baseUrl?: string
  /** 搜索超时（毫秒） */
  timeoutMs?: number
}

/** 安装计划：市场条目 → 可直接喂给 mcp.add 的连接配置 + 元数据快照 */
export interface McpInstallPlan {
  name: string
  displayName: string
  hubId: string
  transport: 'stdio' | 'http'
  config: Record<string, unknown>
  description: string
  category: string[]
  sourceUrl: string
  stars: number
  callVolume: number
  readme: string
  toolsDoc: McpToolDoc[]
  license: string
  publisher: string
  iconUrl: string
  updatedAt: number
  viewCount: number
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 防御投影：市场后端加字段/改类型都不掀桌 */
function projectItem(raw: unknown): McpHubItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = str(r.Name)
  const path = str(r.Path)
  if (!name || !path) return null
  return {
    hubId: `${path}/${name}`,
    path,
    name,
    chineseName: str(r.ChineseName),
    description: str(r.AbstractCN) || str(r.Abstract),
    category: Array.isArray(r.Category) ? (r.Category as unknown[]).map(String) : [],
    hosted: r.Hosted === true,
    transportTypes: Array.isArray(r.SupportedDeployTransportType)
      ? (r.SupportedDeployTransportType as unknown[]).map(String)
      : [],
    callVolume: num(r.CallVolume),
    stars: num(r.Stars),
    fromSiteUrl: str(r.FromSiteUrl)
  }
}

/** 防御投影市场 Tools[] → McpToolDoc[]：只认 name 为字符串的条目，带 description/inputSchema */
function projectTools(raw: unknown): McpToolDoc[] {
  if (!Array.isArray(raw)) return []
  const out: McpToolDoc[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const rec = t as Record<string, unknown>
    const name = str(rec.name)
    if (!name) continue
    const doc: McpToolDoc = { name }
    if (typeof rec.description === 'string' && rec.description) doc.description = rec.description
    if (rec.inputSchema && typeof rec.inputSchema === 'object')
      doc.inputSchema = rec.inputSchema as Record<string, unknown>
    out.push(doc)
  }
  return out
}

/** ServerConfig 形如 [{mcpServers:{fetch:{command,args,env}}}]（也可能是 JSON 字符串） */
function parseStdioEntry(
  raw: unknown
): { serverName: string; config: Record<string, unknown> } | null {
  let v: unknown = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  const first = Array.isArray(v) ? v[0] : v
  if (!first || typeof first !== 'object') return null
  const servers = (first as Record<string, unknown>).mcpServers
  if (!servers || typeof servers !== 'object') return null
  const entries = Object.entries(servers as Record<string, unknown>)
  for (const [serverName, cfg] of entries) {
    if (
      cfg &&
      typeof cfg === 'object' &&
      typeof (cfg as Record<string, unknown>).command === 'string'
    ) {
      return { serverName, config: cfg as Record<string, unknown> }
    }
  }
  return null
}

export class MsHubClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(opts: MsHubOpts = {}) {
    this.baseUrl = opts.baseUrl ?? MODELSCOPE_BASE_URL
    this.timeoutMs = opts.timeoutMs ?? 15_000
  }

  async search(params: {
    keyword?: string
    page?: number
    pageSize?: number
  }): Promise<McpHubSearchResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/dolphin/mcpServers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Query: params.keyword ?? '',
        PageNumber: params.page ?? 1,
        PageSize: params.pageSize ?? 24,
        Criterion: []
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!res.ok) throw new Error(`魔搭接口返回 HTTP ${res.status}`)
    const j = (await res.json()) as Record<string, unknown>
    const data = j.Data as Record<string, unknown> | undefined
    const block = data?.McpServer as { TotalCount?: number; McpServers?: unknown[] } | undefined
    if (j.Code !== 200 || !block || !Array.isArray(block.McpServers)) {
      throw new Error('魔搭返回数据异常')
    }
    return {
      items: block.McpServers.map(projectItem).filter((x): x is McpHubItem => x !== null),
      total: num(block.TotalCount),
      page: params.page ?? 1
    }
  }

  /**
   * 详情 + 安装计划。token（魔搭访问令牌）有则带 Bearer 头，
   * Hosted 服务才可能拿到专属 URL；无 token 的匿名请求只能走 stdio。
   */
  async resolveInstall(path: string, name: string, token?: string): Promise<McpInstallPlan> {
    const url = `${this.baseUrl}/api/v1/mcpServers/${encodeURIComponent(path)}/${encodeURIComponent(name)}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!res.ok) throw new Error(`魔搭接口返回 HTTP ${res.status}`)
    const j = (await res.json()) as Record<string, unknown>
    const data = j.Data as Record<string, unknown> | undefined
    const s = (data?.McpServer ?? data) as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') throw new Error('魔搭返回数据异常')

    const displayName = str(s.ChineseName) || name
    const hubId = `${path}/${name}`
    // 市场元数据 + 文档快照：安装时一并落库，供详情页离线展示（缺字段回退空值）
    const meta = {
      description: str(s.AbstractCN) || str(s.Abstract),
      category: Array.isArray(s.Category) ? (s.Category as unknown[]).map(String) : [],
      sourceUrl: str(s.FromSiteUrl),
      stars: num(s.Stars),
      callVolume: num(s.CallVolume),
      readme: str(s.ReadmeCN) || str(s.Readme) || str(s.OriginalReadme),
      toolsDoc: projectTools(s.Tools),
      license: str(s.License),
      publisher: str(s.Path),
      iconUrl: str(s.FromSiteIcon),
      // 魔搭 GmtUpdated 为秒级 Unix 时间戳，转毫秒存储
      updatedAt: num(s.GmtUpdated) ? num(s.GmtUpdated) * 1000 : 0,
      viewCount: num(s.ViewCount)
    }
    // 专属 URL：列表字段是字符串；配置字段可能是对象 {url|type}
    const deployedUrl = str(s.DeployedUrl)
    const deployedType = str(s.DeployedUrlTransportType)
    if (deployedUrl) {
      return {
        name,
        displayName,
        hubId,
        transport: 'http',
        config: { url: deployedUrl, sse: deployedType === 'sse' },
        ...meta
      }
    }
    const stdio = parseStdioEntry(s.ServerConfig)
    if (stdio) {
      const config: Record<string, unknown> = { command: stdio.config.command }
      if (Array.isArray(stdio.config.args)) config.args = stdio.config.args
      if (stdio.config.env && typeof stdio.config.env === 'object') config.env = stdio.config.env
      return { name: stdio.serverName, displayName, hubId, transport: 'stdio', config, ...meta }
    }
    throw new Error(
      '该服务需要魔搭登录后的专属地址：请在设置里配置魔搭访问令牌后重试，或到详情页复制配置用「导入配置」粘贴'
    )
  }
}
