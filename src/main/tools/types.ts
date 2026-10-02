import { z } from 'zod'
import { WorkspaceProvider } from '../workspace/provider'

/**
 * 工具执行时的依赖注入容器。MVP 只包含 workspace；
 * 后续按需扩展（http fetcher、artifactRegister 回调、session 上下文等）。
 * 通过参数注入而不是全局单例，方便测试 mock。
 */
export interface ToolContext {
  workspace: WorkspaceProvider
  /** 供 fetch_url 使用；测试时替换成 mock，生产传 globalThis.fetch */
  fetch: typeof fetch
  /** 当前 turn 的取消信号；run_command 等长时工具应传下去以支持“停止” */
  signal?: AbortSignal
}

/** 工具产出的文件/链接类工件（引擎层用于登记到 artifacts 表） */
export interface ArtifactDraft {
  kind: 'file' | 'link'
  /** 展示名，如 "notes.md" 或 "https://news.ycombinator.com/" */
  name: string
  /** 相对 workspace 的路径，kind='file' 时有效 */
  relPath?: string
  /** kind='link' 时的目标 URL */
  url?: string
}

/** 工具执行结果 */
export interface ToolResult {
  /** 是否执行成功；失败时 content 通常是错误说明，会原样喂回模型 */
  ok: boolean
  /** 回填给模型的消息内容（字符串表示） */
  content: string
  /** UI 展示用的结构化数据，可选 */
  data?: unknown
  /** 若本工具产出文件/链接，写在这里，由引擎登记 */
  artifact?: ArtifactDraft
}

/** 一个工具的定义；泛型 I 是解析后的输入类型 */
export interface Tool<I = unknown> {
  name: string
  description: string
  /** zod schema，既做运行时校验，也生成 OpenAI parameters JSON Schema */
  parameters: z.ZodType<I>
  /**
   * 外部协议工具（MCP）：对方自带 JSON Schema，原样发给 OpenAI；
   * 此时 parameters 只是透传占位（运行时校验交给服务端）。
   */
  parametersJsonSchema?: Record<string, unknown>
  /** 是否需要在执行前经 PermissionGate 批准 */
  requiresApproval: boolean
  /** 供 UI 展示的简短人类描述模板（可选，默认用 name） */
  approvalReason?: (input: I) => string
  execute(input: I, ctx: ToolContext): Promise<ToolResult>
}

/** 传给 OpenAI 的 tools 数组元素 */
export interface OpenAIToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * 把 zod schema 转成 OpenAI 期望的 JSON Schema。
 * zod v4 原生 toJSONSchema 会带 $schema 字段，OpenAI 会忽略但更干净是剥掉。
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>
  delete raw.$schema
  return raw
}
