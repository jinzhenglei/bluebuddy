import type { LoadedSkill } from './types'

/**
 * 技能注册表：持有当前"已启用"的技能集合，并生成给系统提示词的轻量索引。
 *
 * 关键设计（渐进式披露一级）：indexForPrompt() 只输出每个技能的 name + description，
 * 绝不包含正文——正文要等模型调用 use_skill(name) 才由工具层返回。这样常驻提示词的
 * token 成本与技能数量线性、但与正文长度无关。
 *
 * Map 保持插入顺序，索引稳定，便于对话可复现。
 */
export class SkillRegistry {
  private skills = new Map<string, LoadedSkill>()

  constructor(skills: LoadedSkill[] = []) {
    this.setAll(skills)
  }

  get size(): number {
    return this.skills.size
  }

  add(skill: LoadedSkill): void {
    this.skills.set(skill.name, skill)
  }

  remove(name: string): void {
    this.skills.delete(name)
  }

  setAll(skills: LoadedSkill[]): void {
    this.skills.clear()
    for (const s of skills) this.skills.set(s.name, s)
  }

  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name)
  }

  list(): LoadedSkill[] {
    return [...this.skills.values()]
  }

  /** 生成注入系统提示词的技能轻量索引；无技能时返回空串（上层据此决定是否拼接） */
  indexForPrompt(): string {
    if (this.skills.size === 0) return ''
    const lines = [...this.skills.values()].map((s) => `- ${s.name}: ${s.description}`)
    return [
      '## 可用技能（Skills）',
      '以下是你可以使用的技能清单。当某个技能与当前任务相关时，',
      '先调用 use_skill(name) 获取该技能的完整指令，再严格依照指令执行。',
      ...lines
    ].join('\n')
  }
}
