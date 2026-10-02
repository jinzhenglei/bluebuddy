import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SettingsStore, electronCrypto, defaultSettingsFilePath } from './settings'
import { DbStore } from './db/store'
import { PermissionGate } from './permissions/gate'
import { createDefaultRegistry } from './tools'
import { SkillRegistry } from './skills/registry'
import { SkillManager } from './skills/manager'
import { HubClient } from './skills/hub'
import { McpManager } from './mcp/manager'
import { MsHubClient } from './mcp/hub'
import { HubTokenStore } from './mcp/token'
import { registerIpcHandlers } from './ipc'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f4f7',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 应用自身加载地址（dev 为本地 vite 服务，prod 为 file://index.html），用于区分“内部导航”与“外链”
  const rendererHref =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(join(__dirname, '../renderer/index.html')).href

  // Markdown 正文里的普通链接（无 target=_blank）点击会触发同窗口导航，把 app 自身导航走；
  // 这里拦截非应用来源的外部 http(s) 链接转系统浏览器。注：loadURL/loadFile 不触发 will-navigate，首屏不受影响。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url, rendererHref)) return
    event.preventDefault()
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
    } catch {
      /* 非法 URL：既不导航也不打开，直接忽略 */
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 目标 URL 是否为应用自身页面（dev 同源本地服务；prod 同一 index.html）；其余视为外链 */
function isInternalNavigation(url: string, appHref: string): boolean {
  try {
    const target = new URL(url)
    const base = new URL(appHref)
    if (base.protocol === 'file:') return target.href === base.href
    return target.origin === base.origin
  } catch {
    return false
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // safeStorage / app.getPath 都依赖 app ready 之后才可调用，因此在这里初始化
  const settingsStore = new SettingsStore(defaultSettingsFilePath(), electronCrypto)
  const dbStore = new DbStore(join(app.getPath('userData'), 'bluebuddy.db'))
  const gate = new PermissionGate()
  // 启动时恢复持久化的「自动允许全部」策略（用户在设置页显式写入，危险但跨重启生效）
  gate.setAutoApprove(dbStore.getKv('approval_mode') === 'auto')
  const registry = createDefaultRegistry()

  // 技能运行时（阶段 3）+ 管理（阶段 4）：SkillManager 协调磁盘 × DB 启用状态，
  // 只把「磁盘存在且 enabled」的技能放进 registry，并据此上架/下架 use_skill。
  const skillsRoot = join(app.getPath('userData'), 'skills')
  const skillRegistry = new SkillRegistry()
  const skillManager = new SkillManager({
    rootDir: skillsRoot,
    db: dbStore,
    skillRegistry,
    toolRegistry: registry
  })
  await skillManager.init()
  const hub = new HubClient()

  // MCP 连接器（阶段 5）：启动时并行连所有启用服务器，
  // 远端工具包装成 mcp_ 前缀本地工具并入 registry（一律走批准）。
  const mcp = new McpManager({ db: dbStore, toolRegistry: registry })
  await mcp.init()
  // 魔搭 MCP 市场：搜索实时拉取不落库；Token 加密存 settings_kv（仅供拉 Hosted 专属地址）
  const mcpHub = new MsHubClient()
  const mcpToken = new HubTokenStore(dbStore, electronCrypto)

  registerIpcHandlers({
    settings: settingsStore,
    db: dbStore,
    gate,
    registry,
    skillRegistry,
    skills: skillManager,
    skillsRoot,
    hub,
    mcp,
    mcpHub,
    mcpToken
  })

  createWindow()

  app.on('before-quit', () => {
    void mcp.shutdown()
    try {
      dbStore.close()
    } catch {
      /* ignore */
    }
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
