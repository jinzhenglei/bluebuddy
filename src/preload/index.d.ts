import { ElectronAPI } from '@electron-toolkit/preload'
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

interface SettingsApi {
  list: () => Promise<ProviderConfig[]>
  upsert: (provider: ProviderConfig) => Promise<ProviderConfig>
  remove: (id: string) => Promise<void>
  test: (provider: ProviderConfig) => Promise<TestResult>
}

interface LlmApi {
  start: (requestId: string, providerId: string, messages: ChatMessage[]) => Promise<void>
  cancel: (requestId: string) => Promise<void>
  onEvent: (cb: (event: StreamEvent) => void) => () => void
}

interface SessionsApi {
  list: () => Promise<SessionInfo[]>
  create: (input: { title: string; workDir: string; providerId: string }) => Promise<SessionInfo>
  rename: (id: string, title: string) => Promise<void>
  delete: (id: string) => Promise<void>
}

interface MessagesApi {
  list: (sessionId: string) => Promise<ChatMessage[]>
}

interface ArtifactsApi {
  list: (sessionId: string) => Promise<ArtifactInfo[]>
  delete: (id: string) => Promise<void>
}

interface WorkspaceApi {
  listDir: (
    sessionId: string,
    relPath: string
  ) => Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }>
  readFile: (sessionId: string, relPath: string) => Promise<FilePreview>
}

interface SkillsApi {
  list: () => Promise<SkillInfo[]>
  setEnabled: (name: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  remove: (name: string) => Promise<{ ok: boolean; error?: string }>
  import: (sourcePath: string) => Promise<{ ok: boolean; skill?: SkillInfo; error?: string }>
}

interface HubApi {
  search: (params: {
    keyword?: string
    category?: string
    page?: number
  }) => Promise<{ ok: boolean; result?: HubSearchResult; error?: string }>
  install: (
    canonicalName: string,
    displayName?: string
  ) => Promise<{ ok: boolean; skill?: SkillInfo; error?: string }>
}

interface McpApi {
  list: () => Promise<McpServerStatus[]>
  add: (input: {
    name: string
    transport: McpTransport
    config: McpServerInfo['config']
    displayName?: string
    hubId?: string
  }) => Promise<{ ok: boolean; server?: McpServerInfo; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  remove: (id: string) => Promise<{ ok: boolean }>
  reconnect: (id: string) => Promise<{ ok: boolean; error?: string }>
}

interface McpHubApi {
  search: (params: {
    keyword?: string
    page?: number
    pageSize?: number
  }) => Promise<{ ok: boolean; result?: McpHubSearchResult; error?: string }>
  install: (ref: {
    path: string
    name: string
  }) => Promise<{ ok: boolean; server?: McpServerInfo; error?: string }>
  getToken: () => Promise<string>
  setToken: (token: string) => Promise<{ ok: boolean; masked: string }>
}

interface AgentApi {
  send: (
    sessionId: string,
    userText: string
  ) => Promise<{ ok: boolean; turnId?: string; error?: string }>
  cancel: (sessionId: string) => Promise<{ ok: boolean }>
  onEvent: (cb: (event: AgentStreamEvent) => void) => () => void
}

interface PermissionApi {
  reply: (requestId: string, approved: boolean, alwaysAllow: boolean) => Promise<void>
}

interface SystemApi {
  pickDirectory: () => Promise<string | null>
  pickZipFile: () => Promise<string | null>
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
}

interface PrefsApi {
  get: () => Promise<AppPrefs>
  set: (prefs: Partial<AppPrefs>) => Promise<{ ok: boolean }>
  appInfo: () => Promise<AppInfo>
  wipe: () => Promise<{ ok: boolean }>
}

interface UpdaterApi {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  onEvent: (cb: (event: UpdateEvent) => void) => () => void
}

interface AppsApi {
  list: () => Promise<IdeAppView[]>
  addCustom: (
    name: string,
    exePath: string
  ) => Promise<{ ok: boolean; error?: string; apps?: IdeAppView[] }>
  remove: (id: string) => Promise<{ ok: boolean; apps?: IdeAppView[] }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; apps?: IdeAppView[] }>
  openFolder: (id: string, folder: string) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      settings: SettingsApi
      llm: LlmApi
      sessions: SessionsApi
      messages: MessagesApi
      artifacts: ArtifactsApi
      workspace: WorkspaceApi
      skills: SkillsApi
      hub: HubApi
      mcp: McpApi
      mcpHub: McpHubApi
      prefs: PrefsApi
      agent: AgentApi
      permission: PermissionApi
      system: SystemApi
      updater: UpdaterApi
      apps: AppsApi
    }
  }
}
