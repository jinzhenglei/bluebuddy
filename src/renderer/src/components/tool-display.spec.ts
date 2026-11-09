import { describe, expect, it } from 'vitest'
import {
  parseUseSkillName,
  runCommandDisplay,
  skillDisplayName,
  toolCallDisplay,
  toolTitle
} from './tool-display'

describe('parseUseSkillName', () => {
  it('正常参数：取出 name', () => {
    expect(parseUseSkillName('{"name":"legal-query-skill"}')).toBe('legal-query-skill')
  })
  it('含其他字段也能取 name', () => {
    expect(parseUseSkillName('{"foo":1,"name":"x","bar":"y"}')).toBe('x')
  })
  it('空串 / 非法 JSON / 非对象 → null', () => {
    expect(parseUseSkillName('')).toBeNull()
    expect(parseUseSkillName('{oops')).toBeNull()
    expect(parseUseSkillName('"just-a-string"')).toBeNull()
  })
  it('name 缺失 / 非字符串 / 全空白 → null', () => {
    expect(parseUseSkillName('{"other":1}')).toBeNull()
    expect(parseUseSkillName('{"name":123}')).toBeNull()
    expect(parseUseSkillName('{"name":"   "}')).toBeNull()
  })
})

describe('skillDisplayName', () => {
  const skills = [
    { name: 'legal-query-skill', displayName: null },
    { name: 'national-law-knowledge-search', displayName: '国家法律法规知识库检索' },
    { name: 'word-count', displayName: undefined }
  ]
  it('有中文 displayName → 用它', () => {
    expect(skillDisplayName(skills, 'national-law-knowledge-search')).toBe('国家法律法规知识库检索')
  })
  it('displayName 为空/null/undefined → 回退 name', () => {
    expect(skillDisplayName(skills, 'legal-query-skill')).toBe('legal-query-skill')
    expect(skillDisplayName(skills, 'word-count')).toBe('word-count')
  })
  it('displayName 只有空白 → 视为空回退 name', () => {
    expect(skillDisplayName([{ name: 'a', displayName: '   ' }], 'a')).toBe('a')
  })
  it('找不到该技能 → 原样返回传入 name', () => {
    expect(skillDisplayName(skills, 'unknown-skill')).toBe('unknown-skill')
  })
})

describe('runCommandDisplay', () => {
  it('有 summary → 优先用人话摘要（并压成单行）', () => {
    expect(
      runCommandDisplay('{"command":"git","args":["status"],"summary":"查看工作目录的变更状态"}')
    ).toBe('查看工作目录的变更状态')
    expect(runCommandDisplay('{"command":"x","summary":"  多  行\\n 摘要 "}')).toBe('多 行 摘要')
  })
  it('summary 全空白 → 回退命令行', () => {
    expect(runCommandDisplay('{"command":"git","args":["status","--short"],"summary":"  "}')).toBe(
      'git status --short'
    )
  })
  it('无 summary → 命令 + 参数拼成命令行（args 是字符串也容错拆开）', () => {
    expect(runCommandDisplay('{"command":"python","args":["search.py","--query","婚假"]}')).toBe(
      'python search.py --query 婚假'
    )
    expect(runCommandDisplay('{"command":"ls","args":"-la"}')).toBe('ls -la')
    expect(runCommandDisplay('{"command":"pwd"}')).toBe('pwd')
  })
  it('超长截断为单行预览', () => {
    const out = runCommandDisplay(JSON.stringify({ command: 'echo', args: ['x'.repeat(100)] }))
    expect(out).toBe('echo ' + 'x'.repeat(67) + '…')
  })
  it('空串 / 非法 JSON / 非对象 / 无有效 command → null', () => {
    expect(runCommandDisplay('')).toBeNull()
    expect(runCommandDisplay('{oops')).toBeNull()
    expect(runCommandDisplay('"just-a-string"')).toBeNull()
    expect(runCommandDisplay('{"args":["a"]}')).toBeNull()
    expect(runCommandDisplay('{"command":123}')).toBeNull()
    expect(runCommandDisplay('{"command":"   "}')).toBeNull()
  })
})

describe('toolCallDisplay', () => {
  it('搜索类参数 → 查询: 关键词（MCP 工具同理）', () => {
    expect(toolCallDisplay('{"query":"浙江 婚假 天数"}')).toBe('查询: 浙江 婚假 天数')
  })
  it('常见键最多挑两项，键名翻译成中文', () => {
    expect(toolCallDisplay('{"path":"src/a.ts","content":"hello"}')).toBe(
      '路径: src/a.ts · 内容: hello'
    )
    expect(toolCallDisplay('{"url":"https://example.com"}')).toBe('链接: https://example.com')
    expect(toolCallDisplay('{"file_path":"a.ts","filename":"b.ts"}')).toBe(
      '路径: a.ts · 文件名: b.ts'
    )
  })
  it('没有常见键 → 取第一个有值的参数（原样键名）', () => {
    expect(toolCallDisplay('{"foo":1,"bar":"x"}')).toBe('foo: 1')
  })
  it('空白字符串参数跳过；对象值用紧凑 JSON', () => {
    expect(toolCallDisplay('{"query":"   ","text":"关键词"}')).toBe('文本: 关键词')
    expect(toolCallDisplay('{"params":{"a":1}}')).toBe('params: {"a":1}')
  })
  it('空串 / 非法 JSON / 数组 / 空对象 → null', () => {
    expect(toolCallDisplay('')).toBeNull()
    expect(toolCallDisplay('{oops')).toBeNull()
    expect(toolCallDisplay('["a"]')).toBeNull()
    expect(toolCallDisplay('{}')).toBeNull()
  })
})

describe('toolTitle', () => {
  it('server 与 tool 同名的 mcp 全名 → 折叠成一段', () => {
    expect(toolTitle('mcp_bing_search_bing_search')).toBe('bing_search')
  })
  it('不同名的 mcp 工具只去 mcp_ 前缀', () => {
    expect(toolTitle('mcp_serverA_web_search')).toBe('serverA_web_search')
    expect(toolTitle('mcp_solo')).toBe('solo')
  })
  it('非 mcp 名原样返回', () => {
    expect(toolTitle('read_file')).toBe('read_file')
    expect(toolTitle('')).toBe('')
  })
})
