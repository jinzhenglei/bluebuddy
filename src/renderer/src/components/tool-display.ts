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
