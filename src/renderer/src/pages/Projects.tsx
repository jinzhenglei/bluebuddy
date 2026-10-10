import { useEffect, useState } from 'react'
import { useProjectsStore } from '@renderer/stores/projects'
import { useSettingsStore } from '@renderer/stores/settings'
import type { ProjectInfo } from '@shared/types'

/**
 * 项目空间列表页（导航「项目空间」进入）：空间卡片网格 +「新建项目」弹窗。
 * 一个空间绑定一个工作目录，空间内任务共用该目录；卡片摘要来自 store.load()。
 */

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

/** 目录只显示最后两段，完整路径放 title */
function shortDir(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : dir
}

function IconFolderNew(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M3 5.5h5l1.5 2H17v8H3v-10Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10 9.5v4M8 11.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 新建空间弹窗：名称 + 工作目录（必选）+ 默认模型；指令留到详情页再写 */
function NewProjectDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated(id: string): void
}): React.JSX.Element {
  const create = useProjectsStore((s) => s.create)
  const providers = useSettingsStore((s) => s.providers)
  const [name, setName] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [providerId, setProviderId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const res = await create({
      name: name.trim(),
      workDir,
      // 「跟随应用默认」就是不给空间写默认模型：写死 providers[0] 会让用户改了应用默认后空间仍绑在旧模型上
      ...(providerId ? { providerId } : {})
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? '创建失败')
      return
    }
    if (res.project) onCreated(res.project.id)
    else onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-sm font-semibold text-ink">新建项目</div>

        <label className="mb-1 block text-xs text-ink-3">空间名称</label>
        <input
          autoFocus
          className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink-3/60"
          value={name}
          placeholder="例如：BlueBuddy 研发"
          onChange={(e) => setName(e.target.value)}
        />

        <label className="mb-1 block text-xs text-ink-3">工作目录（空间内任务共用此目录）</label>
        <button
          className={
            'mb-3 flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:bg-canvas ' +
            (workDir ? 'text-ink' : 'text-ink-3')
          }
          onClick={async () => {
            const dir = await window.api.system.pickDirectory()
            if (dir) {
              setWorkDir(dir)
              setError(null)
            }
          }}
        >
          <IconFolderNew />
          <span className="min-w-0 flex-1 truncate" title={workDir}>
            {workDir || '选择目录…'}
          </span>
        </button>

        <label className="mb-1 block text-xs text-ink-3">默认模型（可留空用系统默认）</label>
        <select
          className="mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          <option value="">跟随应用默认</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>

        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        {!providers.length && (
          <p className="mb-3 text-xs text-ink-3">还没有可用模型，可稍后在「设置」里添加。</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg px-4 py-1.5 text-sm text-ink-2 hover:bg-black/5"
            onClick={onClose}
          >
            取消
          </button>
          <button
            disabled={!name.trim() || !workDir || busy}
            className="rounded-lg bg-ink px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-30"
            onClick={() => void submit()}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  tasks,
  artifacts,
  latestAt,
  onOpen
}: {
  project: ProjectInfo
  tasks: number
  artifacts: number
  latestAt: number | null
  onOpen(): void
}): React.JSX.Element {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-ink-3/60 hover:shadow"
    >
      <span className="min-w-0 truncate text-sm font-semibold text-ink" title={project.name}>
        {project.name}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-ink-3" title={project.workDir}>
        {shortDir(project.workDir)}
      </span>
      <span className="mt-auto flex items-center gap-3 text-[11px] text-ink-3">
        <span>任务 {tasks}</span>
        <span>产出 {artifacts}</span>
        <span className="ml-auto tabular-nums">最近 {fmtDate(latestAt)}</span>
      </span>
    </button>
  )
}

export function ProjectsPage({ onOpen }: { onOpen(projectId: string): void }): React.JSX.Element {
  const projects = useProjectsStore((s) => s.projects)
  const stats = useProjectsStore((s) => s.stats)
  const load = useProjectsStore((s) => s.load)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-5 flex items-center">
        <h1 className="text-xl font-bold text-ink">项目空间</h1>
        <button
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-sm text-white transition hover:bg-black"
          onClick={() => setCreating(true)}
        >
          <IconFolderNew /> 新建项目
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-sm text-ink-2">还没有项目空间</p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
            空间 = 一个工作目录 + 一份项目指令。把同一件事的文件放进一个空间，任务之间共用目录，
            产出也在空间的「资产」页统一查看。
          </p>
          <button
            className="mt-4 rounded-lg bg-ink px-4 py-1.5 text-sm text-white hover:bg-black"
            onClick={() => setCreating(true)}
          >
            创建第一个空间
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              tasks={stats[p.id]?.tasks ?? 0}
              artifacts={stats[p.id]?.artifacts ?? 0}
              latestAt={stats[p.id]?.latestArtifactAt ?? null}
              onOpen={() => onOpen(p.id)}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onOpen(id)
          }}
        />
      )}
    </div>
  )
}
