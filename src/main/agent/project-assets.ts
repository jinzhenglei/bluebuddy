import path from 'node:path'
import { normalizeAssetKey } from '@shared/asset-config'
import type { ResolvedAssetConfig } from '@shared/asset-config'
import type { ProjectAssetEntry, ProjectAssetsResult } from '@shared/types'
import { scanWorkspaceAssets } from '../workspace/scan-assets'

/**
 * 把「任务生成的产物」与「其他途径产生的文件」合成一份统一列表。
 *
 * 资产页与上下文注入都用它，两类同地位、按时间倒序混排。
 * 关键是去重：任务写出来的文件本身就躺在工作目录里，扫描必然再次命中它，
 * 不按绝对路径归一去重就会同一文件出两行、来源还互相矛盾。
 */

/** 只依赖这一个取数方法，单测用结构化替身即可 */
interface TaskArtifactLike {
  id: string
  name: string
  relPath?: string | null
  createdAt: number
  sessionTitle: string
}

export interface ProjectAssetSource {
  listArtifactsByProject(projectId: string): TaskArtifactLike[]
}

export interface ProjectAssetProject {
  id: string
  workDir: string
}

export function collectProjectAssets(
  db: ProjectAssetSource,
  project: ProjectAssetProject,
  cfg: ResolvedAssetConfig
): ProjectAssetsResult {
  const taskAssets: ProjectAssetEntry[] = db.listArtifactsByProject(project.id).map((a) => {
    const relPath = (a.relPath ?? '').replace(/\\/g, '/')
    return {
      key: `task:${a.id}`,
      source: 'task' as const,
      name: a.name,
      relPath,
      // 与 ipc.ts 既有口径一致：任务产物相对路径以空间工作目录为基解析
      absPath: path.resolve(project.workDir, relPath),
      time: a.createdAt,
      sessionTitle: a.sessionTitle
    }
  })

  const scanned = scanWorkspaceAssets(project.workDir, cfg)
  const taken = new Set(taskAssets.map((a) => normalizeAssetKey(a.absPath)))
  const otherAssets: ProjectAssetEntry[] = scanned.files
    .filter((f) => !taken.has(normalizeAssetKey(f.absPath)))
    .map((f) => ({
      key: `other:${f.relPath}`,
      source: 'other' as const,
      name: f.name,
      relPath: f.relPath,
      absPath: f.absPath,
      time: f.mtime,
      size: f.size
    }))

  const assets = [...taskAssets, ...otherAssets].sort((a, b) => b.time - a.time)
  return {
    ok: !scanned.error,
    assets,
    counts: { all: assets.length, task: taskAssets.length, other: otherAssets.length },
    truncated: scanned.truncated,
    ...(scanned.error ? { error: scanned.error } : {})
  }
}
