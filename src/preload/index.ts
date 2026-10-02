import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AgentStreamEvent,
  AppInfo,
  AppPrefs,
  ArtifactInfo,
  ChatMessage,
  DirEntry,
  FilePreview,
  HubSearchResult,
  IdeAppView,
  McpHubSearchResult,
  McpServerInfo,
  McpServerStatus,
  McpTransport,
  ProviderConfig,
  SessionInfo,
  SkillInfo,
  StreamEvent,
  TestResult,
  UpdateEvent
} from '@shared/types'

/**
 * 渲染进程唯一能碰到的能力清单——这就是"安检桥"，
 * 任何没在这里列出的主进程功能，UI 层都够不着（比如直接读文件、执行命令）。
 */
const api = {
  settings: {
    list: (): Promise<ProviderConfig[]> => ipcRenderer.invoke(IPC_CHANNELS.SettingsList),
    upsert: (provider: ProviderConfig): Promise<ProviderConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.SettingsUpsert, provider),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SettingsRemove, id),
    test: (provider: ProviderConfig): Promise<TestResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.SettingsTest, provider)
  },
  llm: {
    start: (requestId: string, providerId: string, messages: ChatMessage[]): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.LlmChatStart, requestId, providerId, messages),
    cancel: (requestId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.LlmChatCancel, requestId),
    /** 订阅流式事件；返回取消订阅函数，组件卸载时必须调用，否则监听器会一直累积 */
    onEvent: (cb: (event: StreamEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: StreamEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.LlmEvent, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LlmEvent, listener)
    }
  },
  sessions: {
    list: (): Promise<SessionInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.SessionsList),
    create: (input: { title: string; workDir: string; providerId: string }): Promise<SessionInfo> =>
      ipcRenderer.invoke(IPC_CHANNELS.SessionsCreate, input),
    rename: (id: string, title: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.SessionsRename, id, title),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SessionsDelete, id)
  },
  messages: {
    list: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MessagesList, sessionId)
  },
  artifacts: {
    list: (sessionId: string): Promise<ArtifactInfo[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ArtifactsList, sessionId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.ArtifactsDelete, id)
  },
  workspace: {
    /** 列目录（relPath 空串为根）；主进程沙箱限在本会话 workDir 内 */
    listDir: (
      sessionId: string,
      relPath: string
    ): Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.WorkspaceListDir, sessionId, relPath),
    /** 读文本预览；二进制/超大/越界各自标记或报错 */
    readFile: (sessionId: string, relPath: string): Promise<FilePreview> =>
      ipcRenderer.invoke(IPC_CHANNELS.WorkspaceReadFile, sessionId, relPath)
  },
  skills: {
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.SkillsList),
    setEnabled: (name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SkillsSetEnabled, name, enabled),
    remove: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SkillsRemove, name),
    /** 导入技能：本地文件夹或 .zip 技能包，主进程按路径自动分派 */
    import: (sourcePath: string): Promise<{ ok: boolean; skill?: SkillInfo; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SkillsImport, sourcePath)
  },
  hub: {
    /** SkillHub 市场搜索（keyword/category/page） */
    search: (params: {
      keyword?: string
      category?: string
      page?: number
    }): Promise<{ ok: boolean; result?: HubSearchResult; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.HubSearch, params),
    /** 从市场下载并安装技能包（canonicalName + 市场显示名） */
    install: (
      canonicalName: string,
      displayName?: string
    ): Promise<{ ok: boolean; skill?: SkillInfo; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.HubInstall, canonicalName, displayName)
  },
  mcp: {
    /** 服务器列表 + 运行时状态（管理页数据源） */
    list: (): Promise<McpServerStatus[]> => ipcRenderer.invoke(IPC_CHANNELS.McpList),
    /** 登记并立即连接；连不上也保留登记（error 里说明） */
    add: (input: {
      name: string
      transport: McpTransport
      config: McpServerInfo['config']
    }): Promise<{ ok: boolean; server?: McpServerInfo; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpAdd, input),
    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpSetEnabled, id, enabled),
    remove: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpRemove, id),
    reconnect: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpReconnect, id)
  },
  mcpHub: {
    /** 魔搭 MCP 市场搜索（实时获取，不缓存） */
    search: (params: {
      keyword?: string
      page?: number
      pageSize?: number
    }): Promise<{ ok: boolean; result?: McpHubSearchResult; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpHubSearch, params),
    /** 安装：主进程拉详情解析安装计划后登记即连 */
    install: (ref: {
      path: string
      name: string
    }): Promise<{ ok: boolean; server?: McpServerInfo; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpHubInstall, ref),
    /** 魔搭访问令牌：只回掩码，不回明文 */
    getToken: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.McpHubTokenGet),
    setToken: (token: string): Promise<{ ok: boolean; masked: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.McpHubTokenSet, token)
  },
  prefs: {
    get: (): Promise<AppPrefs> => ipcRenderer.invoke(IPC_CHANNELS.PrefsGet),
    set: (prefs: Partial<AppPrefs>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.PrefsSet, prefs),
    appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.AppInfo),
    /** 清空全部本地数据（危险，渲染侧需两步确认） */
    wipe: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.DataWipe)
  },
  agent: {
    /** 发起一轮 Agent 循环；主进程会推 AgentEvent 事件流 */
    send: (
      sessionId: string,
      userText: string
    ): Promise<{ ok: boolean; turnId?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AgentSend, sessionId, userText),
    cancel: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AgentCancel, sessionId),
    /** 订阅 Agent 事件流；返回取消订阅函数 */
    onEvent: (cb: (event: AgentStreamEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: AgentStreamEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.AgentEvent, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AgentEvent, listener)
    }
  },
  permission: {
    reply: (requestId: string, approved: boolean, alwaysAllow: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.PermissionReply, requestId, approved, alwaysAllow)
  },
  updater: {
    /** 触发检查；结果与后续进度都走 onEvent 事件流（autoDownload=false） */
    check: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UpdateCheck),
    /** 用户确认后开始下载新版 */
    download: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UpdateDownload),
    /** 下载就绪后退出并以新包重装、重启 */
    install: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UpdateInstall),
    /** 订阅更新事件流；返回取消订阅函数 */
    onEvent: (cb: (event: UpdateEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: UpdateEvent): void => cb(payload)
      ipcRenderer.on(IPC_CHANNELS.UpdateEvent, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UpdateEvent, listener)
    }
  },
  system: {
    /** 弹出系统目录选择器；取消返回 null */
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DialogOpenDirectory),
    /** 弹出 .zip 技能包文件选择器；取消返回 null */
    pickZipFile: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DialogOpenZipFile),
    /** 用系统默认程序打开本地文件（产物卡片用） */
    openPath: (targetPath: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ShellOpenPath, targetPath),
    /** 用默认浏览器打开链接（仅 http/https，主进程侧把关） */
    openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ShellOpenExternal, url)
  },
  apps: {
    /** 列出可用于“打开文件夹”的应用（自动探测 + 手动，带启用/可删标记） */
    list: (): Promise<IdeAppView[]> => ipcRenderer.invoke(IPC_CHANNELS.AppsList),
    /** 手动添加一个应用（名称 + 可执行文件绝对路径） */
    addCustom: (
      name: string,
      exePath: string
    ): Promise<{ ok: boolean; error?: string; apps?: IdeAppView[] }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AppsAddCustom, name, exePath),
    /** 删除手动添加的应用（自动项不可删，只能停用） */
    remove: (id: string): Promise<{ ok: boolean; apps?: IdeAppView[] }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AppsRemove, id),
    /** 启用/停用某个应用（停用=从任务菜单隐藏，不删数据） */
    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean; apps?: IdeAppView[] }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AppsSetEnabled, id, enabled),
    /** 用指定应用打开文件夹（主进程按 id 解析 exe 路径） */
    openFolder: (id: string, folder: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AppsOpenFolder, id, folder)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
