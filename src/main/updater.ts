import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateEvent } from '@shared/types'

/** 把更新事件转发回发起检查的那个渲染进程 */
export type UpdateEmitter = (e: UpdateEvent) => void

let wired = false
let feedConfigured = false
let emitter: UpdateEmitter | null = null

function emit(e: UpdateEvent): void {
  emitter?.(e)
}

/** 事件监听只注册一次，避免每次检查都叠加回调 */
function wireOnce(): void {
  if (wired) return
  wired = true
  autoUpdater.logger = null
  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    emit({
      phase: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  )
  autoUpdater.on('update-not-available', (info) =>
    emit({ phase: 'not-available', version: info?.version ?? app.getVersion() })
  )
  autoUpdater.on('download-progress', (p) =>
    emit({ phase: 'progress', percent: p.percent, transferred: p.transferred, total: p.total })
  )
  autoUpdater.on('update-downloaded', (info) =>
    emit({ phase: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => emit({ phase: 'error', message: err?.message ?? String(err) }))
}

/**
 * feed 源只配置一次：
 * - 默认走打包内置的 publish 配置（electron-builder.yml 里的 GitHub Releases）。
 * - 若设置环境变量 BB_UPDATE_FEED_URL（本地 http 服务器自测升级闭环用），改走 generic
 *   provider 指向该地址；生产环境不设此变量即自动回到 GitHub。
 */
function configureFeedOnce(): void {
  if (feedConfigured) return
  feedConfigured = true
  // 发现新版后不自动下载，等 UI 触发 downloadUpdate()
  autoUpdater.autoDownload = false
  // 下载完成后若用户没点"立即重启"，则在下次退出时自动安装
  autoUpdater.autoInstallOnAppQuit = true
  const feedUrl = process.env.BB_UPDATE_FEED_URL
  if (feedUrl) autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
}

export async function checkUpdate(e: UpdateEmitter): Promise<void> {
  wireOnce()
  emitter = e
  // electron-updater 仅在打包安装态可用；dev/preview 下直接给友好提示，不去触碰它会抛错的分支
  if (!app.isPackaged) {
    emit({ phase: 'error', message: '开发模式不支持自动更新，请使用打包安装后的应用测试。' })
    return
  }
  configureFeedOnce()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ phase: 'error', message: (err as Error)?.message ?? String(err) })
  }
}

export async function downloadUpdate(e: UpdateEmitter): Promise<void> {
  emitter = e
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ phase: 'error', message: (err as Error)?.message ?? String(err) })
  }
}

/** 以已下载的新包退出并覆盖安装、重启应用 */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
