import { ZodType } from 'zod'
import { ZodError } from 'zod'
import { ToolCall } from '@shared/types'
import { OpenAIToolSpec, Tool, ToolContext, ToolResult, toJsonSchema } from './types'

/**
 * 内部存储的兵底型态：泛型擦除后的工具形式。
 * execute 接受 unknown（运行时由 zod 保证 shape），避免协变/逆变报错。
 */
type AnyTool = {
  name: string
  description: string
  parameters: ZodType
  parametersJsonSchema?: Record<string, unknown>
  requiresApproval: boolean
  approvalReason?: (input: unknown) => string
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

/**
 * ToolRegistry：按 name 索引工具，产出 OpenAI tools 数组，
 * 并把一次 ToolCall 安全地转换为一次执行（JSON.parse + zod 校验 + execute）。
 *
 * 错误约定：任何失败都返回 ok=false 的 ToolResult，不抛异常。
 * 这样上层 Agent 循环可以把错误内容原样喂回模型，让模型自行调整下一步。
 */
export class ToolRegistry {
  private tools = new Map<string, AnyTool>()

  register<T>(tool: Tool<T>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`)
    }
    this.tools.set(tool.name, tool as unknown as AnyTool)
  }

  /** 反注册（技能全部停用时下架 use_skill）；不存在返回 false */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name)
  }

  list(): AnyTool[] {
    return [...this.tools.values()]
  }

  /** 生成发送给 OpenAI 的 tools 数组；MCP 等外部工具自带 JSON Schema 优先 */
  toOpenAiSpecs(): OpenAIToolSpec[] {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersJsonSchema ?? toJsonSchema(t.parameters)
      }
    }))
  }

  /**
   * 执行一次工具调用。步骤：
   * 1. 按 name 查表 → 未注册直接返回错误
   * 2. JSON.parse(arguments) → 语法错误返回错误
   * 3. zod 校验 → 校验失败返回结构化错误（附 issues 摘要）
   * 4. execute → 抛异常时捕获为 ok=false
   *
   * 全流程永不 throw，返回一个 ToolResult 供 Agent 循环消费。
   */
  async call(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.function.name)
    if (!tool) {
      return {
        ok: false,
        content: `Unknown tool: ${call.function.name}`
      }
    }
    let raw: unknown
    try {
      raw = call.function.arguments.length === 0 ? {} : JSON.parse(call.function.arguments)
    } catch (e) {
      return {
        ok: false,
        content: `Invalid JSON in tool arguments: ${(e as Error).message}`
      }
    }
    const parsed = tool.parameters.safeParse(raw)
    if (!parsed.success) {
      const issues = (parsed.error as ZodError).issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      return {
        ok: false,
        content: `Argument validation failed: ${issues}`
      }
    }
    try {
      return await tool.execute(parsed.data, ctx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        content: `Tool execution failed: ${msg}`
      }
    }
  }
}
