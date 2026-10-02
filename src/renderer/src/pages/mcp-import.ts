import type { McpHttpConfig, McpStdioConfig, McpTransport } from '@shared/types'

/**
 * mcp.json 导入解析（业界通用格式，Claude/Cursor/魔搭详情页同构）：
 *   { "mcpServers": { "名称": { "command": "...", "args": [], "env": {} } } }
 *   远程条目为 { "url": "https://...", "headers": {} }，可选 "type": "sse"
 * 纯函数放独立模块便于 node 环境直接测，页面只消费结果。
 */

export interface ParsedMcpServer {
  name: string
  transport: McpTransport
  config: McpStdioConfig | McpHttpConfig
}

export interface McpJsonParseResult {
  servers: ParsedMcpServer[]
  /** 结构不认识、被跳过的条目名 */
  skipped: string[]
  /** 整体不可用的原因（有则 servers 为空） */
  error?: string
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === 'object' &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  )
}

function parseEntry(name: string, cfg: unknown): ParsedMcpServer | null {
  if (!cfg || typeof cfg !== 'object') return null
  const c = cfg as Record<string, unknown>
  if (typeof c.url === 'string') {
    const config: McpHttpConfig = { url: c.url }
    // 魔搭/常见托管的 SSE 端点：显式 type=sse 或 url 以 /sse 结尾
    if (c.type === 'sse' || /\/sse\/?$/.test(c.url)) config.sse = true
    if (isStringRecord(c.headers)) config.headers = c.headers
    return { name, transport: 'http', config }
  }
  if (typeof c.command === 'string') {
    const config: McpStdioConfig = { command: c.command }
    if (Array.isArray(c.args))
      config.args = c.args.filter((a): a is string => typeof a === 'string')
    if (isStringRecord(c.env)) config.env = c.env
    return { name, transport: 'stdio', config }
  }
  return null
}

export function parseMcpJson(text: string): McpJsonParseResult {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (e) {
    return { servers: [], skipped: [], error: `JSON 解析失败：${(e as Error).message}` }
  }
  const serversField = (obj as Record<string, unknown> | null)?.mcpServers
  if (!serversField || typeof serversField !== 'object') {
    return {
      servers: [],
      skipped: [],
      error: '未找到 mcpServers 字段，请粘贴完整的 mcp.json 配置'
    }
  }
  const servers: ParsedMcpServer[] = []
  const skipped: string[] = []
  for (const [name, cfg] of Object.entries(serversField as Record<string, unknown>)) {
    const parsed = parseEntry(name, cfg)
    if (parsed) servers.push(parsed)
    else skipped.push(name)
  }
  if (servers.length === 0) {
    return {
      servers: [],
      skipped,
      error: skipped.length
        ? `条目 ${skipped.join('、')} 既无 command 也无 url，无法识别`
        : '配置里没有任何服务器条目'
    }
  }
  return { servers, skipped }
}
