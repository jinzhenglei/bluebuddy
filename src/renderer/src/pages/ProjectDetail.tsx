import { useEffect, useMemo, useState } from 'react'
import { Composer } from '@renderer/components/Composer'
import { PreviewPane, WorkspaceTree } from '@renderer/components/WorkspaceBrowser'
import { TaskOpenMenu } from '@renderer/components/TaskOpenMenu'
import { useWorkspacePreview } from '@renderer/components/workspace-preview'
import { useAgentStore } from '@renderer/stores/agent'
import { useProjectsStore } from '@renderer/stores/projects'
import { useSettingsStore } from '@renderer/stores/settings'
import type { AppPrefs, ArtifactInfo } from '@shared/types'

/**
 * 项目空间详情页：面包屑 +「任务 / 资产」双 Tab + 底部 Composer + 右栏空间配置。
 * 提问即「在本空间新建任务并执行」，沿用新建任务页的标题截断与模型校验规则。
 * 组件由调用方按 projectId 加 key 重挂载，配置面板的编辑态随之与库内数据对齐。
 */

function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  const artifacts = useProjectsStore((s) => s.artifacts)
  const loadArtifacts = useProjectsStore((s) => s.loadArtifacts)

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

  // 引用稳定：资产页目录树按空间解析浏览根
  const browseRoot = project?.workDir ?? ''
  const target = useMemo(() => ({ projectId }), [projectId])
  const {
    preview,
    openFile,
    close: closePreview
  } = useWorkspacePreview(target, project?.workDir ?? '')

  useEffect(() => {
    void loadProjects()
    void loadArtifacts(projectId)
    void window.api.prefs.get().then(setPrefs)
  }, [loadProjects, loadArtifacts, projectId])

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

  /** 打开产物：链接走浏览器，文件优先预览，缺 relPath 时用绝对路径交给系统 */
  const openArtifact = (a: ArtifactInfo, mode: 'open' | 'preview'): void => {
    if (mode === 'open' || !a.relPath) {
      void window.api.system.openPath(a.absPath ?? '')
      return
    }
    openFile(a.relPath, a.name)
  }

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
      '更换工作目录只影响之后的任务与资产浏览，已有任务仍留在各自原目录。确认更换？'
    )
    if (!ok) return
    const res = await updateProject(project.id, { workDir: dir })
    if (!res.ok) setHint(res.error ?? '更换工作目录失败')
    else void loadArtifacts(project.id)
  }

  const changeProvider = async (id: string): Promise<void> => {
    if (!project || id === (project.providerId ?? '')) return
    await updateProject(project.id, { providerId: id })
  }

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
              ['assets', `资产 (${artifacts.length})`]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                closePreview()
                if (key === 'assets') void loadArtifacts(projectId)
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
              {/* 上半：跨任务产物表 */}
              <div className="max-h-[45%] shrink-0 overflow-y-auto rounded-lg border border-line">
                {artifacts.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-3">
                    本空间还没有文件产出。任务写出文件后会自动登记到这里。
                  </p>
                ) : (
                  <table className="w-full border-collapse text-[13px]">
                    <tbody>
                      {artifacts.map((a) => (
                        <tr key={a.id} className="border-b border-line/60 last:border-b-0">
                          <td className="px-3 py-1.5">
                            <span className="block truncate text-ink" title={a.name}>
                              📄 {a.name}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-ink-3">
                              {a.relPath}
                            </span>
                          </td>
                          <td className="w-28 shrink-0 truncate px-2 py-1.5 text-[11px] text-ink-3">
                            {a.sessionTitle ?? '—'}
                          </td>
                          <td className="w-20 shrink-0 px-2 py-1.5 text-[11px] text-ink-3 tabular-nums">
                            {fmtDateTime(a.createdAt)}
                          </td>
                          <td className="w-24 shrink-0 px-2 py-1.5 text-right">
                            <button
                              className="rounded px-1.5 text-[11px] text-ink-2 hover:bg-black/5 hover:text-ink"
                              onClick={() => openArtifact(a, 'preview')}
                            >
                              预览
                            </button>
                            <button
                              className="rounded px-1.5 text-[11px] text-ink-2 hover:bg-black/5 hover:text-ink"
                              onClick={() => openArtifact(a, 'open')}
                            >
                              打开
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {/* 下半：空间工作目录树 */}
              <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-lg border border-line">
                <div className="shrink-0 border-b border-line px-3 py-1.5 text-[11px] text-ink-3">
                  工作目录
                  <span className="ml-1.5 font-mono text-ink-2" title={project?.workDir}>
                    {project?.workDir}
                  </span>
                </div>
                <WorkspaceTree
                  key={`${projectId}:${browseRoot}`}
                  target={target}
                  onOpenFile={openFile}
                />
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
            改动只影响之后的任务与资产浏览，已有任务保留自身目录。
          </p>
        </div>
      </aside>
    </div>
  )
}
