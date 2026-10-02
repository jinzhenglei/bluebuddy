import fs from 'node:fs'
import path from 'node:path'
import type { DirEntry, FilePreview } from '@shared/types'

/**
 * 工作区只读浏览（右侧结果区「文件」Tab 的后端）。
 * 安全模型：一切路径先 resolve 到会话 workDir 沙箱内，越界直接抛错；
 * 只读操作（readdir/stat/read），不暴露任何写能力给渲染进程。
 */

/** 列表时跳过的目录：体积大且对人不看（.git/node_modules），避免卡 UI */
const EXCLUDED_DIRS = new Set(['.git', 'node_modules'])
/** 单层目录最多返回的条目数，防巨型目录把渲染进程撑爆 */
const MAX_ENTRIES = 500
/** 预览读取上限：256KB，超出截断并标记 truncated */
export const MAX_PREVIEW_BYTES = 256 * 1024

/** 把 relPath 解析到 workDir 沙箱内；越界（含 .. 与绝对路径逃逸）抛错 */
function resolveInside(workDir: string, relPath: string): string {
  const root = path.resolve(workDir)
  const target = path.resolve(root, relPath.replace(/\\/g, '/').trim() || '.')
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('路径超出工作区范围')
  }
  return target
}

/** 相对路径统一用 / 拼接（跨平台展示一致）；容忍尾部斜杠与反斜杠 */
function joinRel(relPath: string, name: string): string {
  const base = relPath.replace(/\\/g, '/').trim().replace(/\/+$/, '')
  return base ? `${base}/${name}` : name
}

/** 列目录：目录在前、同名按 locale 序；排除 .git/node_modules；单层封顶 MAX_ENTRIES */
export function listDir(workDir: string, relPath: string): DirEntry[] {
  const target = resolveInside(workDir, relPath)
  const raw = fs.readdirSync(target, { withFileTypes: true })
  const out: DirEntry[] = []
  for (const e of raw) {
    if (e.isDirectory() && EXCLUDED_DIRS.has(e.name)) continue
    const abs = path.join(target, e.name)
    const isDir = e.isDirectory()
    out.push({
      name: e.name,
      relPath: joinRel(relPath, e.name),
      isDir,
      size: isDir ? 0 : fs.statSync(abs).size
    })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return out.slice(0, MAX_ENTRIES)
}

/**
 * 读文件预览：文本返回 content（超 MAX_PREVIEW_BYTES 截断）；
 * 含 \0 视为二进制只回标记；目录/不存在等错误回 ok:false。
 */
export function readFilePreview(workDir: string, relPath: string): FilePreview {
  const target = resolveInside(workDir, relPath)
  const st = fs.statSync(target)
  if (st.isDirectory()) return { ok: false, error: '是目录，不是文件' }
  const want = Math.min(st.size, MAX_PREVIEW_BYTES)
  const buf = Buffer.alloc(want)
  const fd = fs.openSync(target, 'r')
  try {
    fs.readSync(fd, buf, 0, want, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (buf.includes(0)) return { ok: true, binary: true, size: st.size }
  return {
    ok: true,
    content: buf.toString('utf-8'),
    size: st.size,
    truncated: st.size > MAX_PREVIEW_BYTES
  }
}
