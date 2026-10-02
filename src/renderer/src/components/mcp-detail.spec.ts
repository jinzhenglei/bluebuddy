import { describe, expect, it } from 'vitest'
import type { McpServerStatus } from '@shared/types'
import { genericFaq, genericNotes, parseReadme, toolParams } from './mcp-detail'

function status(over: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    id: 's',
    name: 'n',
    transport: 'stdio',
    config: { command: 'uvx' },
    enabled: true,
    createdAt: 0,
    status: 'connected',
    tools: [],
    ...over
  } as McpServerStatus
}

describe('toolParams', () => {
  it('从 properties/required 抽参数表', () => {
    const p = toolParams({
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的 URL' },
        max_length: { type: 'integer', default: 5000 }
      },
      required: ['url']
    })
    expect(p).toEqual([
      { name: 'url', type: 'string', required: true, description: '要抓取的 URL' },
      { name: 'max_length', type: 'integer', required: false, default: '5000' }
    ])
  })
  it('数组类型合并、anyOf 记 mixed', () => {
    const p = toolParams({
      properties: { a: { type: ['string', 'null'] }, b: { anyOf: [] } }
    })
    expect(p[0]).toMatchObject({ name: 'a', type: 'string|null' })
    expect(p[1]).toMatchObject({ name: 'b', type: 'mixed' })
  })
  it('无 schema / 无 properties 回退空', () => {
    expect(toolParams(undefined)).toEqual([])
    expect(toolParams({ type: 'object' })).toEqual([])
  })
})

describe('parseReadme', () => {
  const md = [
    '开头简介段落。',
    '',
    '## 可用工具',
    '- `fetch` 抓取网页',
    '',
    '## 安装',
    '```bash',
    'uvx mcp-server-fetch',
    '```',
    '',
    '## 常见问题',
    '连接失败请重连。',
    '',
    '## 许可证',
    'MIT',
    '',
    '## 贡献',
    '欢迎 PR。'
  ].join('\n')
  const r = parseReadme(md)
  it('首段进 overview', () => {
    expect(r.overview).toBe('开头简介段落。')
  })
  it('工具/示例/FAQ/注意 按标题归类', () => {
    expect(r.features).toContain('`fetch` 抓取网页')
    expect(r.examples).toContain('uvx mcp-server-fetch')
    expect(r.faq).toContain('连接失败请重连。')
    expect(r.notes).toContain('MIT')
  })
  it('未命中标题（贡献）内容被丢弃', () => {
    expect(r.features + r.examples + r.faq + r.notes + r.overview).not.toContain('欢迎 PR')
  })
  it('围栏代码块内的 # 不当作标题', () => {
    const r2 = parseReadme('## 配置\n```\n# 注释\nx\n```')
    expect(r2.examples).toContain('# 注释')
  })
  it('空 README 全空', () => {
    expect(parseReadme('')).toEqual({
      overview: '',
      features: '',
      examples: '',
      faq: '',
      notes: ''
    })
  })
})

describe('genericNotes / genericFaq', () => {
  it('stdio 追加运行时提示、有 license 追加许可提示', () => {
    const notes = genericNotes(status({ transport: 'stdio', license: 'MIT License' }))
    expect(notes.some((n) => n.includes('stdio'))).toBe(true)
    expect(notes.some((n) => n.includes('MIT License'))).toBe(true)
  })
  it('http 不含 stdio 提示', () => {
    const notes = genericNotes(status({ transport: 'http', config: { url: 'https://x' } }))
    expect(notes.some((n) => n.includes('stdio'))).toBe(false)
  })
  it('FAQ 非空且每条有问有答', () => {
    const faq = genericFaq()
    expect(faq.length).toBeGreaterThan(0)
    expect(faq.every((f) => f.q && f.a)).toBe(true)
  })
})
