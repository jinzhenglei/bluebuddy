import { useCallback, useState } from 'react'
import type { BrowseTarget } from '@shared/types'

/**
 * 工作区文本预览状态机（与 WorkspaceTree / PreviewPane 配套，
 * 对话页结果区与项目空间资产页共用）。
 * 单独成文件而非放组件里：react-refresh 要求组件文件不导出非组件。
 */

export interface PreviewState {
  title: string
  /** 文本内容；null 表示不可预览（二进制/读失败/加载中），配 note 说明 */
  content: string | null
  note: string | null
  /** 「系统程序打开」按钮目标；null 不显示按钮 */
  openTarget: { kind: 'path' | 'external'; target: string } | null
}

export function useWorkspacePreview(
  target: BrowseTarget,
  rootDir: string
): {
  preview: PreviewState | null
  openFile: (relPath: string, name: string) => void
  close: () => void
} {
  const [preview, setPreview] = useState<PreviewState | null>(null)

  /** 读文本预览；二进制/超大/读失败各自降级提示 */
  const openFile = useCallback(
    (relPath: string, name: string): void => {
      setPreview({ title: name, content: null, note: '加载中…', openTarget: null })
      void window.api.workspace.readFile(target, relPath).then((r) => {
        const base = rootDir ? rootDir.replace(/[/\\]+$/, '') : ''
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
    },
    [target, rootDir]
  )

  const close = useCallback(() => setPreview(null), [])
  return { preview, openFile, close }
}
