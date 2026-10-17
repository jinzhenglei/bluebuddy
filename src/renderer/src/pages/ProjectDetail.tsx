import { useEffect, useMemo, useState } from 'react'
import { Composer } from '@renderer/components/Composer'
import {
  ASSET_GRID_COLS,
  KIND_META,
  assetKindOf,
  dirLabel,
  fmtAssetTime,
  fmtSize,
  kindsPresent,
  matchAsset
} from '@renderer/components/asset-display'
import type { AssetKind } from '@renderer/components/asset-display'
import {
  IconClose,
  IconFolder,
  IconGrid,
  IconMore,
  IconRefresh,
  IconRows,
  IconSearch,
  IconSpark,
  IconTray,
  KindGlyph
} from '@renderer/components/asset-icons'
import { PreviewPane } from '@renderer/components/WorkspaceBrowser'
import { TaskOpenMenu } from '@renderer/components/TaskOpenMenu'
import { useWorkspacePreview } from '@renderer/components/workspace-preview'
import { useAgentStore } from '@renderer/stores/agent'
import { useProjectsStore } from '@renderer/stores/projects'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  ASSET_SCAN_MAX_FILES,
  DEFAULT_ASSET_EXTS,
  DEFAULT_ASSET_IGNORE_DIRS,
  formatNameList,
  parseNameList,
  resolveAssetConfig
} from '@shared/asset-config'
import type { AppPrefs, AssetFilter, ProjectAssetEntry } from '@shared/types'

/**
 * 项目空间详情页：面包屑 +「任务 / 资产」双 Tab + 底部 Composer + 右栏空间配置。
 * 提问即「在本空间新建任务并执行」，沿用新建任务页的标题截断与模型校验规则。
 * 资产页是一张统一列表：任务产物与按配置扫描到的其他途径文件同地位混排，
 * 开关只改视图不改数据（所以切开关不重扫），要重扫得点「刷新」。
 * 组件由调用方按 projectId 加 key 重挂载，配置面板的编辑态随之与库内数据对齐。
 */

function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 资产页的来源过滤开关；计数直接取主进程算好的 assetCounts */
const FILTER_TABS: Array<{ key: AssetFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'task', label: '任务生成' },
  { key: 'other', label: '其他途径' }
]

/** 类型徽标：形状先说话，配色只是加强 */
function KindBadge({ name, size = 36 }: { name: string; size?: number }): React.JSX.Element {
  const kind = assetKindOf(name)
  return (
    <span
      className={'grid shrink-0 place-items-center rounded-[10px] ' + KIND_META[kind].badge}
      style={{ width: size, height: size }}
      title={KIND_META[kind].label}
    >
      <KindGlyph kind={kind} />
    </span>
  )
}

/** 来源列：任务产物带任务名配星形，其余标「其他途径」配托盘 */
function AssetSourceCell({ a }: { a: ProjectAssetEntry }): React.JSX.Element {
  return a.source === 'task' ? (
    <span
      className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2"
      title={a.sessionTitle ?? '任务生成'}
    >
      <span className="text-brand">
        <IconSpark />
      </span>
      <span className="min-w-0 truncate">{a.sessionTitle ?? '任务生成'}</span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
      <IconTray />
      <span className="min-w-0 truncate">其他途径</span>
    </span>
  )
}

/** 筛选胶囊：来源档与类型档共用一种形态，选中态走近黑动作主色 */
function Pill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-1 rounded-lg border px-3 py-1 text-[12px] transition ' +
        (active
          ? 'border-ink bg-ink font-medium text-canvas'
          : 'border-line text-ink-2 hover:border-ink-3/50 hover:text-ink')
      }
    >
      {children}
    </button>
  )
}

/** 空间配置右栏的一格标签 */
function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <label className="mb-1 block text-xs text-ink-3">{children}</label>
}

export function ProjectDetailPage({
  projectId,
  onBack,
  onOpenSession
}: {
  projectId: string
  onBack: () => void
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const projects = useProjectsStore((s) => s.projects)
  const loadProjects = useProjectsStore((s) => s.load)
  const updateProject = useProjectsStore((s) => s.update)
  const removeProject = useProjectsStore((s) => s.remove)
  const assets = useProjectsStore((s) => s.assets)
  const assetCounts = useProjectsStore((s) => s.assetCounts)
  const assetsTruncated = useProjectsStore((s) => s.assetsTruncated)
  const assetsError = useProjectsStore((s) => s.assetsError)
  const loadAssets = useProjectsStore((s) => s.loadAssets)
  const setAssetFilter = useProjectsStore((s) => s.setFilter)

  const sessions = useAgentStore((s) => s.sessions)
  const sessionTurns = useAgentStore((s) => s.sessionTurns)
  const createSession = useAgentStore((s) => s.createSession)
  const send = useAgentStore((s) => s.send)
  const providers = useSettingsStore((s) => s.providers)

  const project = projects.find((p) => p.id === projectId)

  const [tab, setTab] = useState<'tasks' | 'assets'>('tasks')
  const [input, setInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  // 配置面板草稿：只有用户真的编辑过才非空，失焦保存成功后交还库内值。
  // 初值不能直接取 project 字段 —— 首帧空间数据还没 load 回来，失焦会把已有指令清空。
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [instrDraft, setInstrDraft] = useState<string | null>(null)
  const nameValue = nameDraft ?? project?.name ?? ''
  const instrValue = instrDraft ?? project?.instructions ?? ''

  // 「资产识别」两个输入框：值只取库内的覆盖值，没覆盖就留空让 placeholder 去讲默认清单。
  // 绝不能把展开后的默认值当输入框初值 —— 失焦保存会把“抄一遍默认”写进库，把空间钉死在今日的默认上。
  const storedExts = formatNameList(project?.assetConfig?.includeExts)
  const storedDirs = formatNameList(project?.assetConfig?.ignoreDirs)
  const [extsDraft, setExtsDraft] = useState<string | null>(null)
  const [dirsDraft, setDirsDraft] = useState<string | null>(null)
  // 「恢复默认」的结果提示：这按钮在已是默认时不会改变任何画面，不说一句会被当成没生效
  const [assetCfgNote, setAssetCfgNote] = useState<string | null>(null)
  const extsValue = extsDraft ?? storedExts
  const dirsValue = dirsDraft ?? storedDirs

  // 引用稳定：预览仍由主进程按空间工作目录解析浏览根
  const target = useMemo(() => ({ projectId }), [projectId])
  const {
    preview,
    openFile,
    close: closePreview
  } = useWorkspacePreview(target, project?.workDir ?? '')

  useEffect(() => {
    void loadProjects()
    void loadAssets(projectId)
    void window.api.prefs.get().then(setPrefs)
  }, [loadProjects, loadAssets, projectId])

  const assetFilter = resolveAssetConfig(project?.assetConfig).filter
  // 三个视图态：来源档持久化在空间上，类型档与关键词只是本页筛选，切走就丢
  const [assetKind, setAssetKind] = useState<AssetKind | 'all'>('all')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetView, setAssetView] = useState<'list' | 'grid'>('list')
  const visibleAssets = useMemo(
    () =>
      assets.filter((a) =>
        matchAsset(a, { source: assetFilter, kind: assetKind, query: assetQuery })
      ),
    [assets, assetFilter, assetKind, assetQuery]
  )
  const presentKinds = useMemo(() => kindsPresent(assets, assetFilter), [assets, assetFilter])
  // 行尾「⋯」菜单：记住是哪一行与弹层位置（列表容器会滚动，菜单用 fixed 定位不会被裁）
  const [rowMenu, setRowMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const menuAsset = rowMenu ? visibleAssets.find((v) => v.key === rowMenu.key) : undefined
  // 筛到空了要能一键清掉，否则用户只会看到一片空白与一个看不懂的胶囊
  const assetFilterDirty = assetKind !== 'all' || !!assetQuery.trim()

  const spaceSessions = useMemo(
    () => sessions.filter((s) => s.projectId === projectId),
    [sessions, projectId]
  )

  // composer 里手选的模型只影响本次提问（与新建任务页同构），不能写回空间默认：
  // 否则用户在输入框上看一眼模型，空间就被锁死成那一个，之后改应用默认对该空间无效。
  const [askProviderId, setAskProviderId] = useState('')
  // 优先级：本次提问手选 > 空间默认模型 > 应用默认模型 > 第一个可用 Provider
  const askProviderIdOrFallback =
    askProviderId || project?.providerId || prefs?.defaultProviderId || providers[0]?.id || ''

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || !project) return
    if (!askProviderIdOrFallback) {
      setHint('还没有可用的模型服务，请先到「设置」中添加')
      return
    }
    setHint(null)
    const title = text.length > 24 ? `${text.slice(0, 24)}…` : text
    const s = await createSession({
      title,
      workDir: project.workDir,
      providerId: askProviderIdOrFallback,
      projectId: project.id
    })
    setInput('')
    onOpenSession(s.id)
    await send(text)
  }

  /** 打开资产：两类文件都躺在空间工作目录里，预览走同一个 relPath 沙箱 */
  const openAsset = (a: ProjectAssetEntry, mode: 'open' | 'preview'): void => {
    if (mode === 'open' || !a.relPath) {
      void window.api.system.openPath(a.absPath)
      return
    }
    openFile(a.relPath, a.name)
  }

  /** 定位到所在目录：没有 reveal 接口，打开父目录本身已够人工找到文件 */
  const openAssetDir = (a: ProjectAssetEntry): void => {
    const i = Math.max(a.absPath.lastIndexOf('/'), a.absPath.lastIndexOf('\\'))
    void window.api.system.openPath(i > 0 ? a.absPath.slice(0, i) : a.absPath)
  }

  /** 行尾「⋯」：记住是哪一行与视口坐标，贴底时往上弹 */
  const openRowMenu = (a: ProjectAssetEntry, e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const h = 108
    setRowMenu({
      key: a.key,
      x: Math.max(8, r.right - 160),
      y: r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6
    })
  }

  /** 行尾「⋯」：两种视图共用，宽度常驻，悬停时列不错位 */
  const moreButton = (a: ProjectAssetEntry, extra: string): React.JSX.Element => (
    <button
      aria-label="更多操作"
      className={
        'shrink-0 rounded-md p-1.5 text-ink-3 transition hover:bg-black/5 hover:text-ink group-focus-within:opacity-100 group-hover:opacity-100 ' +
        (rowMenu?.key === a.key ? 'opacity-100' : 'opacity-0') +
        extra
      }
      onClick={(e) => openRowMenu(a, e)}
    >
      <IconMore />
    </button>
  )

  const saveName = async (): Promise<void> => {
    if (!project) return
    const next = nameValue.trim()
    if (!next || next === project.name) {
      setNameDraft(null)
      return
    }
    const res = await updateProject(project.id, { name: next })
    // 失败时保留草稿便于重试，成功才交还库内值
    if (res.ok) setNameDraft(null)
    else setHint(res.error ?? '重命名失败')
  }

  const saveInstructions = async (): Promise<void> => {
    if (!project) return
    if (instrValue === (project.instructions ?? '')) {
      setInstrDraft(null)
      return
    }
    const res = await updateProject(project.id, { instructions: instrValue })
    if (res.ok) setInstrDraft(null)
    else setHint(res.error ?? '保存项目指令失败')
  }

  const pickWorkDir = async (): Promise<void> => {
    if (!project) return
    const dir = await window.api.system.pickDirectory()
    if (!dir || dir === project.workDir) return
    const ok = window.confirm(
      '更换工作目录只影响之后的任务与资产列表，已有任务仍留在各自原目录。确认更换？'
    )
    if (!ok) return
    const res = await updateProject(project.id, { workDir: dir })
    if (!res.ok) setHint(res.error ?? '更换工作目录失败')
    else void loadAssets(project.id)
  }

  const changeProvider = async (id: string): Promise<void> => {
    if (!project || id === (project.providerId ?? '')) return
    await updateProject(project.id, { providerId: id })
  }

  /** 开关已存进空间配置，切档不重扫（列表数据本来就包含两类）；类型档跟着重置，免得筛到空 */
  const changeFilter = async (next: AssetFilter): Promise<void> => {
    if (next === assetFilter) return
    setAssetKind('all')
    setRowMenu(null)
    const res = await setAssetFilter(projectId, next)
    if (!res.ok) setHint(res.error ?? '保存过滤状态失败')
  }

  /** 失焦保存：与库内覆盖值一致就交还草稿，不做无谓写入 */
  const saveAssetExts = async (): Promise<void> => {
    if (!project) return
    if (extsValue === storedExts) {
      setExtsDraft(null)
      return
    }
    // 只带自己这一个字段：合并交给主进程对着当次读到的库行做一次。
    // 展开本地缓存的 assetConfig 会在并发写下拿旧对象把别的字段顶回库里。
    const res = await updateProject(project.id, {
      assetConfig: { includeExts: parseNameList(extsValue) }
    })
    if (!res.ok) {
      setHint(res.error ?? '保存资产识别配置失败')
      return
    }
    setExtsDraft(null)
    // 其他途径那半边完全按新清单从磁盘算，配置一改必须重扫
    void loadAssets(project.id)
  }

  const saveAssetDirs = async (): Promise<void> => {
    if (!project) return
    if (dirsValue === storedDirs) {
      setDirsDraft(null)
      return
    }
    const res = await updateProject(project.id, {
      assetConfig: { ignoreDirs: parseNameList(dirsValue) }
    })
    if (!res.ok) {
      setHint(res.error ?? '保存资产识别配置失败')
      return
    }
    setDirsDraft(null)
    void loadAssets(project.id)
  }

  /** 恢复默认 = 只发两个空数组让主进程清掉覆盖；patch 里没有 filter，开关状态自然不动 */
  const resetAssetConfig = async (): Promise<void> => {
    if (!project) return
    if (!storedExts && !storedDirs) {
      // 本来就没有覆盖项：不必发一个无意义的写，直接把现状说清
      setExtsDraft(null)
      setDirsDraft(null)
      setAssetCfgNote('当前已是内置默认清单')
      return
    }
    const res = await updateProject(project.id, {
      assetConfig: { includeExts: [], ignoreDirs: [] }
    })
    setExtsDraft(null)
    setDirsDraft(null)
    if (!res.ok) {
      setHint(res.error ?? '恢复默认配置失败')
      return
    }
    setAssetCfgNote('已清除自定义，回到内置默认清单')
    void loadAssets(project.id)
  }

  const assetEmptyHint =
    assetFilter === 'other'
      ? '按当前配置没有匹配到其他途径的文件。可在右侧「资产识别」里补充扩展名。'
      : assetFilter === 'task'
        ? '本空间还没有文件产出。任务写出文件后会自动登记到这里。'
        : '这个空间还没有资产。任务写出的文件会自动登记，手工放进工作目录的文档按右侧配置也会列出。'

  const deleteSpace = async (): Promise<void> => {
    if (!project) return
    if (
      !window.confirm(
        `删除空间「${project.name}」？其中 ${spaceSessions.length} 个任务会转为未归类并全部保留，磁盘文件不做任何删除。`
      )
    )
      return
    await removeProject(project.id)
    onBack()
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：面包屑 + 在 IDE 打开 + 删除空间 */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
          <button className="text-sm text-ink-3 transition hover:text-ink" onClick={onBack}>
            项目空间
          </button>
          <span className="text-ink-3">/</span>
          <span className="min-w-0 truncate text-sm font-semibold text-ink">
            {project?.name ?? '加载中…'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {project && <TaskOpenMenu workDir={project.workDir} variant="header" />}
            <button
              className="rounded-lg px-2.5 py-1.5 text-sm text-ink-3 transition hover:bg-red-50 hover:text-red-500"
              onClick={() => void deleteSpace()}
            >
              删除空间
            </button>
          </div>
        </div>

        {/* Tab */}
        <div className="flex shrink-0 items-center gap-1 px-6 pt-3">
          {(
            [
              ['tasks', `任务 (${spaceSessions.length})`],
              ['assets', `资产 (${assetCounts.all})`]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                closePreview()
                if (key === 'assets') void loadAssets(projectId)
              }}
              className={
                'rounded-lg px-3 py-1.5 text-[13px] transition ' +
                (tab === key ? 'bg-black/5 font-semibold text-ink' : 'text-ink-3 hover:text-ink')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex min-h-0 flex-1 flex-col px-6 py-3">
          {preview ? (
            <PreviewPane preview={preview} onBack={closePreview} />
          ) : tab === 'tasks' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {spaceSessions.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-ink-3">
                  这个空间还没有任务。在下方提问即可在本空间开工。
                </p>
              ) : (
                spaceSessions.map((s) => {
                  const running = !!sessionTurns[s.id]?.activeTurnId
                  return (
                    <button
                      key={s.id}
                      onClick={() => onOpenSession(s.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-black/5"
                    >
                      {running ? (
                        <span
                          title="执行中"
                          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent"
                        />
                      ) : (
                        <span className="h-3 w-3 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {s.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">
                        {fmtDateTime(s.createdAt)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* 第一行：来源胶囊 + 搜索 + 视图切换 + 手动重扫 */}
              <div className="mb-2 flex shrink-0 items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {FILTER_TABS.map((f) => (
                    <Pill
                      key={f.key}
                      active={assetFilter === f.key}
                      onClick={() => void changeFilter(f.key)}
                    >
                      {f.label}
                      <span className="tabular-nums opacity-60">{assetCounts[f.key]}</span>
                    </Pill>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <label className="relative flex items-center">
                    <span className="pointer-events-none absolute left-2.5 text-ink-3">
                      <IconSearch />
                    </span>
                    <input
                      className="h-8 w-52 rounded-lg border border-line bg-surface pl-8 pr-7 text-[12px] text-ink outline-none transition placeholder:text-ink-3 focus:border-ink-3/60"
                      placeholder="搜索文件名…"
                      value={assetQuery}
                      onChange={(e) => setAssetQuery(e.target.value)}
                    />
                    {assetQuery && (
                      <button
                        aria-label="清空搜索"
                        className="absolute right-2 text-ink-3 transition hover:text-ink"
                        onClick={() => setAssetQuery('')}
                      >
                        <IconClose />
                      </button>
                    )}
                  </label>
                  {/* 列表看路径与来源，网格看名字 */}
                  <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
                    <button
                      aria-label="网格视图"
                      className={
                        'rounded-md p-1.5 transition ' +
                        (assetView === 'grid' ? 'bg-ink text-canvas' : 'text-ink-3 hover:text-ink')
                      }
                      onClick={() => setAssetView('grid')}
                    >
                      <IconGrid />
                    </button>
                    <button
                      aria-label="列表视图"
                      className={
                        'rounded-md p-1.5 transition ' +
                        (assetView === 'list' ? 'bg-ink text-canvas' : 'text-ink-3 hover:text-ink')
                      }
                      onClick={() => setAssetView('list')}
                    >
                      <IconRows />
                    </button>
                  </div>
                  <button
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-ink-3 transition hover:bg-black/5 hover:text-ink"
                    onClick={() => void loadAssets(projectId)}
                  >
                    <IconRefresh />
                    刷新
                  </button>
                </div>
              </div>

              {/* 第二行：类型筛选。只列当前来源档下真实存在的类型，只有一种时不占行 */}
              {presentKinds.length > 1 && (
                <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[11px] text-ink-3">类型</span>
                  <Pill active={assetKind === 'all'} onClick={() => setAssetKind('all')}>
                    全部
                  </Pill>
                  {presentKinds.map((k) => (
                    <Pill key={k} active={assetKind === k} onClick={() => setAssetKind(k)}>
                      {KIND_META[k].label}
                    </Pill>
                  ))}
                </div>
              )}

              {/* 工作目录不可访问：不挡任务产物，只把扫描那半边缺什么说清 */}
              {assetsError && (
                <p className="mb-2 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                  {assetsError}，下面只列出了已登记的任务产物。
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setRowMenu(null)}>
                {visibleAssets.length === 0 ? (
                  <div className="px-4 py-14 text-center">
                    <p className="text-xs text-ink-3">
                      {assetFilterDirty ? '没有匹配当前搜索或类型筛选的文件。' : assetEmptyHint}
                    </p>
                    {assetFilterDirty && (
                      <button
                        className="mt-3 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 transition hover:border-ink-3/50 hover:text-ink"
                        onClick={() => {
                          setAssetKind('all')
                          setAssetQuery('')
                        }}
                      >
                        清除搜索与筛选
                      </button>
                    )}
                  </div>
                ) : assetView === 'grid' ? (
                  <div
                    className="grid gap-2.5 pt-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))' }}
                  >
                    {visibleAssets.map((a) => (
                      <div
                        key={a.key}
                        role="button"
                        tabIndex={0}
                        title={a.relPath ?? a.absPath}
                        onClick={() => openAsset(a, 'preview')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openAsset(a, 'preview')
                        }}
                        className="group cursor-pointer rounded-xl border border-line bg-surface p-3 outline-none transition hover:border-ink-3/40 hover:shadow-[0_6px_20px_rgba(15,23,42,0.07)] focus-visible:border-ink-3/40"
                      >
                        <div className="flex items-start gap-2.5">
                          <KindBadge name={a.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">{a.name}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] text-ink-3">
                              <IconFolder size={11} />
                              <span className="min-w-0 truncate">{dirLabel(a.relPath)}</span>
                            </span>
                          </span>
                          {moreButton(a, ' -mt-1 -mr-1 self-start')}
                        </div>
                        <div className="mt-2.5 flex min-w-0 items-center gap-2 border-t border-line/70 pt-2">
                          <span className="min-w-0 flex-1">
                            <AssetSourceCell a={a} />
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-3 tabular-nums">
                            {fmtAssetTime(a.time)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {/* 列头与行共用同一份列宽，两侧才可能对得齐 */}
                    <div
                      className="grid items-center gap-3 border-b border-line px-1 pb-2 pt-1 text-[11px] text-ink-3"
                      style={{ gridTemplateColumns: ASSET_GRID_COLS }}
                    >
                      <span>名称</span>
                      <span>位置</span>
                      <span>来源</span>
                      <span className="text-right">大小</span>
                      <span>上次更新</span>
                      <span />
                    </div>
                    {visibleAssets.map((a) => (
                      <div
                        key={a.key}
                        role="button"
                        tabIndex={0}
                        title={a.relPath ?? a.absPath}
                        onClick={() => openAsset(a, 'preview')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openAsset(a, 'preview')
                        }}
                        className="group grid h-14 cursor-pointer items-center gap-3 border-b border-line/70 px-1 outline-none last:border-b-0 hover:bg-black/[0.02] focus-visible:bg-black/[0.02]"
                        style={{ gridTemplateColumns: ASSET_GRID_COLS }}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <KindBadge name={a.name} />
                          <span className="min-w-0 truncate text-[14px] text-ink">{a.name}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
                          <span className="opacity-70">
                            <IconFolder />
                          </span>
                          <span className="min-w-0 truncate font-mono">{dirLabel(a.relPath)}</span>
                        </span>
                        <span className="min-w-0">
                          <AssetSourceCell a={a} />
                        </span>
                        <span className="text-right text-[11px] text-ink-3 tabular-nums">
                          {fmtSize(a.size)}
                        </span>
                        <span className="whitespace-nowrap text-[12px] text-ink-2 tabular-nums">
                          {fmtAssetTime(a.time)}
                        </span>
                        {/* 整行点击即预览，剩下的收进行尾「⋯」 */}
                        {moreButton(a, ' justify-self-end')}
                      </div>
                    ))}
                  </>
                )}
                {menuAsset && rowMenu && (
                  <>
                    <button
                      aria-label="关闭操作菜单"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setRowMenu(null)}
                    />
                    <div
                      className="fixed z-50 w-40 rounded-xl border border-line bg-surface py-1 shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
                      style={{ left: rowMenu.x, top: rowMenu.y }}
                    >
                      {(
                        [
                          ['应用内预览', () => openAsset(menuAsset, 'preview')],
                          ['用默认应用打开', () => openAsset(menuAsset, 'open')],
                          ['打开所在目录', () => openAssetDir(menuAsset)]
                        ] as const
                      ).map(([label, run]) => (
                        <button
                          key={label}
                          className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-2 transition hover:bg-black/5 hover:text-ink"
                          onClick={() => {
                            setRowMenu(null)
                            run()
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* 撞到扫描上限就说清楚，别让使用者以为目录里只有这些 */}
                {assetsTruncated && assetFilter !== 'task' && (
                  <p className="px-4 py-2 text-[11px] leading-relaxed text-ink-3">
                    另有文件未列出（受 {ASSET_SCAN_MAX_FILES} 条扫描上限限制），可收窄右侧配置。
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 底部：在本空间提问 */}
          <div className="shrink-0 py-3">
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={() => void submit()}
              providers={providers}
              providerId={askProviderIdOrFallback}
              onProviderChange={setAskProviderId}
              placeholder={`在本空间提问，产出会归入${project?.name ? `「${project.name}」` : '这个空间'}的资产`}
            />
            {hint && <p className="mt-2 text-sm text-red-500">{hint}</p>}
          </div>
        </div>
      </div>

      {/* 右栏：空间配置 */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-canvas px-4 py-5">
        <div className="text-xs font-semibold text-ink-3">空间配置</div>

        <div>
          <FieldLabel>空间名称</FieldLabel>
          <input
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-3/60"
            value={nameValue}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void saveName()}
          />
        </div>

        <div>
          <FieldLabel>项目指令（每次提问自动注入给模型）</FieldLabel>
          <textarea
            className="min-h-28 w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-ink-3/60"
            value={instrValue}
            placeholder="例如：本仓库用 pnpm；提交前必须跑三门禁；文档一律写中文。"
            onChange={(e) => setInstrDraft(e.target.value)}
            onBlur={() => void saveInstructions()}
          />
        </div>

        <div>
          <FieldLabel>默认模型</FieldLabel>
          <select
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none"
            value={project?.providerId ?? ''}
            onChange={(e) => void changeProvider(e.target.value)}
          >
            <option value="">{providers.length ? '跟随应用默认' : '未配置模型'}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>工作目录</FieldLabel>
          <button
            className="w-full truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left font-mono text-[11px] text-ink-2 transition hover:bg-black/5"
            title={project?.workDir}
            onClick={() => void pickWorkDir()}
          >
            {project?.workDir || '选择目录…'}
          </button>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            改动只影响之后的任务与资产列表，已有任务保留自身目录。
          </p>
        </div>

        <div className="border-t border-line pt-3">
          <div className="mb-2 text-xs font-semibold text-ink-3">资产识别</div>
          <FieldLabel>包含扩展名</FieldLabel>
          <input
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-ink-3/60"
            value={extsValue}
            placeholder={formatNameList(DEFAULT_ASSET_EXTS)}
            onChange={(e) => {
              setExtsDraft(e.target.value)
              setAssetCfgNote(null)
            }}
            onBlur={() => void saveAssetExts()}
          />
          <div className="mt-2">
            <FieldLabel>忽略目录</FieldLabel>
            <input
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-ink-3/60"
              value={dirsValue}
              placeholder={formatNameList(DEFAULT_ASSET_IGNORE_DIRS)}
              onChange={(e) => {
                setDirsDraft(e.target.value)
                setAssetCfgNote(null)
              }}
              onBlur={() => void saveAssetDirs()}
            />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            逗号或换行分隔；留空 =
            使用默认配置，填了就整体替换默认清单（要都保留就把想留的一起写上）。
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            只作用于「其他途径」那半边：每次打开资产页按这里的清单实时扫工作目录，不入库。
          </p>
          <button
            className="mt-2 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-2 transition hover:bg-black/5"
            onClick={() => void resetAssetConfig()}
          >
            恢复默认
          </button>
          {assetCfgNote && <p className="mt-1 text-[11px] text-ink-3">{assetCfgNote}</p>}
        </div>
      </aside>
    </div>
  )
}
