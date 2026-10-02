import { useEffect, useState } from 'react'
import { useAgentStore } from '@renderer/stores/agent'
import type { ArtifactInfo } from '@shared/types'

/**
 * 右侧结果区（U4，WorkBuddy 式）：产物 / 文件 双 Tab + 文本预览。
 * 文件树懒加载、只读；一切路径由主进程 browse 层沙箱在会话 workDir 内。
 */

interface PreviewState {
  title: string
  /** 文本内容；null 表示不可预览（二进制/读失败/加载中），配 note 说明 */
  content: string | null
  note: string | null
  /** 「系统程序打开」按钮目标；null 不显示按钮 */
  openTarget: { kind: 'path' | 'external'; target: string } | null
}

type DirState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ok'; entries: import('@shared/types').DirEntry[] }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function ResultPanel({
  sessionId,
  onClose
}: {
  sessionId: string
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'artifacts' | 'files'>('artifacts')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [dirs, setDirs] = useState<Record<string, DirState>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const artifacts = useAgentStore((s) => s.artifacts)
  const loadArtifacts = useAgentStore((s) => s.loadArtifacts)
  const workDir = useAgentStore((s) => s.sessions.find((x) => x.id === sessionId)?.workDir)

  useEffect(() => {
    void loadArtifacts()
  }, [sessionId, loadArtifacts])

  const loadDir = (rel: string): void => {
    setDirs((d) => (d[rel] ? d : { ...d, [rel]: { status: 'loading' } }))
    void window.api.workspace.listDir(sessionId, rel).then((res) => {
      setDirs((d) => ({
        ...d,
        [rel]:
          res.ok && res.entries
            ? { status: 'ok', entries: res.entries }
            : { status: 'error', error: res.error ?? '加载失败' }
      }))
    })
  }

  /** 预览工作区文本文件；二进制/超大/读失败各自降级提示 */
  const openFile = (relPath: string, name: string): void => {
    setPreview({ title: name, content: null, note: '加载中…', openTarget: null })
    void window.api.workspace.readFile(sessionId, relPath).then((r) => {
      const base = workDir ? workDir.replace(/[/\\]+$/, '') : ''
      const openTarget = base ? { kind: 'path' as const, target: `${base}/${relPath}` } : null
      if (!r.ok) {
        setPreview({ title: name, content: null, note: r.error ?? '读取失败', openTarget })
      } else if (r.binary) {
        setPreview({
          title: name,
          content: null,
          note: '二进制文件暂不支持预览，可点右上角用系统程序打开。',
          openTarget
        })
      } else {
        setPreview({
          title: name,
          content: r.content ?? '',
          note: r.truncated ? '文件较大，仅预览前 256KB。' : null,
          openTarget
        })
      }
    })
  }

  const openArtifact = (a: ArtifactInfo): void => {
    if (a.kind === 'link') {
      void window.api.system.openExternal(a.url ?? '')
      return
    }
    if (a.relPath) openFile(a.relPath, a.name)
    else void window.api.system.openPath(a.absPath ?? '')
  }

  const doOpen = (t: { kind: 'path' | 'external'; target: string }): void => {
    if (t.kind === 'path') void window.api.system.openPath(t.target)
    else void window.api.system.openExternal(t.target)
  }

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
          onClick={() => openFile(e.relPath, e.name)}
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

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      {preview ? (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            <button
              onClick={() => setPreview(null)}
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
                onClick={() => doOpen(preview.openTarget!)}
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
        </>
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
            <button
              onClick={() => setTab('artifacts')}
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
                loadDir('')
              }}
              className={
                'rounded-md px-2.5 py-1 text-[13px] ' +
                (tab === 'files'
                  ? 'bg-black/5 font-semibold text-ink'
                  : 'text-ink-3 hover:text-ink')
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
          <div className="flex-1 overflow-y-auto py-1">
            {tab === 'artifacts' ? (
              artifacts.length === 0 ? (
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
              )
            ) : (
              renderDir('', 0)
            )}
          </div>
        </>
      )}
    </aside>
  )
}
