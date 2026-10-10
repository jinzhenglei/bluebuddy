/** 浏览沙箱根的寻址方式：对话页按会话、空间资产页按项目空间 */
export interface BrowseRootTarget {
  sessionId?: string
  projectId?: string
}

export type BrowseRootResult = { ok: true; root: string } | { ok: false; error: string }

/** 只依赖这两个取数方法，便于单测用结构化替身 */
export interface BrowseRootSource {
  getSession(id: string): { workDir: string } | undefined
  getProject(id: string): { workDir: string } | undefined
}

/**
 * 解析文件浏览的安全根目录：sessionId 优先（对话页语义不变），否则取空间的 work_dir。
 *
 * 找不到记录或工作目录为空一律返回错误，调用方不得回退到进程 cwd 或猜测根目录。
 */
export function resolveBrowseRoot(
  db: BrowseRootSource,
  target: BrowseRootTarget
): BrowseRootResult {
  if (target.sessionId) {
    const session = db.getSession(target.sessionId)
    if (!session) return { ok: false, error: `会话不存在：${target.sessionId}` }
    if (!session.workDir) return { ok: false, error: '该会话未设置工作目录，无法浏览' }
    return { ok: true, root: session.workDir }
  }

  if (target.projectId) {
    const project = db.getProject(target.projectId)
    if (!project) return { ok: false, error: `项目空间不存在：${target.projectId}` }
    if (!project.workDir) return { ok: false, error: '该项目空间未设置工作目录，无法浏览' }
    return { ok: true, root: project.workDir }
  }

  return { ok: false, error: '未指定要浏览的会话或项目空间' }
}
