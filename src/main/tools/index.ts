import { ToolRegistry } from './registry'
import { readFileTool, writeFileTool, listDirTool } from './builtin/filesystem'
import { runCommandTool } from './builtin/terminal'
import { fetchUrlTool } from './builtin/web'

/**
 * 内置工具全集。阶段 4 会加上 MCP 工具与技能，同样通过 registry.register 汇入。
 */
export function createDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry()
  r.register(readFileTool)
  r.register(writeFileTool)
  r.register(listDirTool)
  r.register(runCommandTool)
  r.register(fetchUrlTool)
  return r
}

export { ToolRegistry } from './registry'
export * from './types'
