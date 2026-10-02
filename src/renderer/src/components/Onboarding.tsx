import { useState } from 'react'
import { useSettingsStore } from '@renderer/stores/settings'
import type { ProviderConfig } from '@shared/types'

/**
 * 首次启动向导（Stage 6）：三步覆盖层，串起“能不能用”的最小闭环。
 * - 步骤 0 欢迎：说明私有化定位（数据仅存本机）；
 * - 步骤 1 选工作目录：设为默认工作空间（可跳过，新任务页仍可再选）；
 * - 步骤 2 引导加模型：复用 settings.upsert 落一个 OpenAI 兼容 Provider 并设为默认。
 * 完成/跳过都会写入 prefs.onboarded=true，App 据此不再弹出。全程仅经类型化 IPC，无特权通道。
 */
type Step = 0 | 1 | 2

const BLANK_PROVIDER: Omit<ProviderConfig, 'id'> = {
  name: '',
  baseUrl: '',
  model: '',
  apiKey: '',
  streaming: true
}

function IconArrowLeft(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFolder(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M3 5.5h5l1.5 2H17v8H3v-10Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StepDots({ step }: { step: Step }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {([0, 1, 2] as Step[]).map((s) => (
        <span
          key={s}
          className={
            'h-1.5 rounded-full transition-all ' +
            (s === step ? 'w-5 bg-brand' : 'w-1.5 bg-black/15')
          }
        />
      ))}
    </div>
  )
}

export function Onboarding({ onDone }: { onDone(): void }): React.JSX.Element {
  const providers = useSettingsStore((s) => s.providers)
  const loadProviders = useSettingsStore((s) => s.load)

  const [step, setStep] = useState<Step>(0)
  const [workDir, setWorkDir] = useState('')
  const [form, setForm] = useState<Omit<ProviderConfig, 'id'>>(BLANK_PROVIDER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const pickWorkDir = async (): Promise<void> => {
    const dir = await window.api.system.pickDirectory()
    if (dir) setWorkDir(dir)
  }

  // 统一收尾：把向导里选定的默认值落库，并标记 onboarded 完成
  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      if (workDir) await window.api.prefs.set({ defaultWorkDir: workDir })
      await window.api.prefs.set({ onboarded: true })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  // 保存并设为默认模型：新建走 upsert，刷新 store 后置为默认 provider
  const saveProvider = async (): Promise<string | null> => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      setError('请至少填写名称、Base URL 与模型名')
      return null
    }
    setError(null)
    setBusy(true)
    try {
      const saved = await window.api.settings.upsert({ id: '', ...form })
      await loadProviders()
      await window.api.prefs.set({ defaultProviderId: saved.id })
      return saved.id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const testProvider = async (): Promise<void> => {
    setTestMsg(null)
    const id = await saveProvider()
    if (!id) return
    const target = useSettingsStore.getState().providers.find((p) => p.id === id)
    if (!target) return
    const r = await window.api.settings.test(target)
    setTestMsg(r.ok ? '连通测试成功 ✓' : `连通失败：${r.message ?? '未知错误'}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* 顶部：步骤指示 + 返回 */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
              B
            </span>
            <span className="text-sm font-semibold text-ink">
              {['欢迎使用 BlueBuddy', '设置工作空间', '接入模型'][step]}
            </span>
          </div>
          {step > 0 ? (
            <button
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-black/5"
              onClick={() => setStep((s) => (s - 1) as Step)}
            >
              <IconArrowLeft /> 上一步
            </button>
          ) : (
            <StepDots step={step} />
          )}
        </div>

        <div className="px-6 py-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-ink">你好，我来帮你 🤖</h2>
              <p className="text-[13px] leading-relaxed text-ink-2">
                BlueBuddy
                是私有化桌面智能体：用自然语言下达任务，我自主规划、调用工具执行并交付成果。
              </p>
              <ul className="space-y-2 text-[13px] text-ink-2">
                <li className="flex gap-2">
                  <span className="text-brand">🔒</span> 所有数据仅保存在本机，不出你的电脑
                </li>
                <li className="flex gap-2">
                  <span className="text-brand">🗂️</span> 文件/命令操作被限制在你授权的工作目录内
                </li>
                <li className="flex gap-2">
                  <span className="text-brand">✅</span> 高危操作（执行命令等）一律需你批准
                </li>
              </ul>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-ink-2">
                选择一个工作目录，Agent 只会在这里读写文件、执行命令。可稍后在新任务页临时更改。
              </p>
              <button
                className="flex w-full items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-left text-sm text-ink-2 transition hover:border-ink-3/60"
                onClick={() => void pickWorkDir()}
              >
                <IconFolder />
                <span className={workDir ? 'truncate text-ink' : ''}>
                  {workDir || '点击选择工作目录…'}
                </span>
              </button>
              <p className="text-xs text-ink-3">提示：建议选一个专门放资料/项目的文件夹。</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed text-ink-2">
                接入一个 OpenAI 兼容的模型服务（云端 API 或本地 Ollama），我才能工作。
              </p>
              {providers.length > 0 && (
                <div className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2">
                  已检测到 {providers.length} 个模型配置
                  {providers.some((p) => p.id) ? '，可直接点「完成」。' : '。'}
                </div>
              )}
              <div className="space-y-2.5">
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink-3/60"
                  placeholder="名称，如：小米 Mimo / 本地 Ollama"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink-3/60"
                  placeholder="Base URL，如 https://xxx/v1 或 http://localhost:11434/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
                <div className="flex gap-2.5">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink-3/60"
                    placeholder="模型名，如 mimo-v2.6 / qwen2.5"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  />
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink-3/60"
                    placeholder="API Key（本地可留空）"
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-black/5 disabled:opacity-50"
                  onClick={() => void testProvider()}
                  disabled={busy}
                >
                  保存并测试连通
                </button>
                {testMsg && <span className="text-xs text-ink-2">{testMsg}</span>}
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          {step > 0 ? (
            <button
              className="text-xs text-ink-3 hover:text-ink-2"
              onClick={() => void finish()}
              disabled={busy}
            >
              跳过这一步
            </button>
          ) : (
            <span />
          )}
          {step === 0 ? (
            <button
              className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90"
              onClick={() => setStep(1)}
            >
              开始设置
            </button>
          ) : step === 1 ? (
            <button
              className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90"
              onClick={() => setStep(2)}
            >
              下一步
            </button>
          ) : (
            <button
              className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              onClick={() => void finish()}
              disabled={busy}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
