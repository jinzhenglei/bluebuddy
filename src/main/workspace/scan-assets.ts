import fs from 'node:fs'
import path from 'node:path'
import { ASSET_SCAN_MAX_DEPTH, ASSET_SCAN_MAX_FILES, matchesAssetFile } from '@shared/asset-config'
import type { ResolvedAssetConfig } from '@shared/asset-config'

/**
 * 扫描工作目录里「其他途径产生的产物」（手工放进去的、外部拷来的）。
 *
 * 刻意不入库：磁盘才是这类文件的真源，扫出来的东西永远与目录一致，
 * 也就不用处理"文件被删了库里还留着"的假产物。配置改了立刻生效。
 *
 * 保护三条：忽略目录整棵剪枝、递归深度上限、文件条数上限。
 * 单个子目录读不了（没权限/被占用）只跳过它，不让整次扫描失败。
 */

export interface ScannedAsset {
  absPath: string
  /** 相对扫描根，一律正斜杠（跨平台展示与去重都用它） */
  relPath: string
  name: string
  size: number
  mtime: number
}

export interface ScanAssetsResult {
  files: ScannedAsset[]
  /** 命中条数上限，说明还有文件没列出来 */
  truncated: boolean
  /** 根目录本身不可访问时给出；此时 files 为空，调用方可以照常显示任务产物 */
  error?: string
}

export function scanWorkspaceAssets(
  root: string,
  cfg: ResolvedAssetConfig,
  opts?: { maxDepth?: number; maxFiles?: number }
): ScanAssetsResult {
  const maxDepth = opts?.maxDepth ?? ASSET_SCAN_MAX_DEPTH
  const maxFiles = opts?.maxFiles ?? ASSET_SCAN_MAX_FILES
  const base = path.resolve(root ?? '')

  try {
    if (!fs.statSync(base).isDirectory()) {
      return { files: [], truncated: false, error: '工作目录不是目录' }
    }
  } catch (e) {
    return { files: [], truncated: false, error: `工作目录不可访问：${(e as Error).message}` }
  }

  const ignore = new Set(cfg.ignoreDirs)
  const files: ScannedAsset[] = []
  let truncated = false

  const walk = (dir: string, rel: string, depth: number): void => {
    if (files.length >= maxFiles) {
      truncated = true
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= maxFiles) {
        truncated = true
        return
      }
      // 符号链接一律跳过：目录软链成环会让遍历停不下来
      if (e.isSymbolicLink()) continue
      const abs = path.join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (ignore.has(e.name.toLowerCase())) continue
        if (depth < maxDepth) walk(abs, relPath, depth + 1)
        continue
      }
      if (!e.isFile() || !matchesAssetFile(relPath, cfg)) continue
      try {
        const st = fs.statSync(abs)
        files.push({ absPath: abs, relPath, name: e.name, size: st.size, mtime: st.mtimeMs })
      } catch {
        // 读不到元信息就跳过这个文件，不值得让整次扫描失败
      }
    }
  }

  walk(base, '', 1)
  return { files, truncated }
}
