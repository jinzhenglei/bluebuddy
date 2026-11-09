import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '@shared/ipc'
import type { UpdateEvent } from '@shared/types'

/** 最近一次更新事件快照：供新打开/重载后的 UI 立即恢复「下载中/已就绪」等状态 */
let lastEvent: UpdateEvent | null = null

let wired = false
let feedConfigured = false
let autoStarted = false

/** 更新事件广播给所有窗口，并记一份快照供 getUpdateStatus 查询 */
function emit(e: UpdateEvent): void {
  lastEvent = e
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.UpdateEvent, e)
  }
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
  // 发现新版后自动下载（后台静默进行，UI 按 phase 事件展示进度/就绪提示）
  autoUpdater.autoDownload = true
  // 下载完成后若用户没点"立即重启"，则在下次退出时自动安装
  autoUpdater.autoInstallOnAppQuit = true
  const feedUrl = process.env.BB_UPDATE_FEED_URL
  if (feedUrl) autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
}

/** 查询最近一次更新事件快照（窗口重载后恢复状态用） */
export function getUpdateStatus(): UpdateEvent | null {
  return lastEvent
}

/**
 * 自动检测更新（仅打包安装态）：启动后延迟首查，之后周期性复查。
 * 发现新版即自动下载（autoDownload=true），下载完成事件广播给 UI，
 * 由左下角菜单提示用户「点击安装」。
 */
export function startAutoUpdate(delayMs = 10_000, intervalMs = 4 * 60 * 60 * 1000): void {
  if (autoStarted || !app.isPackaged) return
  autoStarted = true
  wireOnce()
  configureFeedOnce()
  // 首查延后一点，避免和启动加载抢资源
  setTimeout(() => {
    void autoCheck()
    setInterval(() => void autoCheck(), intervalMs)
  }, delayMs)
}

/** 后台静默检查：断网等异常不打扰用户（error 事件仍会广播），等下个周期再查 */
async function autoCheck(): Promise<void> {
  const phase = lastEvent?.phase
  // 下载中/已就绪不必再查，避免打断下载或把「安装更新」提示顶掉
  if (phase === 'progress' || phase === 'downloaded') return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* 静默忽略，下个周期重试 */
  }
}

export async function checkUpdate(): Promise<void> {
  wireOnce()
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

export async function downloadUpdate(): Promise<void> {
  wireOnce()
  configureFeedOnce()
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
