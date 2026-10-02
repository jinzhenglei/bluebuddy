import { z } from 'zod'
import { Tool } from '../types'

/**
 * 容错归一化 args：模型经常不遵守「参数向量」约定，把 args 写成字符串
 * （如 "-la"，或字面量 "[/t]"）。若直接交给 z.array，safeParse 会失败→命令永远
 * 跑不起来→ Agent 反复拿同一参数重试看似「卡住」。这里在校验前把常见错误形态
 * 归一成真正的字符串数组。
 */
export function normalizeArgs(v: unknown): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    // 形如 '["a","b"]' 或 '[/t]' 的方括号串
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((x) => String(x))
      } catch {
        /* 非法 JSON，退化到去括号按空白切分 */
      }
      const inner = s.slice(1, -1).trim()
      if (!inner) return []
      return inner
        .split(/\s+/)
        .map((t) => t.replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
    // 普通字符串按空白切分成参数向量（对齐 shell 的自然分词）
    return s.split(/\s+/)
  }
  return [String(v)]
}

/**
 * run_command：高危工具，每次执行前必须经 PermissionGate 批准。
 *
 * 关键：command 与 args 分离（对齐 spawn 语义），避免任何字符串拼接带来的
 * shell 注入风险。模型若习惯给 "ls -la" 这种一整串，normalizeArgs 会兜底拆分。
 */
export const runCommandTool: Tool<{ command: string; args?: string[] }> = {
  name: 'run_command',
  description:
    'Execute a program in the workspace directory. Provide the program name and its arguments as a list; do NOT include a shell wrapper. Example: command="git", args=["status","--short"].',
  parameters: z.object({
    command: z.string().min(1).describe('Program name or absolute path (e.g. "git", "node")'),
    args: z
      .preprocess(normalizeArgs, z.array(z.string()))
      .default([])
      .describe('Argument vector passed verbatim to the program')
  }),
  requiresApproval: true,
  approvalReason: (input) => {
    // 注意：approvalReason 收到的是 zod 校验前的"原始"解析结果，模型可能把 args
    // 误写成字符串（如 "-la"）甚至别的类型，这里必须容错，否则 .join 会抛异常把整个 turn 打断。
    const a = normalizeArgs((input as { args?: unknown }).args)
    const cmd = (input as { command?: unknown }).command
    return `Run command: ${cmd == null ? '' : String(cmd)} ${a.join(' ')}`.trim()
  },
  async execute(input, ctx) {
    // 传下取消信号：用户点「停止」或 turn 被中止时，正在跑的命令会被杀掉，不再挂死
    const result = await ctx.workspace.exec(input.command, input.args ?? [], {
      signal: ctx.signal
    })
    const parts: string[] = []
    parts.push(`exit: ${result.exitCode}`)
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`)
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`)
    return {
      ok: result.exitCode === 0,
      content: parts.join('\n\n'),
      data: result
    }
  }
}
