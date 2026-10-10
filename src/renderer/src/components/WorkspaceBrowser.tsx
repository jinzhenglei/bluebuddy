import { useCallback, useEffect, useState } from 'react'
import type { BrowseTarget, DirEntry } from '@shared/types'
import type { PreviewState } from './workspace-preview'
export type { PreviewState } from './workspace-preview'

/**
 * 工作区只读浏览复用件（对话页结果区 / 项目空间资产页共用同一实现）：
 * - WorkspaceTree：懒加载目录树，点文件回调给宿主（宿主决定预览渲染位置）
 * - PreviewPane：预览面板（返回 / 用系统程序打开 / 二进制与超大降级文案）
 * 预览状态机在 ./workspace-preview 里（组件文件不导出非组件，否则 fast refresh 失效）。
 *
 * 沙箱根由主进程 resolveBrowseRoot 依 target 解析（会话 workDir 或空间 work_dir），
 * 越界在 browse 层被拒；本组件只负责呈现。
 */

type DirState =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; entries: DirEntry[] }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 预览面板：返回按钮 + 标题 + 系统程序打开 + 正文 */
export function PreviewPane({
  preview,
  onBack
}: {
  preview: PreviewState
  onBack: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button
          onClick={onBack}
          title="返回"
          className="rounded-md p-1 text-ink-3 hover:bg-black/5 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {preview.title}
        </span>
        {preview.openTarget && (
          <button
            onClick={() => {
              const t = preview.openTarget!
              if (t.kind === 'path') void window.api.system.openPath(t.target)
              else void window.api.system.openExternal(t.target)
            }}
            title="用系统程序打开"
            className="rounded-md p-1 text-ink-3 hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
              <path
                d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {preview.note && <p className="mb-2 text-xs text-ink-3">{preview.note}</p>}
        {preview.content !== null && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink">
            {preview.content}
          </pre>
        )}
      </div>
    </div>
  )
}

/** 懒加载目录树；切浏览根时由调用方用 key 重挂载，内部状态随之作废 */
export function WorkspaceTree({
  target,
  onOpenFile
}: {
  /** 浏览根选择器；调用方需用 useMemo 保持引用稳定 */
  target: BrowseTarget
  onOpenFile: (relPath: string, name: string) => void
}): React.JSX.Element {
  // 根目录首帧即处于 loading，避免在 effect 体内同步 setState
  const [dirs, setDirs] = useState<Record<string, DirState>>({ '': { status: 'loading' } })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  /** 拉取指定相对路径的条目，返回后才写状态 */
  const fetchDir = useCallback(
    (rel: string): void => {
      void window.api.workspace.listDir(target, rel).then((res) => {
        setDirs((d) => ({
          ...d,
          [rel]:
            res.ok && res.entries
              ? { status: 'ok', entries: res.entries }
              : { status: 'error', error: res.error ?? '加载失败' }
        }))
      })
    },
    [target]
  )

  /** 展开子目录：先置 loading 占位再拉数据 */
  const loadDir = (rel: string): void => {
    setDirs((d) => (d[rel] ? d : { ...d, [rel]: { status: 'loading' } }))
    fetchDir(rel)
  }

  useEffect(() => {
    fetchDir('')
  }, [fetchDir])

  const renderDir = (rel: string, depth: number): React.JSX.Element[] => {
    const pad = { paddingLeft: 12 + depth * 14 }
    const st = dirs[rel]
    if (!st || st.status === 'loading') {
      return [
        <p key={`ld-${rel}`} style={pad} className="py-1.5 text-xs text-ink-3">
          加载中…
        </p>
      ]
    }
    if (st.status === 'error') {
      return [
        <p key={`er-${rel}`} style={pad} className="py-1.5 text-xs text-red-500">
          {st.error}
        </p>
      ]
    }
    if (st.entries.length === 0) {
      return [
        <p key={`mt-${rel}`} style={pad} className="py-1.5 text-xs text-ink-3">
          （空目录）
        </p>
      ]
    }
    return st.entries.flatMap((e) => {
      if (e.isDir) {
        const open = !!expanded[e.relPath]
        return [
          <button
            key={e.relPath}
            style={pad}
            onClick={() => {
              if (!open) loadDir(e.relPath)
              setExpanded((x) => ({ ...x, [e.relPath]: !open }))
            }}
            className="flex w-full items-center gap-1.5 py-1.5 pr-3 text-left text-[13px] text-ink hover:bg-black/5"
          >
            <span className="w-2.5 shrink-0 text-[9px] text-ink-3">{open ? '▼' : '▶'}</span>
            <span>📁</span>
            <span className="truncate">{e.name}</span>
          </button>,
          ...(open ? renderDir(e.relPath, depth + 1) : [])
        ]
      }
      return [
        <button
          key={e.relPath}
          style={pad}
          onClick={() => onOpenFile(e.relPath, e.name)}
          className="flex w-full items-center gap-1.5 py-1.5 pr-3 text-left text-[13px] text-ink-2 hover:bg-black/5 hover:text-ink"
        >
          <span className="w-2.5 shrink-0" />
          <span className="text-xs">📄</span>
          <span className="truncate">{e.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-ink-3">{fmtSize(e.size)}</span>
        </button>
      ]
    })
  }

  return <div className="min-h-0 flex-1 overflow-y-auto py-1">{renderDir('', 0)}</div>
}
