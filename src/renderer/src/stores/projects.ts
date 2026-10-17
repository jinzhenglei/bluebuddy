import { create } from 'zustand'
import type {
  AssetFilter,
  ProjectAssetEntry,
  ProjectCreateInput,
  ProjectInfo,
  ProjectPatch
} from '@shared/types'

/** 空间卡片摘要：任务数 / 产出数 / 最近产出时间（来自列表页一次并发拉取） */
export interface ProjectStats {
  tasks: number
  artifacts: number
  latestArtifactAt: number | null
}

/** 统一资产列表的分项计数 */
export interface AssetCounts {
  all: number
  task: number
  other: number
}

type Result = { ok: boolean; project?: ProjectInfo; error?: string }

const EMPTY_ASSETS: ProjectAssetEntry[] = []
const EMPTY_COUNTS: AssetCounts = { all: 0, task: 0, other: 0 }

interface ProjectsState {
  projects: ProjectInfo[]
  /** 详情页选中的空间 id */
  activeId: string | null
  /** 详情页资产列表数据源：任务产物 + 按配置实时扫描到的其他途径文件 */
  assets: ProjectAssetEntry[]
  assetCounts: AssetCounts
  /** 扫描撞到条数上限：列表尾要提示「另有文件未列出」 */
  assetsTruncated: boolean
  /** 工作目录不可访问等原因；此时 assets 仍含任务产物，页面另显错误条 */
  assetsError: string | null
  stats: Record<string, ProjectStats>

  load(): Promise<void>
  select(id: string | null): void
  create(input: ProjectCreateInput): Promise<Result>
  update(id: string, patch: ProjectPatch): Promise<Result>
  remove(id: string): Promise<void>
  loadAssets(projectId: string): Promise<void>
  /** 资产页过滤开关：先本地生效再写库，失败回滚（开关存在空间的 assetConfig 里） */
  setFilter(projectId: string, filter: AssetFilter): Promise<{ ok: boolean; error?: string }>
}

/**
 * 项目空间 store：列表页与详情页共享。
 * 删空间只解除任务归属（主进程 FK 置 NULL），本层不碰任何磁盘文件。
 */
export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  activeId: null,
  assets: EMPTY_ASSETS,
  assetCounts: EMPTY_COUNTS,
  assetsTruncated: false,
  assetsError: null,
  stats: {},

  load: async () => {
    const projects = await window.api.projects.list()
    // 卡片要显示任务数与最近产出时间：会话列表 + 每个空间的产物列表一次并发取
    const [sessions, ...artifactLists] = await Promise.all([
      window.api.sessions.list(),
      ...projects.map((p) => window.api.projects.artifacts(p.id))
    ])
    const stats: Record<string, ProjectStats> = {}
    projects.forEach((p, i) => {
      const list = artifactLists[i]
      stats[p.id] = {
        tasks: sessions.filter((s) => s.projectId === p.id).length,
        artifacts: list.length,
        // 主进程按 created_at DESC 返回，首条即最近产出
        latestArtifactAt: list.length ? list[0].createdAt : null
      }
    })
    const cur = get().activeId
    set({
      projects,
      stats,
      activeId: cur && projects.some((p) => p.id === cur) ? cur : null
    })
  },

  select: (id) => set({ activeId: id }),

  create: async (input) => {
    const res = await window.api.projects.create(input)
    if (res.ok) await get().load()
    return res
  },

  update: async (id, patch) => {
    const res = await window.api.projects.update(id, patch)
    if (res.ok && res.project) {
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? res.project! : p)) }))
    }
    return res
  },

  remove: async (id) => {
    await window.api.projects.remove(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      assets: s.activeId === id ? EMPTY_ASSETS : s.assets,
      assetCounts: s.activeId === id ? EMPTY_COUNTS : s.assetCounts,
      assetsTruncated: s.activeId === id ? false : s.assetsTruncated,
      assetsError: s.activeId === id ? null : s.assetsError
    }))
    await get().load()
  },

  loadAssets: async (projectId) => {
    const res = await window.api.projects.assets(projectId)
    set({
      assets: res.assets,
      assetCounts: res.counts,
      assetsTruncated: res.truncated,
      assetsError: res.error ?? null
    })
  },

  setFilter: async (projectId, filter) => {
    const before = get().projects
    const project = before.find((p) => p.id === projectId)
    if (!project) return { ok: false, error: '项目空间不存在' }
    // 本地这份合并只负责让开关立刻挪过去；写库带上 filter 一个字段就行，
    // 合并由主进程对着库行做，展开本地缓存会把已存的其他字段顶回去
    const local = { ...(project.assetConfig ?? {}), filter }
    set({ projects: before.map((p) => (p.id === projectId ? { ...p, assetConfig: local } : p)) })
    const res = await window.api.projects.update(projectId, { assetConfig: { filter } })
    if (!res.ok) {
      set({ projects: before })
      return { ok: false, error: res.error ?? '保存过滤状态失败' }
    }
    // 用库内返回值覆盖：把「等于默认就不存」这类瘦身结果同步回本地
    if (res.project) {
      set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? res.project! : p)) }))
    }
    return { ok: true }
  }
}))
