import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow, shell, app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AgentStreamEvent,
  AppPrefs,
  ChatMessage,
  IdeApp,
  IdeAppView,
  McpServerInfo,
  McpTransport,
  ProviderConfig,
  StreamEvent,
  ToolCall
} from '@shared/types'
import { SettingsStore } from './settings'
import { DbStore, Session } from './db/store'
import { PermissionGate } from './permissions/gate'
import { ToolRegistry } from './tools/registry'
import { ToolContext } from './tools/types'
import { LocalWorkspace } from './workspace/local'
import { listDir, readFilePreview } from './workspace/browse'
import { SkillRegistry } from './skills/registry'
import { SkillManager } from './skills/manager'
import { HubClient } from './skills/hub'
import { McpManager } from './mcp/manager'
import { MsHubClient } from './mcp/hub'
import { HubTokenStore } from './mcp/token'
import { AgentEvent, LlmCallFn, runAgentTurn } from './agent/engine'
import { chatOnce, streamChat, testConnection, GatewayEvent } from './llm/gateway'
import { checkUpdate, downloadUpdate, installUpdate } from './updater'
import { detectIdes, defaultProbes, openFolderInIde } from './apps'

/** 平台级默认人设（对所有会话生效；用户不感知“选智能体”）。技能轻量索引会拼在其后。 */
const BASE_SYSTEM_PROMPT =
  '你是 BlueBuddy，一个尊重工作目录沙箱、做事严谨的本地智能体。需要动手时优先用工具，高危操作前申请批准。' +
  '叙事纪律：每次调用工具前，先用一句话向用户说明你接下来要做什么、为什么；拿到工具结果后先给结论再展开细节。'

/** 主进程侧一次性装配的依赖集合，避免各处 new */
export interface IpcDeps {
  settings: SettingsStore
  db: DbStore
  gate: PermissionGate
  registry: ToolRegistry
  /** 已启用技能表；为空时不向模型暴露 use_skill，也不拼技能索引 */
  skillRegistry: SkillRegistry
  /** 技能管理器（Stage 4）：启停/导入/删除后重建 skillRegistry 与 use_skill 上架 */
  skills: SkillManager
  /** 技能安装根目录（userData/skills）：作为会话工作区的只读可信根，让 Agent 能读/跑技能自带脚本 */
  skillsRoot: string
  /** SkillHub 市场客户端：发现页搜索与技能包下载 */
  hub: HubClient
  /** MCP 连接器管理（Stage 5）：服务器登记 × 运行时连接池 */
  mcp: McpManager
  /** 魔搭 MCP 市场客户端（发现页搜索/安装计划） */
  mcpHub: MsHubClient
  /** 魔搭访问令牌（加密存储；Hosted 专属地址需要） */
  mcpToken: HubTokenStore
}

/** 活跃 turn 的取消控制器；一个 session 同一时刻只允许一个 turn */
const activeTurns = new Map<string, { turnId: string; controller: AbortController }>()

/** requestId -> AbortController：老纯对话流（阶段 1）保留 */
const activeChats = new Map<string, AbortController>()

/**
 * 判断 UI 传回来的 apiKey 是不是"掩码占位"（用户没改动 Key 输入框，只是把
 * 已存的掩码回填提交）——这种情况要用数据库里的真实 Key，不能把 "••••abcd"
 * 当成新 Key 覆盖掉真实值，也不能拿它去连服务器。
 */
function resolveRealApiKey(store: SettingsStore, provider: ProviderConfig): ProviderConfig {
  if (!provider.apiKey.startsWith('••••')) return provider
  const existing = provider.id ? store.getRaw(provider.id) : undefined
  return existing ?? provider
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const {
    settings,
    db,
    gate,
    registry,
    skillRegistry,
    skills,
    skillsRoot,
    hub,
    mcp,
    mcpHub,
    mcpToken
  } = deps

  // ---------- Settings（阶段 1 保留原逻辑）----------

  ipcMain.handle(IPC_CHANNELS.SettingsList, () => settings.listMasked())
  ipcMain.handle(IPC_CHANNELS.SettingsUpsert, (_e, provider: ProviderConfig) =>
    settings.upsert(provider)
  )
  ipcMain.handle(IPC_CHANNELS.SettingsRemove, (_e, id: string) => settings.remove(id))
  ipcMain.handle(IPC_CHANNELS.SettingsTest, (_e, provider: ProviderConfig) => {
    const real = resolveRealApiKey(settings, provider)
    return testConnection({ baseUrl: real.baseUrl, apiKey: real.apiKey, model: real.model })
  })

  // ---------- 纯 LLM 单轮对话（阶段 1 保留，UI 可继续用无工具模式）----------

  ipcMain.handle(
    IPC_CHANNELS.LlmChatStart,
    (event, requestId: string, providerId: string, messages: ChatMessage[]) => {
      const provider = settings.getRaw(providerId)
      if (!provider) {
        event.sender.send(IPC_CHANNELS.LlmEvent, {
          type: 'error',
          requestId,
          message: '未找到该模型配置，请先到设置页添加'
        } satisfies StreamEvent)
        return
      }
      const controller = new AbortController()
      activeChats.set(requestId, controller)

      const produce = async (): Promise<AsyncIterable<GatewayEvent>> => {
        if (provider.streaming) {
          return streamChat({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
            messages,
            signal: controller.signal
          })
        }
        const result = await chatOnce({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          messages,
          signal: controller.signal
        })
        const text = result.content
        return (async function* () {
          if (text) yield { type: 'delta' as const, text }
          yield { type: 'done' as const }
        })()
      }

      void (async () => {
        try {
          const source = await produce()
          for await (const e of source) {
            if (e.type === 'delta') {
              event.sender.send(IPC_CHANNELS.LlmEvent, {
                type: 'delta',
                requestId,
                text: e.text
              } satisfies StreamEvent)
            } else if (e.type === 'done') {
              event.sender.send(IPC_CHANNELS.LlmEvent, {
                type: 'done',
                requestId
              } satisfies StreamEvent)
            }
          }
        } catch (err) {
          if (controller.signal.aborted) return
          const message = err instanceof Error ? err.message : String(err)
          event.sender.send(IPC_CHANNELS.LlmEvent, {
            type: 'error',
            requestId,
            message
          } satisfies StreamEvent)
        } finally {
          activeChats.delete(requestId)
        }
      })()
    }
  )

  ipcMain.handle(IPC_CHANNELS.LlmChatCancel, (_e, requestId: string) => {
    activeChats.get(requestId)?.abort()
    activeChats.delete(requestId)
  })

  // ---------- Sessions / Messages / Artifacts CRUD ----------

  ipcMain.handle(IPC_CHANNELS.SessionsList, (): Session[] => db.listSessions())
  ipcMain.handle(
    IPC_CHANNELS.SessionsCreate,
    (_e, input: { title: string; workDir: string; providerId: string }) => db.createSession(input)
  )
  ipcMain.handle(IPC_CHANNELS.SessionsRename, (_e, id: string, title: string) =>
    db.renameSession(id, title)
  )
  ipcMain.handle(IPC_CHANNELS.SessionsDelete, (_e, id: string) => {
    activeTurns.get(id)?.controller.abort()
    activeTurns.delete(id)
    gate.clearSession(id)
    db.deleteSession(id)
  })
  ipcMain.handle(IPC_CHANNELS.MessagesList, (_e, sessionId: string) => db.listMessages(sessionId))
  ipcMain.handle(IPC_CHANNELS.ArtifactsList, (_e, sessionId: string) => {
    const session = db.getSession(sessionId)
    return db.listArtifacts(sessionId).map((a) => {
      if (a.kind !== 'file' || !a.relPath || !session) return a
      return { ...a, absPath: path.resolve(session.workDir, a.relPath) }
    })
  })
  ipcMain.handle(IPC_CHANNELS.ArtifactsDelete, (_e, id: string) => db.deleteArtifact(id))

  // 工作区只读浏览（右侧结果区文件 Tab）：会话 workDir 即沙箱根，越界由 browse 层抛错
  ipcMain.handle(IPC_CHANNELS.WorkspaceListDir, (_e, sessionId: string, relPath: string) => {
    const session = db.getSession(sessionId)
    if (!session) return { ok: false, error: '会话不存在' }
    try {
      return { ok: true, entries: listDir(session.workDir, relPath) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC_CHANNELS.WorkspaceReadFile, (_e, sessionId: string, relPath: string) => {
    const session = db.getSession(sessionId)
    if (!session) return { ok: false, error: '会话不存在' }
    try {
      return readFilePreview(session.workDir, relPath)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---------- 技能管理（Stage 4） ----------

  ipcMain.handle(IPC_CHANNELS.SkillsList, () => skills.list())
  ipcMain.handle(IPC_CHANNELS.SkillsSetEnabled, (_e, name: string, enabled: boolean) =>
    skills.setEnabled(name, enabled).then(
      () => ({ ok: true }),
      (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )
  )
  ipcMain.handle(IPC_CHANNELS.SkillsRemove, (_e, name: string) =>
    skills.remove(name).then(
      () => ({ ok: true }),
      (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )
  )
  ipcMain.handle(IPC_CHANNELS.SkillsImport, (_e, srcDir: string) =>
    skills.importFrom(srcDir).then(
      (skill) => ({ ok: true, skill }),
      (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )
  )

  // ---------- SkillHub 市场（发现页）----------

  ipcMain.handle(
    IPC_CHANNELS.HubSearch,
    (_e, params: { keyword?: string; category?: string; page?: number }) =>
      hub.search(params ?? {}).then(
        (result) => ({ ok: true, result }),
        (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
      )
  )

  ipcMain.handle(
    IPC_CHANNELS.HubInstall,
    async (_e, canonicalName: string, displayName?: string) => {
      // 市场包 → 临时 zip → 复用本地 zip 安装链（zip-slip 把关 + SKILL.md 校验）；
      // displayName 为市场中文真名，落库后已安装列表优先展示
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-hubinstall-'))
      const zipPath = path.join(tmpDir, 'skill.zip')
      try {
        await hub.downloadZip(canonicalName, zipPath)
        const skill = await skills.importFromZip(zipPath, displayName)
        return { ok: true, skill }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  )

  // ---------- MCP 连接器（Stage 5）----------

  ipcMain.handle(IPC_CHANNELS.McpList, () => mcp.listStatus())

  ipcMain.handle(
    IPC_CHANNELS.McpAdd,
    (_e, input: { name: string; transport: McpTransport; config: McpServerInfo['config'] }) =>
      mcp.add(input)
  )

  ipcMain.handle(IPC_CHANNELS.McpSetEnabled, (_e, id: string, enabled: boolean) =>
    mcp.setEnabled(id, enabled)
  )

  ipcMain.handle(IPC_CHANNELS.McpRemove, async (_e, id: string) => {
    await mcp.remove(id)
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.McpReconnect, (_e, id: string) => mcp.reconnect(id))

  // ---------- 魔搭 MCP 市场（发现页，实时获取不落库）----------

  ipcMain.handle(
    IPC_CHANNELS.McpHubSearch,
    (_e, params: { keyword?: string; page?: number; pageSize?: number }) =>
      mcpHub.search(params ?? {}).then(
        (result) => ({ ok: true, result }),
        (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
      )
  )

  ipcMain.handle(IPC_CHANNELS.McpHubInstall, async (_e, ref: { path: string; name: string }) => {
    try {
      // 安装计划由主进程自己拉详情解析（不信任渲染进程传来的配置），
      // Hosted 服务带已存 Token 才拿得到专属 URL；后续链路复用 mcp.add（登记即连）
      const plan = await mcpHub.resolveInstall(ref.path, ref.name, mcpToken.get() || undefined)
      return await mcp.add({
        name: plan.name,
        transport: plan.transport,
        config: plan.config as unknown as McpServerInfo['config'],
        displayName: plan.displayName,
        hubId: plan.hubId,
        description: plan.description,
        category: plan.category,
        sourceUrl: plan.sourceUrl,
        stars: plan.stars,
        callVolume: plan.callVolume,
        readme: plan.readme,
        toolsDoc: plan.toolsDoc,
        license: plan.license,
        publisher: plan.publisher,
        iconUrl: plan.iconUrl,
        updatedAt: plan.updatedAt,
        viewCount: plan.viewCount
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.McpHubTokenGet, () => mcpToken.masked())

  ipcMain.handle(IPC_CHANNELS.McpHubTokenSet, (_e, token: string) => {
    mcpToken.set(String(token ?? ''))
    return { ok: true, masked: mcpToken.masked() }
  })

  // ---------- 应用级偏好（settings_kv 承载）----------

  ipcMain.handle(IPC_CHANNELS.PrefsGet, (): AppPrefs => ({
    defaultProviderId: db.getKv('default_provider_id') ?? '',
    defaultWorkDir: db.getKv('default_work_dir') ?? '',
    approvalMode: (db.getKv('approval_mode') === 'auto'
      ? 'auto'
      : 'ask') as AppPrefs['approvalMode'],
    onboarded: db.getKv('onboarded') === '1',
    defaultIdeId: db.getKv('default_ide_id') ?? ''
  }))

  ipcMain.handle(IPC_CHANNELS.PrefsSet, (_e, prefs: Partial<AppPrefs>) => {
    if (prefs.defaultProviderId !== undefined)
      db.setKv('default_provider_id', prefs.defaultProviderId)
    if (prefs.defaultWorkDir !== undefined) db.setKv('default_work_dir', prefs.defaultWorkDir)
    if (prefs.approvalMode !== undefined) {
      const mode = prefs.approvalMode === 'auto' ? 'auto' : 'ask'
      db.setKv('approval_mode', mode)
      gate.setAutoApprove(mode === 'auto')
    }
    if (prefs.onboarded !== undefined) db.setKv('onboarded', prefs.onboarded ? '1' : '0')
    if (prefs.defaultIdeId !== undefined) db.setKv('default_ide_id', prefs.defaultIdeId)
    return { ok: true }
  })

  // ---------- 外部应用（IDE）集成 ----------
  // 生效列表 = 实时探测(auto) + 手动添加(custom, 落 kv)，带停用标记(disabled, 落 kv)。
  // 渲染端只传 id，可执行路径始终由主进程从探测/存储解析，杜绝任意 exe 注入。
  const readCustomIdes = (): IdeApp[] => {
    const raw = db.getKv('custom_ides')
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return (parsed as unknown[]).filter((x): x is IdeApp => {
        const a = x as Partial<IdeApp> | null
        return (
          !!a &&
          typeof a.id === 'string' &&
          typeof a.name === 'string' &&
          typeof a.path === 'string' &&
          (a.source === 'auto' || a.source === 'custom')
        )
      })
    } catch {
      return []
    }
  }
  const writeCustomIdes = (list: IdeApp[]): void => db.setKv('custom_ides', JSON.stringify(list))

  const readDisabled = (): Set<string> => {
    const raw = db.getKv('disabled_ides')
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
    } catch {
      return new Set()
    }
  }
  const writeDisabled = (set: Set<string>): void =>
    db.setKv('disabled_ides', JSON.stringify([...set]))

  const listIdeApps = (): IdeAppView[] => {
    const disabled = readDisabled()
    const merged: IdeApp[] = [...detectIdes(defaultProbes()), ...readCustomIdes()]
    return merged.map((a) => ({
      ...a,
      enabled: !disabled.has(a.id),
      removable: a.source === 'custom'
    }))
  }

  // 从 exe 提取真实图标（app.getFileIcon 返回 shell 图标），按路径缓存；取不到置 undefined 不缓存失败重试风暴
  const iconCache = new Map<string, string | undefined>()
  const iconForPath = async (p: string): Promise<string | undefined> => {
    if (iconCache.has(p)) return iconCache.get(p)
    try {
      const img = await app.getFileIcon(p, { size: 'large' })
      const url = img.isEmpty()
        ? undefined
        : 'data:image/png;base64,' + img.toPNG().toString('base64')
      iconCache.set(p, url)
      return url
    } catch {
      iconCache.set(p, undefined)
      return undefined
    }
  }
  const withIcons = (apps: IdeAppView[]): Promise<IdeAppView[]> =>
    Promise.all(apps.map(async (a) => ({ ...a, icon: await iconForPath(a.path) })))

  ipcMain.handle(IPC_CHANNELS.AppsList, async () => withIcons(listIdeApps()))

  ipcMain.handle(
    IPC_CHANNELS.AppsAddCustom,
    async (
      _e,
      name: string,
      exePath: string
    ): Promise<{ ok: boolean; error?: string; apps?: IdeAppView[] }> => {
      const trimmedName = name.trim()
      const trimmedPath = exePath.trim()
      if (!trimmedName || !trimmedPath) return { ok: false, error: '名称与路径都不能为空' }
      if (!path.isAbsolute(trimmedPath)) return { ok: false, error: '可执行文件必须是绝对路径' }
      if (!fs.existsSync(trimmedPath)) return { ok: false, error: `找不到文件：${trimmedPath}` }
      const list = readCustomIdes()
      list.push({
        id: `custom-${randomUUID()}`,
        name: trimmedName,
        path: trimmedPath,
        source: 'custom'
      })
      writeCustomIdes(list)
      return { ok: true, apps: await withIcons(listIdeApps()) }
    }
  )

  ipcMain.handle(IPC_CHANNELS.AppsRemove, async (_e, id: string) => {
    const list = readCustomIdes()
    const next = list.filter((a) => a.id !== id)
    if (next.length !== list.length) {
      writeCustomIdes(next)
      if (db.getKv('default_ide_id') === id) db.setKv('default_ide_id', '')
    }
    return { ok: true, apps: await withIcons(listIdeApps()) }
  })

  ipcMain.handle(IPC_CHANNELS.AppsSetEnabled, async (_e, id: string, enabled: boolean) => {
    const set = readDisabled()
    if (enabled) set.delete(id)
    else set.add(id)
    writeDisabled(set)
    return { ok: true, apps: await withIcons(listIdeApps()) }
  })

  ipcMain.handle(
    IPC_CHANNELS.AppsOpenFolder,
    (_e, id: string, folder: string): { ok: boolean; error?: string } => {
      const target = listIdeApps().find((a) => a.id === id)
      if (!target) return { ok: false, error: '未找到该应用' }
      return openFolderInIde(target.path, folder, {
        launchArgs: target.launchArgs,
        shellLaunch: target.shellLaunch,
        projectStateDb: target.projectStateDb
      })
    }
  )

  ipcMain.handle(IPC_CHANNELS.AppInfo, () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData')
  }))

  ipcMain.handle(IPC_CHANNELS.DataWipe, () => {
    // 先撤销所有挂起批准（避免 Agent 循环永挂），再清库与 Provider 配置
    gate.clearAll()
    db.wipeAll()
    settings.clear()
    return { ok: true }
  })

  // ---------- 自动更新（阶段 7）----------
  // 事件不回直接 return，而是把 autoUpdater 回调通过 UpdateEvent 推回发起者；
  // UI 先 check，收到 available 后由用户确认再 download，downloaded 后 install 重启。

  ipcMain.handle(IPC_CHANNELS.UpdateCheck, (event) =>
    checkUpdate((e) => event.sender.send(IPC_CHANNELS.UpdateEvent, e))
  )

  ipcMain.handle(IPC_CHANNELS.UpdateDownload, (event) =>
    downloadUpdate((e) => event.sender.send(IPC_CHANNELS.UpdateEvent, e))
  )

  ipcMain.handle(IPC_CHANNELS.UpdateInstall, () => installUpdate())

  // ---------- Agent 循环 ----------

  ipcMain.handle(IPC_CHANNELS.AgentSend, async (event, sessionId: string, userText: string) => {
    const session = db.getSession(sessionId)
    if (!session) return { ok: false, error: 'session not found' }
    const provider = settings.getRaw(session.providerId)
    if (!provider) return { ok: false, error: 'provider not found' }
    if (activeTurns.has(sessionId)) {
      return { ok: false, error: 'another turn is in flight for this session' }
    }

    const turnId = randomUUID()
    const controller = new AbortController()
    activeTurns.set(sessionId, { turnId, controller })

    // 渲染进程被销毁（reload / 关窗）时没人再回应批准：撤销 pending 并中止，
    // 否则循环永挂、activeTurns 死锁，后续所有发送都被拒为 "another turn is in flight"
    const onSenderDestroyed = (): void => {
      controller.abort()
      gate.rejectPendingForSession(sessionId)
    }
    event.sender.once('destroyed', onSenderDestroyed)

    // 只读可信根放行技能安装目录：Agent 可 read_file/list_dir 读技能自带文件、
    // run_command 以绝对路径跑其 scripts；写入仍严格锁在会话工作区内。
    const workspace = new LocalWorkspace(session.workDir, { readRoots: [skillsRoot] })
    const toolCtx: ToolContext = { workspace, fetch: globalThis.fetch, signal: controller.signal }

    // 渐进式披露一级：把已启用技能的轻量索引拼进系统提示词（不入库，每轮现拼）
    const skillIndex = skillRegistry.indexForPrompt()
    const systemPrompt = skillIndex ? `${BASE_SYSTEM_PROMPT}\n\n${skillIndex}` : BASE_SYSTEM_PROMPT

    // 从 DB 载入历史 + 追加本次 user + 立即入库
    const messages: ChatMessage[] = db.listMessages(sessionId)
    const userMsg: ChatMessage = { role: 'user', content: userText }
    messages.push(userMsg)
    db.appendMessage(sessionId, userMsg)
    let dbCount = messages.length

    const sendTo = (e: AgentStreamEvent): void => {
      event.sender.send(IPC_CHANNELS.AgentEvent, e)
    }

    const llmCall: LlmCallFn = async function* (params) {
      if (provider.streaming) {
        yield* streamChat({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          messages: params.messages,
          tools: params.tools,
          signal: params.signal
        })
        return
      }
      // 非流式：包装成 delta / tool-call-delta / finish / done，让引擎走同一套聚合逻辑
      const res = await chatOnce({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        messages: params.messages,
        tools: params.tools,
        signal: params.signal
      })
      yield* (async function* () {
        if (res.content) yield { type: 'delta' as const, text: res.content }
        if (res.tool_calls) {
          for (let i = 0; i < res.tool_calls.length; i++) {
            const c = res.tool_calls[i]
            yield {
              type: 'tool-call-delta' as const,
              delta: {
                index: i,
                id: c.id,
                name: c.function.name,
                argsChunk: c.function.arguments
              }
            } satisfies GatewayEvent
          }
        }
        yield { type: 'finish' as const, reason: res.finish_reason ?? 'stop' }
        yield { type: 'done' as const }
      })()
    }

    const requestApproval = (call: ToolCall, reason: string): Promise<boolean> =>
      gate.request({
        sessionId,
        call,
        reason,
        onRequest: (requestId) => {
          sendTo({
            type: 'approval-required',
            sessionId,
            turnId,
            requestId,
            call,
            reason
          })
        }
      })

    // 兜底：把引擎原地 push 到 messages 的新条目落盘
    const flushNewMessages = (): void => {
      for (let i = dbCount; i < messages.length; i++) {
        db.appendMessage(sessionId, messages[i])
      }
      dbCount = messages.length
    }

    // 后台跑完整 turn，handler 立即回 turnId：避免渲染进程 await 整个 turn 期间
    // busy 状态不生效，连发两次把同会话第二个请求拒成 "another turn in flight"
    void (async () => {
      try {
        const gen = runAgentTurn({
          llmCall,
          registry,
          toolCtx,
          messages,
          systemPrompt,
          requestApproval,
          signal: controller.signal
        })
        for await (const e of gen) {
          flushNewMessages()
          forward(e, sessionId, turnId, sendTo, db)
        }
        flushNewMessages()
      } catch (err) {
        // 引擎本身已经把内部异常转成 turn-end=error；这里兜底捕获 IPC 层的意外
        const message = err instanceof Error ? err.message : String(err)
        sendTo({ type: 'turn-end', sessionId, turnId, reason: 'error', error: message })
      } finally {
        activeTurns.delete(sessionId)
        event.sender.removeListener('destroyed', onSenderDestroyed)
      }
    })()

    return { ok: true, turnId }
  })

  ipcMain.handle(IPC_CHANNELS.AgentCancel, (_e, sessionId: string) => {
    const t = activeTurns.get(sessionId)
    if (!t) return { ok: false }
    t.controller.abort()
    // 若循环正挂在等待批准上，撤销 pending 让它继续跑到 abort 检查点退出
    gate.rejectPendingForSession(sessionId)
    return { ok: true }
  })

  ipcMain.handle(
    IPC_CHANNELS.PermissionReply,
    (_e, requestId: string, approved: boolean, alwaysAllow: boolean) => {
      gate.reply(requestId, approved, alwaysAllow)
    }
  )

  // ---------- 系统能力桥（选目录 / 打开产物） ----------

  ipcMain.handle(IPC_CHANNELS.DialogOpenDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.DialogOpenZipFile, async (event) => {
    // 技能包选择器：仅放行 .zip 后缀，解压安全由 SkillManager 把关
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '技能包', extensions: ['zip'] }]
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.ShellOpenPath, async (_e, targetPath: string) => {
    // 产物路径由主进程自己登记（LocalWorkspace 已防路径穿越），这里只负责交给系统打开
    const err = await shell.openPath(targetPath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.ShellOpenExternal, async (_e, url: string) => {
    // 只放行 http/https，防一手 "file://…" 或 "powershell:…" 之类的协议注入
    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      return { ok: false, error: 'invalid url' }
    }
    if (protocol !== 'http:' && protocol !== 'https:')
      return { ok: false, error: 'blocked protocol' }
    await shell.openExternal(url)
    return { ok: true }
  })
}

/**
 * 把引擎内部的 AgentEvent 加上 sessionId/turnId 包成对外 AgentStreamEvent，
 * 顺便把 artifact 事件同步登记进 DB（其他事件由调用侧统一做消息落盘）。
 */
function forward(
  e: AgentEvent,
  sessionId: string,
  turnId: string,
  sendTo: (ev: AgentStreamEvent) => void,
  db: DbStore
): void {
  switch (e.type) {
    case 'text-delta':
      sendTo({ type: 'text-delta', sessionId, turnId, text: e.text })
      break
    case 'reasoning-delta':
      sendTo({ type: 'reasoning-delta', sessionId, turnId, text: e.text })
      break
    case 'tool-call':
      sendTo({ type: 'tool-call', sessionId, turnId, call: e.call })
      break
    case 'tool-result':
      sendTo({
        type: 'tool-result',
        sessionId,
        turnId,
        callId: e.callId,
        ok: e.ok,
        content: e.content
      })
      break
    case 'artifact':
      db.registerArtifact(sessionId, e.callId, e.artifact)
      sendTo({ type: 'artifact', sessionId, turnId, callId: e.callId, artifact: e.artifact })
      break
    case 'turn-end':
      sendTo({
        type: 'turn-end',
        sessionId,
        turnId,
        reason: e.reason,
        ...(e.error ? { error: e.error } : {})
      })
      break
  }
}

/** 供测试或热重载时清理 IPC 层内部状态 */
export function _resetIpcStateForTests(): void {
  for (const { controller } of activeTurns.values()) controller.abort()
  activeTurns.clear()
  for (const c of activeChats.values()) c.abort()
  activeChats.clear()
}

// 保持 IpcMainInvokeEvent 引用避免 tree-shake 误删（未来 handlers 若需要 event 类型可直接使用）
export type _IpcEvent = IpcMainInvokeEvent
