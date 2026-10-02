import { create } from 'zustand'
import type { ProviderConfig, TestResult } from '@shared/types'

interface SettingsState {
  providers: ProviderConfig[]
  loaded: boolean
  load: () => Promise<void>
  upsert: (provider: ProviderConfig) => Promise<void>
  remove: (id: string) => Promise<void>
  test: (provider: ProviderConfig) => Promise<TestResult>
}

/**
 * 渲染进程侧只持有"掩码后的" ProviderConfig（listMasked 的返回值），
 * 明文 Key 从设计上就不会出现在这个 store 里，UI 再怎么被注入也拿不到。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  providers: [],
  loaded: false,

  load: async () => {
    const providers = await window.api.settings.list()
    set({ providers, loaded: true })
  },

  upsert: async (provider) => {
    const saved = await window.api.settings.upsert(provider)
    set((state) => {
      const exists = state.providers.some((p) => p.id === saved.id)
      return {
        providers: exists
          ? state.providers.map((p) => (p.id === saved.id ? saved : p))
          : [...state.providers, saved]
      }
    })
  },

  remove: async (id) => {
    await window.api.settings.remove(id)
    set((state) => ({ providers: state.providers.filter((p) => p.id !== id) }))
  },

  test: async (provider) => window.api.settings.test(provider)
}))
