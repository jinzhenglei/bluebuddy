/** IPC 信道名：main / preload / renderer 三端共享，避免字符串拼写不一致 */
export const IPC_CHANNELS = {
  // 一问一答（invoke/handle）
  SettingsList: 'settings:list',
  SettingsUpsert: 'settings:upsert',
  SettingsRemove: 'settings:remove',
  SettingsTest: 'settings:test',
  LlmChatStart: 'llm:chat-start',
  LlmChatCancel: 'llm:chat-cancel',
  // 事件流（on/send）：主进程主动推送给发起请求的那个渲染进程
  LlmEvent: 'llm:event',

  // 会话与产物
  SessionsList: 'sessions:list',
  SessionsCreate: 'sessions:create',
  SessionsRename: 'sessions:rename',
  SessionsDelete: 'sessions:delete',
  MessagesList: 'messages:list',
  ArtifactsList: 'artifacts:list',
  ArtifactsDelete: 'artifacts:delete',

  // Agent 循环（阶段 2）
  AgentSend: 'agent:send',
  AgentCancel: 'agent:cancel',
  AgentEvent: 'agent:event',
  PermissionReply: 'permission:reply',

  // 系统能力桥（阶段 2）：渲染进程想"选目录/打开文件/开外链"，
  // 必须走这三个白名单信道，而不是直接拿到 fs/shell 对象
  DialogOpenDirectory: 'dialog:open-directory',
  DialogOpenZipFile: 'dialog:open-zip-file',
  ShellOpenPath: 'shell:open-path',
  ShellOpenExternal: 'shell:open-external',

  // 工作区只读浏览（右侧结果区文件 Tab）：沙箱根为会话 workDir，主进程侧把关
  WorkspaceListDir: 'workspace:list-dir',
  WorkspaceReadFile: 'workspace:read-file',

  // 技能管理（Stage 4）：列表/启停/删除/本地导入
  SkillsList: 'skills:list',
  SkillsSetEnabled: 'skills:set-enabled',
  SkillsRemove: 'skills:remove',
  SkillsImport: 'skills:import',
  HubSearch: 'hub:search',
  HubInstall: 'hub:install',
  McpList: 'mcp:list',
  McpAdd: 'mcp:add',
  McpSetEnabled: 'mcp:set-enabled',
  McpRemove: 'mcp:remove',
  McpReconnect: 'mcp:reconnect',
  McpHubSearch: 'mcp-hub:search',
  McpHubInstall: 'mcp-hub:install',
  McpHubTokenGet: 'mcp-hub:token-get',
  McpHubTokenSet: 'mcp-hub:token-set',

  // 应用级偏好（settings_kv 承载）：默认模型/默认工作目录/批准策略；关于与清空数据
  PrefsGet: 'prefs:get',
  PrefsSet: 'prefs:set',
  AppInfo: 'app:info',
  DataWipe: 'app:data-wipe',

  // 自动更新（阶段 7）：检查/下载/重启安装 三个 invoke + 一个事件流 send
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',
  UpdateEvent: 'update:event',

  // 外部应用（IDE）集成：列表/添加手动/删除或停用/用指定应用打开文件夹
  AppsList: 'apps:list',
  AppsAddCustom: 'apps:add-custom',
  AppsRemove: 'apps:remove',
  AppsSetEnabled: 'apps:set-enabled',
  AppsOpenFolder: 'apps:open-folder'
} as const
