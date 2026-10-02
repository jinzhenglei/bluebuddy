import { z } from 'zod'
import { Tool } from '../types'

/**
 * 文件系统工具三件套：全部走 WorkspaceProvider，工具本身不感知 fs 模块。
 * 这样二期换成 RemoteWorkspace 时，本文件不用改。
 */

export const readFileTool: Tool<{ path: string }> = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file inside the current workspace. Path is relative to the workspace root.',
  parameters: z.object({
    path: z.string().min(1).describe('Relative path inside workspace, e.g. "notes/todo.md"')
  }),
  requiresApproval: false,
  async execute(input, ctx) {
    const text = await ctx.workspace.readFile(input.path)
    return { ok: true, content: text, data: { path: input.path, size: text.length } }
  }
}

export const writeFileTool: Tool<{ path: string; content: string }> = {
  name: 'write_file',
  description:
    'Write (or overwrite) a UTF-8 text file inside the current workspace. Parent directories are created automatically. The written file is registered as an artifact.',
  parameters: z.object({
    path: z.string().min(1).describe('Relative path inside workspace'),
    content: z.string().describe('Full file content (UTF-8)')
  }),
  requiresApproval: false,
  async execute(input, ctx) {
    await ctx.workspace.writeFile(input.path, input.content)
    return {
      ok: true,
      content: `Written ${input.path} (${input.content.length} bytes)`,
      data: { path: input.path, size: input.content.length },
      artifact: {
        kind: 'file',
        name: input.path.split(/[\\/]/).pop() || input.path,
        relPath: input.path
      }
    }
  }
}

export const listDirTool: Tool<{ path?: string }> = {
  name: 'list_dir',
  description: 'List entries (files and subdirectories) of a directory inside the workspace.',
  parameters: z.object({
    path: z
      .string()
      .optional()
      .default('.')
      .describe('Relative directory path, defaults to workspace root')
  }),
  requiresApproval: false,
  async execute(input, ctx) {
    const entries = await ctx.workspace.listDir(input.path ?? '.')
    const lines = entries.map(
      (e) => `${e.isDir ? 'd' : '-'}  ${String(e.size).padStart(10)}  ${e.name}`
    )
    const header = `${entries.length} entries under "${input.path ?? '.'}"\n`
    return {
      ok: true,
      content: header + lines.join('\n'),
      data: { path: input.path ?? '.', entries }
    }
  }
}
