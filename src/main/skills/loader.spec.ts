import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseSkillMarkdown, loadSkillFromDir, discoverSkills } from './loader'

/**
 * 技能加载器测试：parseSkillMarkdown 是纯函数（给字符串返回结构），
 * discoverSkills/loadSkillFromDir 在临时目录里造真实 SKILL.md 验证。
 */

describe('parseSkillMarkdown frontmatter 解析', () => {
  it('解析 name/description 并返回正文', () => {
    const raw = [
      '---',
      'name: report-writer',
      'description: 当需要生成结构化报告时使用',
      '---',
      '# 步骤',
      '先 list_dir，再按模板写报告。',
      ''
    ].join('\n')
    const { meta, body } = parseSkillMarkdown(raw)
    expect(meta.name).toBe('report-writer')
    expect(meta.description).toBe('当需要生成结构化报告时使用')
    expect(body).toContain('先 list_dir')
    expect(body).not.toContain('name: report-writer')
  })

  it('allowed-tools 逗号列表解析为数组', () => {
    const raw = [
      '---',
      'name: x',
      'description: d',
      'allowed-tools: read_file, list_dir',
      '---',
      'body'
    ].join('\n')
    const { meta } = parseSkillMarkdown(raw)
    expect(meta.allowedTools).toEqual(['read_file', 'list_dir'])
  })

  it('requires-approval: true 解析为布尔', () => {
    const raw = ['---', 'name: x', 'description: d', 'requires-approval: true', '---', 'body'].join(
      '\n'
    )
    const { meta } = parseSkillMarkdown(raw)
    expect(meta.requiresApproval).toBe(true)
  })

  it('正文里的冒号行不被当成 frontmatter', () => {
    const raw = [
      '---',
      'name: x',
      'description: d',
      '---',
      'key: value in body',
      'second line'
    ].join('\n')
    const { body } = parseSkillMarkdown(raw)
    expect(body).toContain('key: value in body')
  })

  it('缺少起始 --- 抛错', () => {
    expect(() => parseSkillMarkdown('name: x\ndescription: d')).toThrow()
  })

  it('缺少 name 抛错', () => {
    expect(() => parseSkillMarkdown('---\ndescription: d\n---\nbody')).toThrow(/name/)
  })

  it('缺少 description 抛错', () => {
    expect(() => parseSkillMarkdown('---\nname: x\n---\nbody')).toThrow(/description/)
  })
})

describe('loadSkillFromDir / discoverSkills', () => {
  let tmp: string

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-skills-'))
    // skill-a：合法
    const a = path.join(tmp, 'skill-a')
    await fs.mkdir(a, { recursive: true })
    await fs.writeFile(
      path.join(a, 'SKILL.md'),
      ['---', 'name: skill-a', 'description: 描述 A', '---', '做 A 的指令'].join('\n')
    )
    // skill-b：合法，带 requires-approval
    const b = path.join(tmp, 'skill-b')
    await fs.mkdir(b, { recursive: true })
    await fs.writeFile(
      path.join(b, 'SKILL.md'),
      [
        '---',
        'name: skill-b',
        'description: 描述 B',
        'requires-approval: true',
        '---',
        '做 B'
      ].join('\n')
    )
    // not-a-skill：没有 SKILL.md，应被忽略
    const ns = path.join(tmp, 'not-a-skill')
    await fs.mkdir(ns, { recursive: true })
    await fs.writeFile(path.join(ns, 'readme.txt'), 'nothing')
  })

  afterAll(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true })
  })

  it('loadSkillFromDir 读取并解析单个技能目录', async () => {
    const s = await loadSkillFromDir(path.join(tmp, 'skill-a'))
    expect(s).not.toBeNull()
    expect(s!.name).toBe('skill-a')
    expect(s!.body).toContain('做 A 的指令')
    expect(s!.entryPath).toBe(path.join(tmp, 'skill-a', 'SKILL.md'))
  })

  it('loadSkillFromDir 对无 SKILL.md 的目录返回 null', async () => {
    const s = await loadSkillFromDir(path.join(tmp, 'not-a-skill'))
    expect(s).toBeNull()
  })

  it('discoverSkills 只收集含 SKILL.md 的子目录', async () => {
    const all = await discoverSkills(tmp)
    expect(all.map((s) => s.name).sort()).toEqual(['skill-a', 'skill-b'])
    const b = all.find((s) => s.name === 'skill-b')
    expect(b!.requiresApproval).toBe(true)
  })

  it('discoverSkills 对不存在或空的根目录返回空数组', async () => {
    expect(await discoverSkills(path.join(tmp, 'does-not-exist'))).toEqual([])
  })
})
