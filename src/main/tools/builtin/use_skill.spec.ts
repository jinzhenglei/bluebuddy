import { describe, it, expect } from 'vitest'
import { createUseSkillTool } from './use_skill'
import { SkillRegistry } from '../../skills/registry'
import { toJsonSchema } from '../types'
import type { LoadedSkill } from '../../skills/types'
import type { ToolContext } from '../types'

const dummyCtx = {} as ToolContext

function s(name: string, body: string): LoadedSkill {
  return { name, description: 'd', dir: '', entryPath: '', body }
}

describe('use_skill 元工具', () => {
  const registry = new SkillRegistry([s('report-writer', '# 步骤\n先 list_dir 再写报告')])
  const tool = createUseSkillTool(registry)

  it('名为 use_skill 且不需批准（加载指令本身无副作用）', () => {
    expect(tool.name).toBe('use_skill')
    expect(tool.requiresApproval).toBe(false)
  })

  it('已知技能返回其正文', async () => {
    const r = await tool.execute({ name: 'report-writer' }, dummyCtx)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('先 list_dir 再写报告')
  })

  it('未知技能返回 ok=false 并回显名字', async () => {
    const r = await tool.execute({ name: 'nope' }, dummyCtx)
    expect(r.ok).toBe(false)
    expect(r.content).toContain('nope')
  })

  it('返回内容含技能目录绝对路径，便于模型用 run_command 运行自带脚本', async () => {
    const reg = new SkillRegistry([
      {
        name: 's2',
        description: 'd',
        dir: '/abs/skills/s2',
        entryPath: '/abs/skills/s2/SKILL.md',
        body: 'run scripts/count.js'
      }
    ])
    const t = createUseSkillTool(reg)
    const r = await t.execute({ name: 's2' }, dummyCtx)
    expect(r.content).toContain('/abs/skills/s2')
    expect(r.content).toContain('run scripts/count.js')
  })

  it('parameters 生成含 name 属性的 JSON Schema', () => {
    const schema = toJsonSchema(tool.parameters)
    expect(schema.properties).toHaveProperty('name')
  })
})
