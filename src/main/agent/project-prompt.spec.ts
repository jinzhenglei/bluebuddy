import { describe, it, expect } from 'vitest'
import {
  PROJECT_ARTIFACT_LIMIT,
  buildProjectPromptSection,
  type ProjectPromptAsset,
  type ProjectPromptInput
} from './project-prompt'

/** 造 n 条产出条目 */
function files(n: number, prefix = 'out'): ProjectPromptAsset[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `${prefix}${i}.md`,
    relPath: `docs/${prefix}${i}.md`,
    sessionTitle: '任务甲'
  }))
}

const project: ProjectPromptInput = {
  name: '蓝本仓库',
  workDir: 'D:/work/bluebuddy',
  instructions: '本项目用 pnpm，提交前必须跑三门禁。'
}

describe('buildProjectPromptSection（项目空间上下文注入）', () => {
  it('既无指令又无产物时返回空串（不产生多余空行）', () => {
    expect(buildProjectPromptSection({ ...project, instructions: '' }, [])).toBe('')
    expect(buildProjectPromptSection({ name: 'x', workDir: '/x' }, [])).toBe('')
  })

  it('只有指令：输出项目段与指令原文，不含「已有产出」标题', () => {
    const out = buildProjectPromptSection(project, [])
    expect(out).toContain('蓝本仓库')
    expect(out).toContain('D:/work/bluebuddy')
    expect(out).toContain('提交前必须跑三门禁')
    expect(out).not.toContain('已有产出')
  })

  it('只有产物：输出产出清单，含文件名、相对路径与来源任务', () => {
    const out = buildProjectPromptSection({ name: 'x', workDir: '/x', instructions: null }, [
      { name: '报告.md', relPath: 'docs/报告.md', sessionTitle: '写年报' }
    ])
    expect(out).toContain('已有产出')
    expect(out).toContain('报告.md')
    expect(out).toContain('docs/报告.md')
    expect(out).toContain('写年报')
  })

  it('其他途径的条目（无来源任务）不带「来自」段', () => {
    const out = buildProjectPromptSection({ name: 'x', workDir: '/x' }, [
      { name: '手册.md', relPath: 'docs/手册.md' }
    ])
    expect(out).toContain('- 手册.md（docs/手册.md）')
    expect(out).not.toContain('来自')
  })

  it('缺 relPath 的条目被跳过；全被跳过时不输出产出段', () => {
    const out = buildProjectPromptSection({ name: 'x', workDir: '/x' }, [
      { name: '无路径', relPath: undefined, sessionTitle: 't' }
    ])
    expect(out).toBe('')
  })

  it('入参里多余的 url/内容字段不会泄进提示词（防带 token 的链接被喂给模型）', () => {
    const out = buildProjectPromptSection(project, [
      { name: '带密钥链接', url: 'https://h?token=SECRET', content: '正文' } as never,
      { name: 'a.md', relPath: 'a.md', sessionTitle: 't' }
    ])
    expect(out).not.toContain('SECRET')
    expect(out).not.toContain('正文')
    expect(out).toContain('a.md')
  })

  it('超过上限只列前 N 条，并给出「另有 M 项未列出」', () => {
    const total = PROJECT_ARTIFACT_LIMIT + 3
    const out = buildProjectPromptSection(project, files(total))
    // 前 N 条列出，多出的 3 条不出现
    expect(out).toContain('out0.md')
    expect(out).toContain(`out${PROJECT_ARTIFACT_LIMIT - 1}.md`)
    expect(out).not.toContain(`out${PROJECT_ARTIFACT_LIMIT}.md`)
    expect(out).toContain(`另有 3 项未列出`)
  })

  it('刚好等于上限时不出现「未列出」文案', () => {
    const out = buildProjectPromptSection(
      { name: 'x', workDir: '/x' },
      files(PROJECT_ARTIFACT_LIMIT)
    )
    expect(out).not.toContain('未列出')
  })

  it('opts.limit 可覆盖上限（留给后续按 token 预算收紧）', () => {
    const out = buildProjectPromptSection(project, files(10), { limit: 4 })
    expect(out).toContain('out3.md')
    expect(out).not.toContain('out4.md')
    expect(out).toContain('另有 6 项未列出')
  })

  it('指令与产出两段之间以空行分隔，且不以换行开头或结尾', () => {
    const out = buildProjectPromptSection(project, files(2))
    expect(out.startsWith('\n')).toBe(false)
    expect(out.endsWith('\n')).toBe(false)
    expect(out).toContain('\n\n### ')
  })

  it('指令原文中的换行原样保留（多行规范不被压平）', () => {
    const out = buildProjectPromptSection(
      { name: 'x', workDir: '/x', instructions: '第一行\n第二行' },
      []
    )
    expect(out).toContain('第一行\n第二行')
  })
})
