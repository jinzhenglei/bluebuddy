import { create } from 'zustand'
import type { SkillInfo } from '@shared/types'

/**
 * 全局技能列表 store：供工具卡片等把 use_skill 的规范名映射成中文展示名。
 * 壳层挂载时 load 一次；技能安装 / 变更后 Skills 页可再调 load 刷新。
 */
interface SkillsState {
  skills: SkillInfo[]
  load: () => Promise<void>
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  load: async () => {
    const skills = await window.api.skills.list()
    set({ skills })
  }
}))
