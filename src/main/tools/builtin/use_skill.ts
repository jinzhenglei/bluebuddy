import { z } from 'zod'
import type { SkillRegistry } from '../../skills/registry'
import type { Tool, ToolResult } from '../types'

/**
 * use_skill 元工具：渐进式披露的"第二级"。
 *
 * 系统提示词里只常驻技能的名字+简介（一级索引，见 SkillRegistry.indexForPrompt）；
 * 当模型判断某技能与任务相关时，调用本工具把该技能 SKILL.md 的完整正文取回去，
 * 再照正文指令行动。这样不必把所有技能正文塞进每轮上下文。
 *
 * 用工厂闭包持有 SkillRegistry，而不是往通用 ToolContext 里塞技能依赖——
 * 保持 ToolContext 精简，也让本工具可被纯逻辑单测。加载指令无副作用，requiresApproval=false。
 */
export function createUseSkillTool(registry: SkillRegistry): Tool<{ name: string }> {
  return {
    name: 'use_skill',
    description:
      '加载指定技能的完整指令。当"可用技能"清单里某个技能与当前任务相关时，先调用本工具取得详细步骤，然后严格依照返回的指令执行。',
    parameters: z.object({
      name: z.string().describe('技能名称，取自系统提示词中的可用技能清单')
    }),
    requiresApproval: false,
    async execute({ name }): Promise<ToolResult> {
      const skill = registry.get(name)
      if (!skill) {
        return {
          ok: false,
          content: `未找到技能「${name}」。请从系统提示词的可用技能清单中选择一个有效的名称。`
        }
      }
      return {
        ok: true,
        content:
          `# 技能：${skill.name}\n` +
          `（技能目录：${skill.dir}。该目录及其 scripts/ 属可信只读区：可用 read_file / list_dir 传该目录下的绝对路径直接读取；` +
          `自带脚本用 run_command 执行，command 填解释器（如 python / node），args 传脚本的绝对路径。无需先确认脚本是否存在。\n\n` +
          skill.body.trim()
      }
    }
  }
}
