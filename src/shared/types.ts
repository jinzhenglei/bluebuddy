/**
 * 主进程与渲染进程共享的类型定义。
 * 放在 src/shared 下，通过 @shared/* 别名引用，两侧 tsconfig 都 include 了这个目录。
 */

/** 一家模型服务的接入配置（OpenAI 兼容端点） */
export interface ProviderConfig {
  /** 稳定 id，用于增删改查与 UI 选中 */
  id: string
  /** 展示名，如 "小米 Mimo"、"本地 Ollama" */
  name: string
  /** OpenAI 兼容 baseUrl，形如 https://api.xiaomimimo.com/v1 或 http://localhost:11434/v1 */
  baseUrl: string
  /** 模型名，如 mimo-v2.6-flash、qwen2.5 */
  model: string
  /**
   * API Key。注意：渲染进程拿到的永远是掩码（如 "sk-****abcd"），
   * 真实 Key 只在主进程内存与加密文件中存在，绝不下发。
   */
  apiKey: string
  /** 是否为本次请求开启流式输出 */
  streaming: boolean
}

/**
 * OpenAI function-calling 协议里的一次工具调用请求。
 * arguments 是 **JSON 字符串**（不是对象），这是 OpenAI 协议的地道约定，
 * 我们需要在 registry 里 JSON.parse 后再用 zod 校验。
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 一条聊天消息，与 OpenAI messages 数组字段对齐 */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export interface ChatMessage {
  role: ChatRole
  /** tool 角色消息此字段填工具执行结果的字符串表示 */
  content: string
  /** assistant 消息可能触发 0..N 次工具调用 */
  tool_calls?: ToolCall[]
  /** assistant 消息的思考过程（模型 reasoning 内容）；落库可回看，喂回 LLM 时剥离 */
  reasoning?: string
  /** 落库时间戳（DB 读出时带上）；UI 用于计算 turn 耗时等，喂回 LLM 时剥离 */
  createdAt?: number
  /** tool 角色消息必须回指它响应的 tool_call.id */
  tool_call_id?: string
  /** tool 角色消息可选：工具名，便于 UI 与调试 */
  name?: string
}

/** 连通性测试结果 */
export interface TestResult {
  ok: boolean
  /** 失败原因或成功提示（模型返回的第一个字） */
  message?: string
}

/** streamChat 产出的事件类型，UI 按 type 分支处理 */
export type StreamEvent =
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string }

/** 一次会话的元信息 */
export interface SessionInfo {
  id: string
  title: string
  workDir: string
  providerId: string
  createdAt: number
}

/** 产物记录（与主进程 DbStore 保持列段同构，relPath/url 其中一个未设时为 undefined） */
export interface ArtifactInfo {
  id: string
  sessionId: string
  callId: string
  kind: 'file' | 'link'
  name: string
  relPath?: string
  url?: string
  /** 主进程下发的绝对路径（file 类产物才有），供 shell.openPath 直接使用 */
  absPath?: string
  createdAt: number
}

/** 技能信息（Stage 4 管理页列表行）：磁盘元数据 + 库内启用状态 */
export interface SkillInfo {
  name: string
  description: string
  /** 技能目录绝对路径 */
  dir: string
  enabled: boolean
  createdAt: number
  /** 市场显示名（中文真名）；展示优先用它，空则回退 name */
  displayName?: string | null
}

/** SkillHub 市场技能卡片（api.skillhub.cn /api/skills 的精简投影） */
export interface HubSkill {
  /** 公开 slug，如 excel-merge */
  slug: string
  /** 规范名 @handle/slug，下载接口用它 */
  canonicalName: string
  name: string
  description: string
  descriptionZh: string
  downloads: number
  stars: number
  iconUrl: string | null
  category: string
  version: string
  requiresApiKey: boolean
}

export interface HubSearchResult {
  skills: HubSkill[]
  total: number
  page: number
}

/** MCP 服务器传输方式（Stage 5） */
export type McpTransport = 'stdio' | 'http'

export interface McpStdioConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpHttpConfig {
  url: string
  headers?: Record<string, string>
  /** true 用 SSE 传输；默认 Streamable HTTP（魔搭托管端点两种都有） */
  sse?: boolean
}

export interface McpServerInfo {
  id: string
  name: string
  transport: McpTransport
  config: McpStdioConfig | McpHttpConfig
  enabled: boolean
  createdAt: number
  /** 市场中文展示名（手动添加为空） */
  displayName?: string
  /** 来源市场 id（path/name）；手动添加为空，市场卡片据此打「已安装」标记 */
  hubId?: string
  // ---- 市场元数据（安装时快照落库，供详情页展示；手动添加为空）----
  /** 一句话简介（魔搭 AbstractCN） */
  description?: string
  /** 分类标签 */
  category?: string[]
  /** 项目主页（魔搭 FromSiteUrl，如 GitHub） */
  sourceUrl?: string
  /** 市场收藏数 */
  stars?: number
  /** 市场调用量 */
  callVolume?: number
  // ---- 市场文档快照（安装时落库，驱动详情页多段展示；手动添加为空）----
  /** 完整 README（Markdown，优先中文版） */
  readme?: string
  /** 市场声明的工具清单（含描述与参数 schema，离线可用） */
  toolsDoc?: McpToolDoc[]
  /** 开源许可证 */
  license?: string
  /** 发布者 */
  publisher?: string
  /** 项目头像 */
  iconUrl?: string
  /** 市场更新时间（毫秒时间戳） */
  updatedAt?: number
  /** 浏览量 */
  viewCount?: number
}

/** 工具文档：市场 Tools[] 或运行时 tools/list 的一条 */
export interface McpToolDoc {
  name: string
  description?: string
  /** JSON Schema（properties/required 等），用于参数表 */
  inputSchema?: Record<string, unknown>
}

/** 管理页展示用：登记信息 + 运行时状态 */
export interface McpServerStatus extends McpServerInfo {
  status: 'connected' | 'error' | 'disabled'
  error?: string
  /** 已注册进 ToolRegistry 的工具名（mcp_ 前缀） */
  tools: string[]
}

/**
 * 魔搭（ModelScope）MCP 市场条目。API 契约（2026-09 实测）：
 * 列表/搜索 PUT /api/v1/dolphin/mcpServers body {Query,PageNumber,PageSize,Criterion:[]}
 * → {Code:200, Data:{McpServer:{TotalCount, McpServers[]}}}；分类筛选项未公开（实测无效），只作展示。
 * 详情 GET /api/v1/mcpServers/{path}/{name}；Hosted 专属 URL 需登录 Token 才返回。
 */
export interface McpHubItem {
  /** 市场全局 id：path/name，已安装标记按此匹配 */
  hubId: string
  path: string
  name: string
  chineseName: string
  description: string
  category: string[]
  hosted: boolean
  transportTypes: string[]
  callVolume: number
  stars: number
  fromSiteUrl: string
}

export interface McpHubSearchResult {
  items: McpHubItem[]
  total: number
  page: number
}

/** 工作区文件树目录项（右侧结果区只读浏览用） */
export interface DirEntry {
  name: string
  /** 相对工作区根的路径，以 / 拼接 */
  relPath: string
  isDir: boolean
  /** 文件字节数；目录为 0 */
  size: number
}

/** 文本文件预览结果；二进制/超大各自标记，由 UI 决定降级方式 */
export interface FilePreview {
  ok: boolean
  error?: string
  content?: string
  size?: number
  /** 内容因超预览上限被截断 */
  truncated?: boolean
  /** 二进制文件（含 \0 字节），不返回 content */
  binary?: boolean
}

/**
 * Agent 引擎向 UI 外发的事件（与主进程 engine.ts 里的 AgentEvent 同构，
 * 额外携带 sessionId/turnId 便于 UI 按当前选中的会话过滤）。
 * renderer 侧只需处理 type，不需知道内部实现。
 */
export type AgentStreamEvent =
  | { type: 'text-delta'; sessionId: string; turnId: string; text: string }
  | { type: 'reasoning-delta'; sessionId: string; turnId: string; text: string }
  | { type: 'tool-call'; sessionId: string; turnId: string; call: ToolCall }
  | {
      type: 'tool-result'
      sessionId: string
      turnId: string
      callId: string
      ok: boolean
      content: string
    }
  | {
      type: 'approval-required'
      sessionId: string
      turnId: string
      requestId: string
      call: ToolCall
      reason: string
    }
  | {
      type: 'artifact'
      sessionId: string
      turnId: string
      callId: string
      artifact: { kind: 'file' | 'link'; name: string; relPath?: string; url?: string }
    }
  | {
      type: 'turn-end'
      sessionId: string
      turnId: string
      reason: 'stop' | 'max-iterations' | 'aborted' | 'error'
      error?: string
    }

/**
 * 应用级偏好（存 settings_kv）。主进程为真相源，渲染经 PrefsGet/Set 读写。
 * approvalMode='auto' 时工具调用跳过批准卡（等同 WorkBuddy「允许完全访问」）。
 */
export interface AppPrefs {
  /** 默认模型 provider id；空串表示未指定（新任务页回退首个） */
  defaultProviderId: string
  /** 默认工作目录；空串表示未指定（新任务页仍强制选择） */
  defaultWorkDir: string
  /** 工具批准策略：'ask' 每次询问（默认）| 'auto' 自动允许全部 */
  approvalMode: 'ask' | 'auto'
  /** 是否已完成首次启动向导；false 时应用弹出向导 */
  onboarded: boolean
  /** 默认用于“在 IDE 打开”的应用 id（取自 IdeApp.id）；空串表示未选 */
  defaultIdeId: string
}

/** 关于页/数据管理用：版本与本地数据目录 */
export interface AppInfo {
  version: string
  /** app.getPath('userData') 绝对路径 */
  dataDir: string
}

/**
 * 自动更新事件流（阶段 7）：主进程 autoUpdater 的回调翻译成一组带 phase 的事件，
 * 推给发起检查的那个渲染进程；UI 据此展示 检查中/发现新版/下载进度/已就绪/失败。
 * 采用 autoDownload=false：发现新版后不自动下载，由用户确认再触发 download。
 */
export type UpdateEvent =
  | { phase: 'checking' }
  | { phase: 'not-available'; version: string }
  | { phase: 'available'; version: string; releaseNotes?: string }
  | { phase: 'progress'; percent: number; transferred: number; total: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

/**
 * 可“打开文件夹”的外部应用（IDE 等）。
 * source='auto' 为启动时探测所得（不落库，每次现算）；'custom' 为用户在设置页手动添加（落 settings_kv）。
 * path 是可执行文件绝对路径；只主进程侧持有与使用，渲染端仅传 id。
 */
export interface IdeApp {
  id: string
  name: string
  path: string
  source: 'auto' | 'custom'
  /** 启动时附加到 exe 的参数（排在目录参数之前）；如 OpenCode 需 --disable-gpu 避开嵌套 Electron 的 GPU 合成白屏 */
  launchArgs?: string[]
  /** true 时不直接 spawn exe，而是交给 explorer（ShellExecute，等价双击）启动；用于被当作子进程拉起会白屏的应用（如 OpenCode），此时不传目录参数 */
  shellLaunch?: boolean
  /** 该应用保存"项目列表"的状态库绝对路径；不传目录参数的应用靠它把当前工作目录登记进列表（目前仅 OpenCode） */
  projectStateDb?: string
}

/** AppsList 下发给渲染层的视图：带启用/可删标记（自动项只能隐/显，手动项可删）；icon 为 exe 内嵌图标的 dataURL */
export interface IdeAppView extends IdeApp {
  enabled: boolean
  removable: boolean
  /** 主进程经 app.getFileIcon 提取的真实图标（data:image/png;base64,…）；取不到时 undefined */
  icon?: string
}
