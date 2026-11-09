/**
 * 工具卡片展示相关的纯函数（无 React / 无 IO，便于就近单测）。
 */

/** 可辨识的最小技能形状：SkillInfo 的子集，避免渲染层类型耦合 */
export interface SkillLabel {
  name: string
  displayName?: string | null
}

/**
 * 从 use_skill 的 arguments（JSON 字符串）里解析出目标技能规范名。
 * 参数不完整 / 非法 JSON / name 非字符串时返回 null（调用侧据此回退到默认展示）。
 */
export function parseUseSkillName(rawArgs: string): string | null {
  if (!rawArgs) return null
  try {
    const parsed = JSON.parse(rawArgs) as unknown
    if (parsed && typeof parsed === 'object') {
      const name = (parsed as { name?: unknown }).name
      if (typeof name === 'string' && name.trim()) return name
    }
    return null
  } catch {
    return null
  }
}

/** 技能展示名：优先中文市场名 displayName（去空白），空则回退规范 name */
export function skillDisplayName(skills: SkillLabel[], name: string): string {
  const hit = skills.find((s) => s.name === name)
  const dn = hit?.displayName?.trim()
  return dn || name
}

/**
 * run_command 卡片头部的摘要文案：优先模型给的 summary（一句话说明这条命令是干嘛的），
 * 没有则回退到命令行本身（command + args 拼接）；都解析不出返回 null，调用侧回退默认展示。
 */
export function runCommandDisplay(rawArgs: string): string | null {
  if (!rawArgs) return null
  try {
    const parsed = JSON.parse(rawArgs) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as { summary?: unknown; command?: unknown; args?: unknown }
    const summary = typeof p.summary === 'string' ? p.summary.trim() : ''
    if (summary) return oneLine(summary)
    if (typeof p.command !== 'string' || !p.command.trim()) return null
    // args 容错：模型经常把参数向量写成字符串（如 "-la"），按空白拆开拼回命令行
    const args = Array.isArray(p.args)
      ? p.args.map((x) => String(x))
      : typeof p.args === 'string'
        ? p.args.trim().split(/\s+/).filter(Boolean)
        : []
    return oneLine([p.command.trim(), ...args].join(' '))
  } catch {
    return null
  }
}

/** 压成单行并截断成头部预览（完整参数点开卡片看） */
function oneLine(s: string): string {
  const line = s.replace(/\s+/g, ' ')
  return line.length > 72 ? line.slice(0, 72) + '…' : line
}

/** 参数键 → 摘要里的中文说法（没列到的键原样展示） */
const ARG_LABELS: Record<string, string> = {
  query: '查询',
  keywords: '关键词',
  search: '搜索',
  question: '问题',
  prompt: '提示',
  text: '文本',
  path: '路径',
  file: '路径',
  file_path: '路径',
  filename: '文件名',
  dir: '目录',
  directory: '目录',
  url: '链接',
  uri: '链接',
  link: '链接',
  name: '名称',
  title: '标题',
  id: '标识',
  content: '内容',
  code: '代码',
  pattern: '匹配',
  command: '命令'
}

/** 挑参数的优先级：越靠前越能一行说清「这次调用在干嘛」 */
const ARG_KEY_PRIORITY = [
  'query',
  'keywords',
  'search',
  'question',
  'prompt',
  'text',
  'path',
  'file',
  'file_path',
  'filename',
  'dir',
  'directory',
  'url',
  'uri',
  'link',
  'name',
  'title',
  'id',
  'content',
  'code',
  'pattern',
  'command'
]

/** 参数值压成一行文本；对象/数组用紧凑 JSON；空/不可序列化返回 ''（视为不展示） */
function valueText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    const s = JSON.stringify(v)
    return s == null ? '' : s
  } catch {
    return ''
  }
}

/**
 * 通用工具调用摘要：从参数里挑最关键的一两项拼成一行（如 `查询: 浙江 婚假 天数`），
 * 让卡片不点开就能看懂这次调用是干嘛的。MCP 工具的外部 schema 不能加 summary 参数，
 * 全靠这里从参数里提炼；常见键都没命中时退化到第一个有值的参数。
 */
export function toolCallDisplay(rawArgs: string): string | null {
  if (!rawArgs) return null
  try {
    const parsed = JSON.parse(rawArgs) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, v]) =>
      valueText(v).trim()
    )
    if (!entries.length) return null
    const picked: [string, unknown][] = []
    for (const key of ARG_KEY_PRIORITY) {
      const hit = entries.find(([k]) => k === key)
      if (hit) picked.push(hit)
      if (picked.length >= 2) break
    }
    if (!picked.length) picked.push(entries[0])
    return oneLine(picked.map(([k, v]) => `${ARG_LABELS[k] ?? k}: ${valueText(v)}`).join(' · '))
  } catch {
    return null
  }
}

/**
 * 工具名美化展示：去掉 mcp_ 前缀；server 与 tool 同名的全名
 * （如 mcp_bing_search_bing_search）折叠重复的一半，其余原样返回。
 */
export function toolTitle(name: string): string {
  const rest = name.startsWith('mcp_') ? name.slice(4) : name
  for (let i = 1; i < rest.length - 1; i++) {
    if (rest[i] === '_' && rest.slice(0, i) === rest.slice(i + 1)) return rest.slice(0, i)
  }
  return rest
}
