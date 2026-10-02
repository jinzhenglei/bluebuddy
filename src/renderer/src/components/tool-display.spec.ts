import { describe, expect, it } from 'vitest'
import { parseUseSkillName, skillDisplayName } from './tool-display'

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
