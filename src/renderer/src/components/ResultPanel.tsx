import { useEffect, useMemo, useState } from 'react'
import { useAgentStore } from '@renderer/stores/agent'
import { PreviewPane, WorkspaceTree } from '@renderer/components/WorkspaceBrowser'
import { useWorkspacePreview } from '@renderer/components/workspace-preview'
import type { ArtifactInfo } from '@shared/types'

/**
 * 右侧结果区（U4，WorkBuddy 式）：产物 / 文件 双 Tab + 文本预览。
 * 目录树与预览复用 WorkspaceBrowser（与项目空间资产页同一实现）；只读，
 * 沙箱根为本会话 workDir，越界由主进程 browse 层拒绝。
 */

export function ResultPanel({
  sessionId,
  onClose
}: {
  sessionId: string
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'artifacts' | 'files'>('artifacts')

  const artifacts = useAgentStore((s) => s.artifacts)
  const loadArtifacts = useAgentStore((s) => s.loadArtifacts)
  const workDir = useAgentStore((s) => s.sessions.find((x) => x.id === sessionId)?.workDir ?? '')

  // 引用稳定：浏览根选择器进子组件依赖数组，每次渲染新建会让树反复重拉
  const target = useMemo(() => ({ sessionId }), [sessionId])
  const { preview, openFile, close } = useWorkspacePreview(target, workDir)

  useEffect(() => {
    void loadArtifacts()
  }, [sessionId, loadArtifacts])

  const openArtifact = (a: ArtifactInfo): void => {
    if (a.kind === 'link') {
      void window.api.system.openExternal(a.url ?? '')
      return
    }
    if (a.relPath) openFile(a.relPath, a.name)
    else void window.api.system.openPath(a.absPath ?? '')
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
        <button
          onClick={() => {
            setTab('artifacts')
            close()
          }}
          className={
            'rounded-md px-2.5 py-1 text-[13px] ' +
            (tab === 'artifacts'
              ? 'bg-black/5 font-semibold text-ink'
              : 'text-ink-3 hover:text-ink')
          }
        >
          产物{artifacts.length > 0 ? ` (${artifacts.length})` : ''}
        </button>
        <button
          onClick={() => {
            setTab('files')
            close()
          }}
          className={
            'rounded-md px-2.5 py-1 text-[13px] ' +
            (tab === 'files' ? 'bg-black/5 font-semibold text-ink' : 'text-ink-3 hover:text-ink')
          }
        >
          文件
        </button>
        <button
          onClick={onClose}
          title="收起结果区"
          className="ml-auto rounded-md p-1 text-ink-3 hover:bg-black/5 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {/* 预览占用内容区：顶栏 Tab 仍在，随时可切回产物列表 */}
      {preview ? (
        <PreviewPane preview={preview} onBack={close} />
      ) : tab === 'artifacts' ? (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {artifacts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-ink-3">
              还没有产物。Agent 写入文件或抓取网页时，结果会登记在这里。
            </p>
          ) : (
            artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() => openArtifact(a)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-black/5"
              >
                <span className="text-sm">{a.kind === 'link' ? '🔗' : '📄'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{a.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    {a.kind === 'link' ? a.url : a.relPath}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        // key 按会话重置内部目录展开态
        <WorkspaceTree key={sessionId} target={target} onOpenFile={openFile} />
      )}
    </aside>
  )
}
