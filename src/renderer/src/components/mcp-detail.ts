import type { McpServerStatus, McpToolDoc } from '@shared/types'

/** 一条工具参数（从 JSON Schema properties 抽出，供参数表渲染） */
export interface ToolParam {
  name: string
  type: string
  required: boolean
  default?: string
  description?: string
}

/** 从 inputSchema 抽参数表；无 properties 或脏结构回退空数组 */
export function toolParams(schema: McpToolDoc['inputSchema']): ToolParam[] {
  if (!schema || typeof schema !== 'object') return []
  const props = schema.properties
  if (!props || typeof props !== 'object') return []
  const requiredArr = Array.isArray(schema.required) ? (schema.required as unknown[]) : []
  const required = requiredArr.map(String)
  return Object.entries(props as Record<string, unknown>).map(([name, def]) => {
    const d = (def && typeof def === 'object' ? def : {}) as Record<string, unknown>
    let type = 'any'
    if (typeof d.type === 'string') type = d.type
    else if (Array.isArray(d.type)) type = (d.type as unknown[]).map(String).join('|')
    else if (d.anyOf || d.oneOf) type = 'mixed'
    return {
      name,
      type,
      required: required.includes(name),
      ...(d.default !== undefined ? { default: JSON.stringify(d.default) } : {}),
      ...(typeof d.description === 'string' && d.description ? { description: d.description } : {})
    }
  })
}

/** README 按标题关键词归类到各段（Markdown 原文，未命中标题下的内容丢弃） */
export interface ReadmeSections {
  overview: string
  features: string
  examples: string
  faq: string
  notes: string
}

const BUCKETS: { key: keyof ReadmeSections; re: RegExp }[] = [
  { key: 'features', re: /(功能|特性|可用工具|能力|feature|capabilit|prompt|提示|tools)/i },
  {
    key: 'examples',
    re: /(示例|使用|用法|快速|安装|配置|部署|usage|example|install|config|getting started|quick ?start)/i
  },
  { key: 'faq', re: /(常见问题|faq|故障|排查|调试|debug|troubleshoot|疑问)/i },
  {
    key: 'notes',
    re: /(注意|须知|安全|限制|前提|约束|许可|license|caution|warning|security|robots|rate.?limit)/i
  }
]

function classify(title: string): keyof ReadmeSections | 'drop' {
  for (const b of BUCKETS) if (b.re.test(title)) return b.key
  return 'drop'
}

/** 把 README 按 #/##… 标题切段并归类；围栏代码块内的 # 不误判为标题 */
export function parseReadme(readme: string): ReadmeSections {
  const out: ReadmeSections = { overview: '', features: '', examples: '', faq: '', notes: '' }
  if (!readme) return out
  const lines = readme.split(/\r?\n/)
  let bucket: keyof ReadmeSections | 'drop' = 'overview'
  let inFence = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) inFence = !inFence
    if (!inFence) {
      const m = line.match(/^(#{1,6})\s+(.*)$/)
      if (m) {
        bucket = classify(m[2].trim())
        continue // 标题行本身不进正文
      }
    }
    if (bucket !== 'drop') out[bucket] += line + '\n'
  }
  for (const k of Object.keys(out) as (keyof ReadmeSections)[]) out[k] = out[k].trim()
  return out
}

/** 通用注意事项——均为 BlueBuddy MCP 机制的真实行为，与具体服务无关 */
export function genericNotes(s: McpServerStatus): string[] {
  const notes: string[] = [
    'MCP 服务器进程以你的本机权限运行，不受工作区沙箱约束，因此其工具每次调用都需在批准面板逐次确认。',
    '环境变量与请求头的值可能包含密钥，界面仅显示键名、隐去值。',
    '工具说明为安装时从市场抓取的内容快照；服务端更新后需重新安装才会刷新。'
  ]
  if (s.transport === 'stdio') {
    notes.push(
      'stdio 服务需本机已安装对应运行时（如 node/npx、uv/uvx、python），缺失会导致「连接失败」。'
    )
  }
  if (s.license) {
    notes.push(`该服务以 ${s.license} 发布，使用请遵循其许可条款。`)
  }
  return notes
}

/** 通用常见问题——均为 BlueBuddy 连接器页的真实操作 */
export function genericFaq(): { q: string; a: string }[] {
  return [
    {
      q: '连接失败怎么办？',
      a: '多为启动命令缺失（未装 uvx/npx/python 等）或网络问题。可点「重连」重试，或在详情里核对命令 / 地址与环境变量是否正确。'
    },
    {
      q: '修改配置后如何生效？',
      a: '停用再启用，或点「重连」，会重新建立连接并拉取最新工具列表。'
    },
    {
      q: '停用 / 删除有什么影响？',
      a: '停用会断开连接并即时下架其工具；删除会移除登记与工具，但历史对话记录保留。'
    },
    {
      q: '工具会被自动执行吗？',
      a: '不会。所有 MCP 工具调用都需你在批准面板确认后才会执行。'
    }
  ]
}
