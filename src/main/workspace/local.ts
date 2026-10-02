import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import {
  DirEntry,
  ExecOptions,
  ExecResult,
  PathTraversalError,
  WorkspaceProvider
} from './provider'

/** abs 是否落在 base 目录内（等于 base 本身或以 base + 分隔符为前缀）；防兄弟目录同名前缀混淆 */
function isInside(abs: string, base: string): boolean {
  if (abs === base) return true
  const withSep = base.endsWith(path.sep) ? base : base + path.sep
  return abs.startsWith(withSep)
}

/**
 * LocalWorkspace —— WorkspaceProvider 的本地实现
 *
 * 安全策略：
 * 1. 所有相对路径先 path.resolve 展开
 * 2. 写入（writeFile）严格锁在 root 内：展开后必须以 root + path.sep 开头（或等于 root），否则抛 PathTraversalError
 * 3. 读取（readFile/listDir）额外允许落在 readRoots 可信根内（典型为技能安装目录，
 *    让 Agent 能读/跑技能自带的 scripts 与资源文件）；越出 root 与全部 readRoots 才拒绝
 * 4. exec 用 spawn(command, args, { cwd: root })，绝不拼接命令字符串
 */
export class LocalWorkspace implements WorkspaceProvider {
  readonly root: string
  /** 只读可信根（绝对路径）：仅 readFile/listDir 允许落入，写入仍锁在 root */
  private readonly readRoots: string[]

  constructor(root: string, opts?: { readRoots?: string[] }) {
    // 规范化 root，去掉末尾分隔符
    this.root = path.resolve(root)
    this.readRoots = (opts?.readRoots ?? []).map((r) => path.resolve(r))
  }

  resolve(relPath: string): string {
    const abs = this.toAbs(relPath)
    if (!isInside(abs, this.root)) {
      throw new PathTraversalError(relPath, this.root)
    }
    return abs
  }

  /** 读取专用解析：允许落在 root 或任一 readRoot 内；越出全部可信根才抛错 */
  private resolveForRead(relPath: string): string {
    const abs = this.toAbs(relPath)
    if (isInside(abs, this.root) || this.readRoots.some((r) => isInside(abs, r))) {
      return abs
    }
    throw new PathTraversalError(relPath, this.root)
  }

  private toAbs(relPath: string): string {
    return path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(this.root, relPath)
  }

  async readFile(relPath: string): Promise<string> {
    const abs = this.resolveForRead(relPath)
    return fs.readFile(abs, 'utf-8')
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const abs = this.resolveForRead(relPath)
    const dirents = await fs.readdir(abs, { withFileTypes: true })
    return Promise.all(
      dirents.map(async (d) => {
        const full = path.join(abs, d.name)
        let size = 0
        try {
          const stat = await fs.stat(full)
          size = stat.size
        } catch {
          /* 断链或权限问题按 0 处理 */
        }
        return { name: d.name, isDir: d.isDirectory(), size }
      })
    )
  }

  async exec(command: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const { timeoutMs = 60_000, signal } = opts
    return new Promise((resolvePromise) => {
      const child = spawn(command, args, { cwd: this.root, shell: false })
      let stdout = ''
      let stderr = ''
      let settled = false
      const cleanups: Array<() => void> = []

      const finish = (code: number): void => {
        if (settled) return
        settled = true
        for (const c of cleanups) c()
        resolvePromise({ stdout, stderr, exitCode: code })
      }
      // 强杀：先标记 stderr 原因，再 SIGKILL，并 finish(-1)
      const kill = (reason: string): void => {
        if (settled) return
        if (!stderr) stderr = reason
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已退出的进程 kill 会抛，忽略 */
        }
        finish(-1)
      }

      // 立即关闭 stdin：防止交互式命令（如 Windows `date`）死等输入而永久挂起
      try {
        child.stdin?.end()
      } catch {
        /* 某些平台 stdin 可能为 null，忽略 */
      }
      child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))

      if (timeoutMs > 0) {
        const timer = setTimeout(() => kill(`command timed out after ${timeoutMs}ms`), timeoutMs)
        cleanups.push(() => clearTimeout(timer))
      }
      if (signal) {
        const onAbort = (): void => kill('command aborted by user')
        signal.addEventListener('abort', onAbort, { once: true })
        cleanups.push(() => signal.removeEventListener('abort', onAbort))
        if (signal.aborted) onAbort()
      }

      child.on('close', (code) => finish(code ?? -1))
      child.on('error', (err) => {
        if (!stderr) stderr = err.message
        finish(-1)
      })
    })
  }
}
