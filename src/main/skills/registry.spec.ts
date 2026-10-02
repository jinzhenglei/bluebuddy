import { describe, it, expect } from 'vitest'
import { SkillRegistry } from './registry'
import type { LoadedSkill } from './types'

function skill(name: string, description: string, extra: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name,
    description,
    dir: `/skills/${name}`,
    entryPath: `/skills/${name}/SKILL.md`,
    body: `${name} 的指令正文`,
    ...extra
  }
}

describe('SkillRegistry', () => {
  it('空注册表 indexForPrompt 返回空串', () => {
    const r = new SkillRegistry()
    expect(r.indexForPrompt()).toBe('')
    expect(r.size).toBe(0)
  })

  it('add/get/list 基本增删查', () => {
    const r = new SkillRegistry([skill('a', '描述 A')])
    expect(r.get('a')?.description).toBe('描述 A')
    expect(r.list().map((s) => s.name)).toEqual(['a'])
    r.add(skill('b', '描述 B'))
    expect(r.size).toBe(2)
    r.remove('a')
    expect(r.get('a')).toBeUndefined()
    expect(r.size).toBe(1)
  })

  it('同名 add 覆盖旧值', () => {
    const r = new SkillRegistry([skill('a', '旧')])
    r.add(skill('a', '新'))
    expect(r.size).toBe(1)
    expect(r.get('a')?.description).toBe('新')
  })

  it('indexForPrompt 含每个技能的 name 与 description，并提示用 use_skill 加载', () => {
    const r = new SkillRegistry([
      skill('report-writer', '写报告'),
      skill('csv-cleaner', '清洗表格')
    ])
    const text = r.indexForPrompt()
    expect(text).toContain('report-writer')
    expect(text).toContain('写报告')
    expect(text).toContain('csv-cleaner')
    expect(text).toContain('清洗表格')
    expect(text).toContain('use_skill')
  })

  it('indexForPrompt 按插入顺序列出', () => {
    const r = new SkillRegistry([skill('z', '1'), skill('y', '2')])
    const text = r.indexForPrompt()
    expect(text.indexOf('z')).toBeLessThan(text.indexOf('y'))
  })

  it('setAll 整体替换', () => {
    const r = new SkillRegistry([skill('old', 'x')])
    r.setAll([skill('new', 'y')])
    expect(r.list().map((s) => s.name)).toEqual(['new'])
  })
})
