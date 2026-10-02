/**
 * 技能（Skill）运行时相关类型。
 * 技能 = 一个目录里的 SKILL.md（frontmatter 元数据 + 指令正文）+ 可选脚本/资源。
 * 这里只做纯数据结构与解析，不涉及 Electron、不涉及数据库，便于单测。
 */

/** SKILL.md frontmatter 解析出来的元数据 */
export interface SkillMeta {
  /** 技能唯一名，模型用它来 use_skill(name) */
  name: string
  /** 何时使用该技能的简短描述——这是"渐进式披露一级"里唯一进系统提示词的内容 */
  description: string
  /** 可选：该技能期望使用的工具白名单（预留，Stage 3 暂不强制） */
  allowedTools?: string[]
  /** 可选：技能触发的高危步骤是否需要批准（实际批准由工具层 requiresApproval 决定，这里仅提示） */
  requiresApproval?: boolean
}

/** 一个从磁盘加载完成的技能 */
export interface LoadedSkill extends SkillMeta {
  /** 技能目录绝对路径 */
  dir: string
  /** SKILL.md 绝对路径 */
  entryPath: string
  /** frontmatter 之后的指令正文（"渐进式披露二级"命中后才返回给模型的内容） */
  body: string
}
