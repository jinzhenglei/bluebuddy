import { useEffect, useState } from 'react'
import type { UpdateEvent } from '@shared/types'

/** 字节转 MB，保留 1 位小数 */
function toMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

interface Props {
  /** 当前安装版本，用于展示「已是最新」 */
  version: string
  onClose: () => void
}

/**
 * 检查更新弹窗（阶段 7）：挂载即订阅事件流并触发一次检查，按 autoUpdater 推进的
 * phase 渲染 检查中 / 已是最新 / 发现新版(确认下载) / 下载进度 / 已就绪(重启安装) / 失败。
 * autoDownload=false，故发现新版后需用户点「下载更新」才开始下载。
 */
export function UpdateDialog({ version, onClose }: Props): React.JSX.Element {
  const [ev, setEv] = useState<UpdateEvent | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.updater.onEvent(setEv)
    void window.api.updater.check()
    return unsubscribe
  }, [])

  const phase = ev?.phase ?? 'checking'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">检查更新</h2>

        {phase === 'checking' && <p className="text-[13px] text-ink-2">正在检查更新…</p>}

        {phase === 'not-available' && (
          <p className="text-[13px] text-ink-2">当前已是最新版本 v{version}。</p>
        )}

        {ev && ev.phase === 'available' && (
          <div className="text-[13px] text-ink-2">
            <p>
              发现新版本 <span className="font-semibold text-ink">v{ev.version}</span>
              （当前 v{version}）。
            </p>
            {ev.releaseNotes && (
              <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 text-xs text-ink-2">
                {ev.releaseNotes}
              </p>
            )}
          </div>
        )}

        {ev && ev.phase === 'progress' && (
          <div className="text-[13px] text-ink-2">
            <div className="mb-1.5 flex justify-between">
              <span>正在下载更新…</span>
              <span>{Math.round(ev.percent)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, ev.percent)}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-ink-3">
              {toMB(ev.transferred)} MB / {toMB(ev.total)} MB
            </div>
          </div>
        )}

        {phase === 'downloaded' && (
          <p className="text-[13px] text-ink-2">新版本已下载完成，重启后即可完成安装。</p>
        )}

        {ev && ev.phase === 'error' && (
          <p className="text-[13px] leading-relaxed text-red-500">{ev.message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg px-4 py-1.5 text-sm text-ink-2 hover:bg-black/5"
            onClick={onClose}
            disabled={phase === 'progress'}
          >
            {phase === 'downloaded' ? '稍后' : '关闭'}
          </button>
          {phase === 'available' && (
            <button
              className="rounded-lg bg-brand px-4 py-1.5 text-sm text-white hover:opacity-90"
              onClick={() => void window.api.updater.download()}
            >
              下载更新
            </button>
          )}
          {phase === 'downloaded' && (
            <button
              className="rounded-lg bg-brand px-4 py-1.5 text-sm text-white hover:opacity-90"
              onClick={() => void window.api.updater.install()}
            >
              立即重启安装
            </button>
          )}
          {phase === 'error' && (
            <button
              className="rounded-lg bg-ink px-4 py-1.5 text-sm text-white hover:opacity-90"
              onClick={() => {
                setEv(null)
                void window.api.updater.check()
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
