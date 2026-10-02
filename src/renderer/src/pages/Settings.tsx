import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@renderer/stores/settings'
import type { AppInfo, AppPrefs, IdeAppView, ProviderConfig, TestResult } from '@shared/types'

/**
 * 设置页（WorkBuddy 式分组）：
 * - 模型服务：Provider 增删改 + 测试连通 + 指定默认模型；
 * - 通用：默认工作目录、外观（深色未实现，占位）；
 * - 权限与安全：工具批准策略（每次询问 / 自动允许全部）、魔搭 Token 状态、本地数据目录、清空全部数据；
 * - 关于：版本与检查更新（更新服务二期接入）。
 * 偏好经 window.api.prefs 读写主进程 settings_kv，主进程为真相源。
 */

const EMPTY_PROVIDER: ProviderConfig = {
  id: '',
  name: '',
  baseUrl: '',
  model: '',
  apiKey: '',
  streaming: true
}

const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand'

function ProviderForm({
  initial,
  onSubmit,
  onCancel
}: {
  initial: ProviderConfig
  onSubmit: (p: ProviderConfig) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<ProviderConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const field = (key: keyof ProviderConfig, value: string | boolean): void =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-ink-2">名称</span>
          <input
            className="w-full rounded border border-line bg-white px-2 py-1 text-ink outline-none focus:border-brand"
            value={draft.name}
            onChange={(e) => field('name', e.target.value)}
            placeholder="例如：小米 Mimo"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-ink-2">模型</span>
          <input
            className="w-full rounded border border-line bg-white px-2 py-1 text-ink outline-none focus:border-brand"
            value={draft.model}
            onChange={(e) => field('model', e.target.value)}
            placeholder="例如：mimo-v2.6-flash"
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-ink-2">Base URL（OpenAI 兼容端点，不含 /chat/completions）</span>
        <input
          className="w-full rounded border border-line bg-white px-2 py-1 text-ink outline-none focus:border-brand"
          value={draft.baseUrl}
          onChange={(e) => field('baseUrl', e.target.value)}
          placeholder="https://api.xiaomimimo.com/v1"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-ink-2">API Key（保存后只显示掩码，重新输入才会覆盖）</span>
        <input
          type="password"
          className="w-full rounded border border-line bg-white px-2 py-1 text-ink outline-none focus:border-brand"
          value={draft.apiKey}
          onChange={(e) => field('apiKey', e.target.value)}
          placeholder="sk-..."
        />
      </label>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={draft.streaming}
            onChange={(e) => field('streaming', e.target.checked)}
          />
          流式输出
        </label>

        <div className="ml-auto flex items-center gap-2">
          {testResult && (
            <span className={testResult.ok ? 'text-sm text-green-600' : 'text-sm text-red-500'}>
              {testResult.message}
            </span>
          )}
          <button
            type="button"
            disabled={testing || !draft.baseUrl || !draft.model}
            className="rounded border border-line bg-white px-3 py-1 text-sm text-ink-2 hover:bg-canvas disabled:opacity-40"
            onClick={async () => {
              setTesting(true)
              setTestResult(await useSettingsStore.getState().test(draft))
              setTesting(false)
            }}
          >
            {testing ? '测试中…' : '测试连通'}
          </button>
          <button
            type="button"
            disabled={saving || !draft.name || !draft.baseUrl || !draft.model}
            className="rounded bg-ink px-3 py-1 text-sm text-white hover:bg-black disabled:opacity-40"
            onClick={async () => {
              setSaving(true)
              await onSubmit(draft)
              setSaving(false)
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-ink-3 hover:bg-canvas"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/** 设置分区卡片 */
function Section({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {desc && <p className="mt-0.5 text-xs text-ink-3">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 左标签右控件的一行 */
function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-black/5 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 外部应用（IDE）区：展示自动探测 + 手动添加的列表，可选默认 / 启停 / 删除 / 新增 */
function IdeAppsSection({
  defaultIdeId,
  onSetDefault
}: {
  defaultIdeId: string
  onSetDefault: (id: string) => void
}): React.JSX.Element {
  const [apps, setApps] = useState<IdeAppView[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [exePath, setExePath] = useState('')
  const [err, setErr] = useState('')

  const refresh = (): void => {
    setLoading(true)
    void window.api.apps
      .list()
      .then(setApps)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    let alive = true
    void window.api.apps
      .list()
      .then((a) => {
        if (alive) setApps(a)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const submitAdd = async (): Promise<void> => {
    setErr('')
    const res = await window.api.apps.addCustom(name, exePath)
    if (!res.ok) {
      setErr(res.error ?? '添加失败')
      return
    }
    if (res.apps) setApps(res.apps)
    setName('')
    setExePath('')
    setAdding(false)
  }

  const toggleEnabled = async (a: IdeAppView): Promise<void> => {
    const res = await window.api.apps.setEnabled(a.id, !a.enabled)
    if (res.apps) setApps(res.apps)
    if (a.enabled && defaultIdeId === a.id) onSetDefault('')
  }

  const removeApp = async (a: IdeAppView): Promise<void> => {
    if (!window.confirm(`移除应用「${a.name}」？`)) return
    const res = await window.api.apps.remove(a.id)
    if (res.apps) setApps(res.apps)
    if (defaultIdeId === a.id) onSetDefault('')
  }

  const enabledApps = apps.filter((a) => a.enabled)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          自动扫描本机已装 IDE（需手动添加的可点下方）。选一个默认，任务菜单里一键用 IDE
          打开工作目录。
        </p>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:bg-black/5 hover:text-ink disabled:cursor-default disabled:opacity-60"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')}
          >
            <path
              d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96M13.6 2.4v2.2h-2.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {loading ? '检测中…' : '重新检测'}
        </button>
      </div>
      {!loading && apps.length === 0 && (
        <p className="text-sm text-ink-3">
          未检测到已知 IDE。可在下方手动添加（填可执行文件绝对路径）。
        </p>
      )}

      {apps.map((a) => {
        const isDefault = defaultIdeId === a.id && a.enabled
        return (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                title={a.enabled ? (isDefault ? '当前默认' : '设为默认') : '已停用，无法设为默认'}
                disabled={!a.enabled}
                onClick={() => onSetDefault(isDefault ? '' : a.id)}
                className={
                  'h-4 w-4 shrink-0 rounded-full border transition ' +
                  (isDefault
                    ? 'border-brand bg-brand'
                    : 'border-black/25 hover:border-brand disabled:cursor-not-allowed disabled:opacity-40')
                }
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium text-ink">
                  {a.icon ? (
                    <img src={a.icon} alt="" className="h-5 w-5 shrink-0 rounded-[4px]" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-black/5">
                      <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-ink-3">
                        <path
                          d="M7.5 7 4.5 10l3 3M12.5 7l3 3-3 3"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                  {a.name}
                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-ink-3">
                    {a.source === 'auto' ? '自动' : '手动'}
                  </span>
                  {isDefault && (
                    <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                      默认
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-ink-3" title={a.path}>
                  {a.path}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                className="text-sm text-ink-2 hover:text-brand"
                onClick={() => void toggleEnabled(a)}
              >
                {a.enabled ? '停用' : '启用'}
              </button>
              {a.removable && (
                <button className="text-sm text-red-500" onClick={() => void removeApp(a)}>
                  删除
                </button>
              )}
            </div>
          </div>
        )
      })}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <input
            className={inputClass}
            value={name}
            placeholder="名称，例如：我的编辑器"
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={inputClass}
            value={exePath}
            placeholder="可执行文件绝对路径，例如 C:\\Program Files\\Foo\\Foo.exe"
            onChange={(e) => setExePath(e.target.value)}
          />
          {err && <div className="text-xs text-red-500">{err}</div>}
          <div className="flex items-center gap-2">
            <button
              className="rounded bg-ink px-3 py-1.5 text-sm text-white hover:bg-black disabled:opacity-40"
              disabled={!name.trim() || !exePath.trim()}
              onClick={() => void submitAdd()}
            >
              保存
            </button>
            <button
              className="rounded px-3 py-1.5 text-sm text-ink-3 hover:bg-canvas"
              onClick={() => {
                setAdding(false)
                setErr('')
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="w-full rounded-lg border border-dashed border-black/15 py-2 text-sm text-ink-2 transition hover:border-brand hover:text-brand"
          onClick={() => setAdding(true)}
        >
          ＋ 手动添加应用
        </button>
      )}

      {enabledApps.length === 0 && !loading && apps.length > 0 && (
        <p className="text-xs text-ink-3">所有应用均已停用，任务菜单的「在 IDE 打开」将不可用。</p>
      )}
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const providers = useSettingsStore((s) => s.providers)
  const load = useSettingsStore((s) => s.load)
  const upsert = useSettingsStore((s) => s.upsert)
  const remove = useSettingsStore((s) => s.remove)

  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [tokenMasked, setTokenMasked] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  // 偏好 / 关于信息 / 魔搭 Token 掩码：进页面各拉一次
  useEffect(() => {
    window.api.prefs
      .get()
      .then(setPrefs)
      .catch(() => undefined)
    window.api.prefs
      .appInfo()
      .then(setInfo)
      .catch(() => undefined)
    window.api.mcpHub
      .getToken()
      .then(setTokenMasked)
      .catch(() => undefined)
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  // 局部即时更新 + 落盘主进程；短暂显示「已保存」提示
  const patch = (p: Partial<AppPrefs>): void => {
    setPrefs((prev) => (prev ? { ...prev, ...p } : prev))
    void window.api.prefs.set(p)
    setSavedFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1500)
  }

  const pickWorkDir = async (): Promise<void> => {
    const dir = await window.api.system.pickDirectory()
    if (dir) patch({ defaultWorkDir: dir })
  }

  const wipe = async (): Promise<void> => {
    setConfirmWipe(false)
    await window.api.prefs.wipe()
    // 会话/Provider 列表已失效，重载渲染侧只读数据
    await load()
    const fresh = await window.api.prefs.get()
    setPrefs(fresh)
    setSavedFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1500)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">设置</h2>
          {savedFlash && <span className="text-xs text-emerald-600">已保存</span>}
        </div>

        {/* ---------- 模型服务 ---------- */}
        <Section title="模型服务" desc="OpenAI 兼容的推理端点；默认模型用于新建任务预选。">
          <div className="space-y-2">
            {providers.length === 0 && (
              <p className="text-sm text-ink-3">还没有配置任何模型服务，点下方「新增」。</p>
            )}
            {providers.map((p) => {
              const isDefault = prefs?.defaultProviderId === p.id
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      title={isDefault ? '当前默认模型' : '设为默认'}
                      onClick={() => patch({ defaultProviderId: p.id })}
                      className={
                        'h-4 w-4 shrink-0 rounded-full border transition ' +
                        (isDefault ? 'border-brand bg-brand' : 'border-black/25 hover:border-brand')
                      }
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {p.name}
                        {isDefault && (
                          <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                            默认
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {p.model} · {p.baseUrl}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="text-sm text-ink-2 hover:text-brand"
                      onClick={() => setEditing(p)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-sm text-red-500"
                      onClick={() => {
                        void remove(p.id)
                        if (isDefault) patch({ defaultProviderId: '' })
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
            {editing ? (
              <ProviderForm
                initial={editing}
                onCancel={() => setEditing(null)}
                onSubmit={async (p) => {
                  await upsert(p)
                  setEditing(null)
                }}
              />
            ) : (
              <button
                className="w-full rounded-lg border border-dashed border-black/15 py-2 text-sm text-ink-2 transition hover:border-brand hover:text-brand"
                onClick={() => setEditing(EMPTY_PROVIDER)}
              >
                ＋ 新增模型服务
              </button>
            )}
          </div>
        </Section>

        {/* ---------- 通用 ---------- */}
        <Section title="通用">
          <Field label="默认工作目录" hint="新建任务时预选的工作空间；留空则每次手动选择。">
            <div className="flex w-64 items-center gap-2">
              <input
                className={inputClass}
                value={prefs?.defaultWorkDir ?? ''}
                placeholder="未设置"
                onChange={(e) => patch({ defaultWorkDir: e.target.value })}
              />
              <button
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink-2 hover:border-black/25"
                onClick={() => void pickWorkDir()}
              >
                选择
              </button>
            </div>
          </Field>
          <Field label="外观" hint="深色主题开发中，当前仅浅色。">
            <span className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] text-ink-3">
              浅色
            </span>
          </Field>
        </Section>

        {/* ---------- 外部应用（IDE）---------- */}
        <Section
          title="外部应用 / IDE"
          desc="用于任务菜单的「在资源管理器打开」与「在 IDE 打开」。自动扫描不到的可手动添加可执行文件路径。"
        >
          <IdeAppsSection
            defaultIdeId={prefs?.defaultIdeId ?? ''}
            onSetDefault={(id) => patch({ defaultIdeId: id })}
          />
        </Section>

        {/* ---------- 权限与安全 ---------- */}
        <Section title="权限与安全">
          <Field
            label="工具批准策略"
            hint="自动允许全部会跳过所有批准卡（含文件写入、命令执行、MCP 工具），仅建议在受信环境开启。"
          >
            <div className="flex gap-2">
              {(
                [
                  { key: 'ask', label: '每次询问' },
                  { key: 'auto', label: '自动允许全部' }
                ] as const
              ).map((opt) => {
                const active = (prefs?.approvalMode ?? 'ask') === opt.key
                const danger = opt.key === 'auto' && active
                return (
                  <button
                    key={opt.key}
                    onClick={() => patch({ approvalMode: opt.key })}
                    className={
                      'rounded-lg border px-3 py-1.5 text-[13px] transition ' +
                      (danger
                        ? 'border-red-300 bg-red-50 font-medium text-red-600'
                        : active
                          ? 'border-brand bg-brand/5 font-medium text-brand'
                          : 'border-line bg-white text-ink-2 hover:border-black/25')
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field
            label="魔搭访问令牌"
            hint="用于一键安装托管（Hosted）MCP；加密存本机，管理入口在连接器页。"
          >
            <span className="font-mono text-[13px] text-ink-2">
              {tokenMasked ? tokenMasked : '未配置'}
            </span>
          </Field>
          <Field label="本地数据目录" hint="会话记录、模型配置、已装技能与连接器都存这里。">
            <div className="flex items-center gap-2">
              <span
                className="max-w-[16rem] truncate font-mono text-xs text-ink-3"
                title={info?.dataDir}
              >
                {info?.dataDir ?? '…'}
              </span>
              <button
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] text-ink-2 hover:border-black/25"
                onClick={() => info && void window.api.system.openPath(info.dataDir)}
              >
                打开
              </button>
            </div>
          </Field>
          <Field
            label="清空全部数据"
            hint="删除所有会话、模型配置、技能与连接器登记。此操作不可撤销。"
          >
            {confirmWipe ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-red-600">确定清空？建议先重启前备份</span>
                <button
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-600"
                  onClick={() => void wipe()}
                >
                  确认清空
                </button>
                <button
                  className="rounded-lg px-3 py-1.5 text-[13px] text-ink-2 hover:bg-black/5"
                  onClick={() => setConfirmWipe(false)}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[13px] text-red-500 hover:bg-red-50"
                onClick={() => setConfirmWipe(true)}
              >
                清空全部数据
              </button>
            )}
          </Field>
        </Section>

        {/* ---------- 关于 ---------- */}
        <Section title="关于">
          <Field label="版本">
            <span className="text-[13px] text-ink-2">v{info?.version ?? '—'}</span>
          </Field>
          <Field label="检查更新" hint="更新服务将在二期接入。">
            <span className="text-[13px] text-ink-3">当前已是最新版本</span>
          </Field>
        </Section>
      </div>
    </div>
  )
}
