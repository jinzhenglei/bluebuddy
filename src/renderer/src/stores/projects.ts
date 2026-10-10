import { create } from 'zustand'
import type { ArtifactInfo, ProjectCreateInput, ProjectInfo, ProjectPatch } from '@shared/types'

/** 空间卡片摘要：任务数 / 产出数 / 最近产出时间（来自列表页一次并发拉取） */
export interface ProjectStats {
  tasks: number
  artifacts: number
  latestArtifactAt: number | null
}

type Result = { ok: boolean; project?: ProjectInfo; error?: string }

interface ProjectsState {
  projects: ProjectInfo[]
  /** 详情页选中的空间 id */
  activeId: string | null
  /** 详情页资产表数据源（当前空间的跨任务产物） */
  artifacts: ArtifactInfo[]
  stats: Record<string, ProjectStats>

  load(): Promise<void>
  select(id: string | null): void
  create(input: ProjectCreateInput): Promise<Result>
  update(id: string, patch: ProjectPatch): Promise<Result>
  remove(id: string): Promise<void>
  loadArtifacts(projectId: string): Promise<void>
}

/**
 * 项目空间 store：列表页与详情页共享。
 * 删空间只解除任务归属（主进程 FK 置 NULL），本层不碰任何磁盘文件。
 */
export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  activeId: null,
  artifacts: [],
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
      artifacts: s.activeId === id ? [] : s.artifacts
    }))
    await get().load()
  },

  loadArtifacts: async (projectId) => {
    set({ artifacts: await window.api.projects.artifacts(projectId) })
  }
}))
