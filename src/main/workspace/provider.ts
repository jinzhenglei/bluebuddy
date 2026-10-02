/**
 * WorkspaceProvider —— 文件 / 终端操作的抽象层
 *
 * 工具代码只依赖此接口，不直接调用 node:fs / child_process。
 * MVP 提供 LocalWorkspace 实现；二期新增 RemoteWorkspace 即可无缝切换。
 *
 * 安全不变量：所有相对路径最终必须落在 workDir 之下，
 * 通过 path.resolve 展开后做前缀校验，防止 ../../ 等路径穿越。
 */

export interface DirEntry {
  name: string
  isDir: boolean
  size: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOptions {
  /** 超时毫秒数，到时强杀子进程并以 exitCode=-1 返回；<=0 表示不限时。默认 60s */
  timeoutMs?: number
  /** 取消信号：abort 时立即杀掉子进程，让「停止」按钮对运行中的命令生效 */
  signal?: AbortSignal
}

export interface WorkspaceProvider {
  /** 工作根目录（绝对路径），所有相对路径以此为基准 */
  readonly root: string

  /** 把相对路径安全解析为绝对路径；越界时抛 PathTraversalError */
  resolve(relPath: string): string

  /** 读取文本文件（UTF-8） */
  readFile(relPath: string): Promise<string>

  /** 写入文本文件（UTF-8），自动创建中间目录 */
  writeFile(relPath: string, content: string): Promise<void>

  /** 列出目录内容 */
  listDir(relPath: string): Promise<DirEntry[]>

  /** 执行命令（命令 + 参数数组），返回 stdout/stderr/exitCode；带超时与取消防挂死 */
  exec(command: string, args: string[], opts?: ExecOptions): Promise<ExecResult>
}

/** 路径越界时抛出的专用错误，便于上层区分处理 */
export class PathTraversalError extends Error {
  constructor(requested: string, root: string) {
    super(`Path traversal blocked: "${requested}" resolves outside "${root}"`)
    this.name = 'PathTraversalError'
  }
}
