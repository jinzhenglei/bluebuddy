import { useEffect, useMemo, useRef, useState } from 'react'
import type { HubSkill, SkillInfo } from '@shared/types'

/**
 * 技能页（WorkBuddy 风格重设计 + SkillHub 市场接入）。
 *
 * 双视图：
 * - 发现（默认）：SkillHub 搜索/分类/精选卡片，一键下载安装；
 * - 我安装的：本地技能管理（启停/删除/导入）。
 * 市场包安装走主进程 importFromZip 安装链，zip-slip 与 SKILL.md 校验自动继承。
 */

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: '', label: '全部' },
  { key: 'office-efficiency', label: '办公效率' },
  { key: 'dev-programming', label: '开发编程' },
  { key: 'data-analysis', label: '数据分析' },
  { key: 'design-media', label: '设计多媒体' },
  { key: 'ai-agent', label: 'AI Agent' },
  { key: 'knowledge-management', label: '知识管理' },
  { key: 'life-service', label: '生活服务' },
  { key: 'professional', label: '专业领域' },
  { key: 'it-ops-security', label: '安全运维' }
]

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 名字哈希取色：无图标技能给一个稳定的柔和色圆底 */
function hueOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function SkillIcon({
  name,
  iconUrl,
  size
}: {
  name: string
  iconUrl: string | null
  size: number
}): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  if (iconUrl && !broken) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-[10px] object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  const hue = hueOf(name)
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[10px] font-semibold"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 70% 92%)`,
        color: `hsl(${hue} 55% 38%)`,
        fontSize: size * 0.42
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function IconPlus(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconCheck(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconSearch(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function IconRefresh(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  )
}

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

/** 启停开关（WorkBuddy 同款绿色态） */
function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-black/15'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function SkillsPage(): React.JSX.Element {
  // ---------- 视图与本地管理 ----------
  const [view, setView] = useState<'discover' | 'installed'>('discover')
  const [installed, setInstalled] = useState<SkillInfo[] | null>(null)
  const [installedNonce, setInstalledNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [manageError, setManageError] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // ---------- 市场发现 ----------
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<HubSkill[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [firstPage, setFirstPage] = useState<HubSkill[]>([])
  const [hubError, setHubError] = useState<string | null>(null)
  const [featOffset, setFeatOffset] = useState(0)
  const [retryNonce, setRetryNonce] = useState(0)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [installedCanon, setInstalledCanon] = useState<Set<string>>(new Set())
  const [localQuery, setLocalQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 区分「刷新替换」与「加载更多追加」：每次触发请求前显式设置
  const modeRef = useRef<'replace' | 'append'>('replace')

  useEffect(() => {
    let cancelled = false
    window.api.skills.list().then((rows) => {
      if (!cancelled) setInstalled(rows)
    })
    return () => {
      cancelled = true
    }
  }, [installedNonce])

  useEffect(() => {
    let cancelled = false
    const isAppend = modeRef.current === 'append'
    window.api.hub
      .search({
        keyword: debouncedKeyword || undefined,
        category: category || undefined,
        page
      })
      .then((res) => {
        if (cancelled) return
        if (!res.ok || !res.result) {
          setHubError(res.error ?? 'SkillHub 请求失败')
          if (!isAppend) {
            setList([])
            setFirstPage([])
            setTotal(0)
          }
        } else {
          setHubError(null)
          setTotal(res.result.total)
          const skills = res.result.skills
          if (isAppend) {
            // 追加下一页，按 canonicalName 去重，顺序接在现有列表下方
            setList((prev) => {
              const seen = new Set(prev.map((s) => s.canonicalName))
              return [...prev, ...skills.filter((s) => !seen.has(s.canonicalName))]
            })
          } else {
            setList(skills)
            setFirstPage(skills)
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHubError(err instanceof Error ? err.message : String(err))
          if (!isAppend) {
            setList([])
            setFirstPage([])
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setLoadingMore(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword, category, page, retryNonce])

  const onKeywordChange = (v: string): void => {
    setKeyword(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      modeRef.current = 'replace'
      setLoading(true)
      setDebouncedKeyword(v.trim())
      setPage(1)
    }, 350)
  }

  // 精选：取首页数据按下载量排序后轮转切片，「换一换」推进偏移（与分页解耦，翻页不跳动）
  const featured = useMemo(() => {
    const sorted = [...firstPage].sort((a, b) => b.downloads - a.downloads)
    if (sorted.length === 0) return []
    const off = featOffset % sorted.length
    const pick = sorted.slice(off, off + 3)
    while (pick.length < 3 && pick.length < sorted.length) {
      pick.push(sorted[pick.length % sorted.length])
    }
    return pick
  }, [firstPage, featOffset])

  // 已安装视图的本地过滤（不走网络）
  const filteredInstalled = useMemo(() => {
    if (!installed) return null
    const q = localQuery.trim().toLowerCase()
    if (!q) return installed
    return installed.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q))
  }, [installed, localQuery])

  const guard = (fn: () => Promise<void>) => (): void => {
    if (busy) return
    setBusy(true)
    setManageError(null)
    fn().finally(() => setBusy(false))
  }

  const reloadInstalled = (): void => setInstalledNonce((n) => n + 1)

  const toggle = (s: SkillInfo): void => {
    guard(async () => {
      const res = await window.api.skills.setEnabled(s.name, !s.enabled)
      if (!res.ok) setManageError(res.error ?? '操作失败')
      reloadInstalled()
    })()
  }

  const remove = (s: SkillInfo): void => {
    if (confirmName !== s.name) {
      setConfirmName(s.name)
      setTimeout(() => setConfirmName((cur) => (cur === s.name ? null : cur)), 3000)
      return
    }
    setConfirmName(null)
    guard(async () => {
      const res = await window.api.skills.remove(s.name)
      if (!res.ok) setManageError(res.error ?? '删除失败')
      reloadInstalled()
    })()
  }

  const doImport = (pick: () => Promise<string | null>): void => {
    setAddMenuOpen(false)
    guard(async () => {
      const src = await pick()
      if (!src) return
      const res = await window.api.skills.import(src)
      if (!res.ok) setManageError(res.error ?? '导入失败')
      reloadInstalled()
    })()
  }

  const installFromHub = (s: HubSkill): void => {
    if (installing.has(s.canonicalName)) return
    setInstalling((prev) => new Set(prev).add(s.canonicalName))
    setHubError(null)
    window.api.hub.install(s.canonicalName, s.name).then((res) => {
      setInstalling((prev) => {
        const next = new Set(prev)
        next.delete(s.canonicalName)
        return next
      })
      if (!res.ok) {
        setHubError(res.error ?? '安装失败')
        return
      }
      setInstalledCanon((prev) => new Set(prev).add(s.canonicalName))
      reloadInstalled()
    })
  }

  const installButton = (s: HubSkill): React.JSX.Element => {
    const isInstalling = installing.has(s.canonicalName)
    const done = installedCanon.has(s.canonicalName)
    return (
      <button
        onClick={() => installFromHub(s)}
        disabled={isInstalling || done}
        title={done ? '已安装' : '安装到本地'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
          done
            ? 'bg-emerald-500 text-white'
            : isInstalling
              ? 'bg-black/10 text-ink-3'
              : 'bg-black/5 text-ink-2 hover:bg-ink hover:text-white'
        }`}
      >
        {isInstalling ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" />
        ) : done ? (
          <IconCheck />
        ) : (
          <IconPlus />
        )}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* 顶栏：发现页=标题+市场搜索；已安装页=返回箭头+本地搜索（WorkBuddy 同款导航） */}
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        {view === 'installed' ? (
          <button
            onClick={() => setView('discover')}
            className="flex items-center gap-1 text-sm font-semibold text-ink hover:opacity-70"
          >
            <IconChevronLeft />
            全部技能
          </button>
        ) : (
          <h1 className="text-sm font-semibold text-ink">技能</h1>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex w-60 items-center gap-2 rounded-lg bg-black/5 px-3 py-1.5 text-ink-3 focus-within:bg-black/8">
            <IconSearch />
            {view === 'installed' ? (
              <input
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                placeholder="搜索已安装的技能"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
            ) : (
              <input
                value={keyword}
                onChange={(e) => onKeywordChange(e.target.value)}
                placeholder="搜索技能"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
            )}
          </div>
          {view === 'discover' && (
            <button
              onClick={() => setView('installed')}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-black/5"
            >
              我安装的
              <span className="rounded-md bg-black/5 px-1.5 text-xs text-ink-3">
                {installed?.length ?? 0}
              </span>
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm text-white hover:opacity-90"
            >
              <IconPlus />
              添加技能
            </button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
                  <button
                    onClick={() => doImport(() => window.api.system.pickZipFile())}
                    className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-black/5"
                  >
                    导入 zip 技能包
                  </button>
                  <button
                    onClick={() => doImport(() => window.api.system.pickDirectory())}
                    className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-black/5"
                  >
                    从文件夹导入
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {manageError && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {manageError}
          </div>
        )}

        {view === 'discover' && (
          <>
            {/* 精选技能 */}
            {!debouncedKeyword && featured.length > 0 && (
              <section className="mb-8">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-ink">精选技能</h2>
                  <button
                    onClick={() => setFeatOffset((o) => o + 3)}
                    className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
                  >
                    <IconRefresh />
                    换一换
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {featured.map((s) => (
                    <div
                      key={s.canonicalName}
                      className="flex items-start gap-3 rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                    >
                      <SkillIcon name={s.name} iconUrl={s.iconUrl} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-2">
                          {s.descriptionZh || s.description}
                        </p>
                      </div>
                      {installButton(s)}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 分类 + 来源 */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => {
                    modeRef.current = 'replace'
                    setLoading(true)
                    setCategory(c.key)
                    setPage(1)
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    category === c.key ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5'
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <button
                onClick={() => window.api.system.openExternal('https://skillhub.cn')}
                className="ml-auto flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
              >
                skillhub.cn · 共 {fmtCount(total)} 个技能 ↗
              </button>
            </div>

            {hubError && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                <span>{hubError}</span>
                <button
                  onClick={() => {
                    modeRef.current = 'replace'
                    setLoading(true)
                    setRetryNonce((n) => n + 1)
                  }}
                  className="underline"
                >
                  重试
                </button>
              </div>
            )}

            {loading && list.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">加载中…</p>
            ) : list.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">
                没有匹配的技能，换个关键词或分类试试
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((s) => (
                    <div
                      key={s.canonicalName}
                      className="flex flex-col rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                    >
                      <div className="flex items-start gap-3">
                        <SkillIcon name={s.name} iconUrl={s.iconUrl} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                          <p className="mt-0.5 text-[11px] text-ink-3">v{s.version || '-'}</p>
                        </div>
                        {installButton(s)}
                      </div>
                      <p className="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-ink-2">
                        {s.descriptionZh || s.description}
                      </p>
                      <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-3">
                        <span>↓ {fmtCount(s.downloads)}</span>
                        <span>☆ {s.stars}</span>
                        {s.requiresApiKey && (
                          <span className="rounded-md bg-black/5 px-1.5 py-0.5">需 APIKey</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-center">
                  {loadingMore ? (
                    <p className="py-2 text-sm text-ink-3">加载中…</p>
                  ) : list.length < total ? (
                    <button
                      onClick={() => {
                        modeRef.current = 'append'
                        setLoadingMore(true)
                        setPage((p) => p + 1)
                      }}
                      className="rounded-lg border border-line px-4 py-1.5 text-sm text-ink-2 hover:bg-black/5"
                    >
                      加载更多
                    </button>
                  ) : (
                    <p className="py-2 text-xs text-ink-3">已加载全部技能</p>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {view === 'installed' && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold text-ink">我安装的</h2>
              <span className="rounded-md bg-black/5 px-1.5 text-xs text-ink-3">
                {filteredInstalled?.length ?? 0}
              </span>
            </div>
            {installed === null && <p className="text-sm text-ink-3">加载中…</p>}
            {filteredInstalled !== null && filteredInstalled.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-3">
                {installed?.length === 0
                  ? '还没有技能。返回发现页从 SkillHub 安装，或点「添加技能」导入本地 zip 包 / 文件夹。'
                  : '没有匹配已安装技能的搜索结果'}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredInstalled?.map((s) => (
                <div
                  key={s.name}
                  title={s.dir}
                  className="group flex flex-col rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                >
                  <div className="flex items-center gap-3">
                    <SkillIcon name={s.displayName || s.name} iconUrl={null} size={40} />
                    <p
                      className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
                      title={s.name}
                    >
                      {s.displayName || s.name}
                    </p>
                    <Toggle checked={s.enabled} onChange={() => toggle(s)} />
                  </div>
                  <p className="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-ink-2">
                    {s.description}
                  </p>
                  <div
                    className={`mt-2 flex justify-end ${
                      confirmName === s.name
                        ? ''
                        : 'opacity-0 transition-opacity group-hover:opacity-100'
                    }`}
                  >
                    <button
                      onClick={() => remove(s)}
                      className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                        confirmName === s.name
                          ? 'bg-red-500 text-white'
                          : 'text-ink-3 hover:bg-black/5 hover:text-red-500'
                      }`}
                    >
                      {confirmName === s.name ? '确认删除?' : '删除'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
