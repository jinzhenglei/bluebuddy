import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, McpServerInfo, McpToolDoc, McpTransport, ToolCall } from '@shared/types'
import type { ArtifactDraft } from '../tools/types'

/** 一次会话（Session）：一个工作目录 + 一个模型 + 一串消息；projectId 为空表示未归类 */
export interface Session {
  id: string
  title: string
  workDir: string
  providerId: string
  createdAt: number
  /** 所属项目空间；NULL（未归类）读出为 undefined */
  projectId?: string
}

/** 项目空间：绑定一个工作目录，空间内任务共用该目录与项目指令 */
export interface Project {
  id: string
  name: string
  workDir: string
  /** 项目指令原文；未设置读出为 undefined，清空后为 '' */
  instructions?: string
  /** 空间默认模型；未设置读出为 undefined */
  providerId?: string
  createdAt: number
}

/** 空间下的产物（跨任务聚合），附带来源会话标题 */
export interface ProjectArtifact extends StoredArtifact {
  sessionTitle: string
}

/** sessions 表原始行（project_id 为 NULL），供 mapper 收窄 */
type SessionRow = Omit<Session, 'projectId'> & { projectId: string | null }

/** NULL 归一成 undefined，避免 null 泄漏到渲染层 */
function toSession(r: SessionRow): Session {
  const s: Session = {
    id: r.id,
    title: r.title,
    workDir: r.workDir,
    providerId: r.providerId,
    createdAt: r.createdAt
  }
  if (r.projectId) s.projectId = r.projectId
  return s
}

/** projects 表原始行 */
type ProjectRow = Omit<Project, 'instructions' | 'providerId'> & {
  instructions: string | null
  providerId: string | null
}

function toProject(r: ProjectRow): Project {
  const p: Project = { id: r.id, name: r.name, workDir: r.workDir, createdAt: r.createdAt }
  if (r.instructions !== null) p.instructions = r.instructions
  if (r.providerId) p.providerId = r.providerId
  return p
}

/** 已入库的产物记录 */
export interface StoredArtifact extends ArtifactDraft {
  id: string
  sessionId: string
  callId: string
  createdAt: number
}

/** 技能管理表行：启用/停用状态与目录登记（正文在磁盘 SKILL.md） */
export interface SkillRow {
  name: string
  dir: string
  enabled: boolean
  createdAt: number
  /** 市场显示名（如中文真名）；null 表示用 frontmatter name */
  displayName?: string | null
}

const SCHEMA_VERSION = 9

/** 安全解析 mcp_servers.category（JSON 数组字符串）；脏数据/空值回退 undefined */
function parseCategory(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : undefined
  } catch {
    return undefined
  }
}

/** 安全解析 mcp_servers.tools_doc（McpToolDoc[] 的 JSON）；脏数据/空值回退 undefined */
function parseToolsDoc(raw: string | null): McpToolDoc[] | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as McpToolDoc[]) : undefined
  } catch {
    return undefined
  }
}

/**
 * DbStore：SQLite 持久化层。
 *
 * 使用同步 API（better-sqlite3）——主进程单线程，同步简单可靠且性能足够。
 *
 * 迁移策略：PRAGMA user_version + 顺序 upgrade；当前只有 v1，未来加表时
 * 追加 v2/v3 分支即可，不会破坏既有数据。
 *
 * 外键 ON DELETE CASCADE：删除 session 时 messages/artifacts 自动级联清理，
 * 无需手写 delete from ...。
 */
export class DbStore {
  private db: Database.Database

  constructor(filename: string | ':memory:') {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number
    if (current >= SCHEMA_VERSION) return

    if (current < 1) {
      this.db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          work_dir TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_call_id TEXT,
          name TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_messages_session ON messages(session_id, created_at);

        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          rel_path TEXT,
          url TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_artifacts_session ON artifacts(session_id, created_at);
      `)
    }

    if (current < 2) {
      // v2：思考过程（reasoning）随 assistant 消息落库，turn 结束后可回看
      this.db.exec('ALTER TABLE messages ADD COLUMN reasoning TEXT')
    }

    if (current < 3) {
      // v3：技能管理表（Stage 4）：启用/停用状态与导入登记；技能正文仍在磁盘 SKILL.md
      this.db.exec(`
        CREATE TABLE skills (
          name TEXT PRIMARY KEY,
          dir TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
      `)
    }

    if (current < 4) {
      // v4：技能市场显示名（中文真名）与 frontmatter slug 名分离存储
      this.db.exec('ALTER TABLE skills ADD COLUMN display_name TEXT')
    }

    if (current < 5) {
      // v5：MCP 服务器登记表（Stage 5）；连接细节存 config JSON，stdio/http 共用一张表
      this.db.exec(`
        CREATE TABLE mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          transport TEXT NOT NULL,
          config TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
      `)
    }

    if (current < 6) {
      // v6：MCP 市场（魔搭）——展示名与来源 id；另加通用 KV 表（加密后的 Token 等杂项配置）
      this.db.exec(`
        ALTER TABLE mcp_servers ADD COLUMN display_name TEXT;
        ALTER TABLE mcp_servers ADD COLUMN hub_id TEXT;
        CREATE TABLE settings_kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }

    if (current < 7) {
      // v7：MCP 市场元数据快照（简介/分类/主页/热度），安装时落库供详情页展示
      this.db.exec(`
        ALTER TABLE mcp_servers ADD COLUMN description TEXT;
        ALTER TABLE mcp_servers ADD COLUMN category TEXT;
        ALTER TABLE mcp_servers ADD COLUMN source_url TEXT;
        ALTER TABLE mcp_servers ADD COLUMN stars INTEGER;
        ALTER TABLE mcp_servers ADD COLUMN call_volume INTEGER;
      `)
    }

    if (current < 8) {
      // v8：MCP 市场文档快照（README/工具清单/许可/发布者/头像/更新与浏览数），驱动详情页多段
      this.db.exec(`
        ALTER TABLE mcp_servers ADD COLUMN readme TEXT;
        ALTER TABLE mcp_servers ADD COLUMN tools_doc TEXT;
        ALTER TABLE mcp_servers ADD COLUMN license TEXT;
        ALTER TABLE mcp_servers ADD COLUMN publisher TEXT;
        ALTER TABLE mcp_servers ADD COLUMN icon_url TEXT;
        ALTER TABLE mcp_servers ADD COLUMN updated_at INTEGER;
        ALTER TABLE mcp_servers ADD COLUMN view_count INTEGER;
      `)
    }

    if (current < 9) {
      // v9：项目空间——一个空间绑定一个工作目录，空间内任务共用该目录。
      // 删空间时 FK 把任务的 project_id 置 NULL（任务与产物全留），绝不碰磁盘文件。
      this.db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          work_dir TEXT NOT NULL,
          instructions TEXT,
          provider_id TEXT,
          created_at INTEGER NOT NULL
        );
        ALTER TABLE sessions ADD COLUMN project_id TEXT
          REFERENCES projects(id) ON DELETE SET NULL;
        CREATE INDEX idx_sessions_project ON sessions(project_id, created_at);
      `)
    }

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  // ---------- sessions ----------

  createSession(input: {
    title: string
    workDir: string
    providerId: string
    projectId?: string
  }): Session {
    const s: Session = {
      id: randomUUID(),
      title: input.title,
      workDir: input.workDir,
      providerId: input.providerId,
      createdAt: Date.now()
    }
    if (input.projectId) s.projectId = input.projectId
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, work_dir, provider_id, created_at, project_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(s.id, s.title, s.workDir, s.providerId, s.createdAt, s.projectId ?? null)
    return s
  }

  getSession(id: string): Session | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, work_dir AS workDir, provider_id AS providerId, created_at AS createdAt,
                project_id AS projectId
         FROM sessions WHERE id = ?`
      )
      .get(id) as SessionRow | undefined
    return row && toSession(row)
  }

  listSessions(): Session[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, work_dir AS workDir, provider_id AS providerId, created_at AS createdAt,
                project_id AS projectId
         FROM sessions ORDER BY created_at DESC`
      )
      .all() as SessionRow[]
    return rows.map(toSession)
  }

  /** 某个空间下的任务（新的在前） */
  listSessionsByProject(projectId: string): Session[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, work_dir AS workDir, provider_id AS providerId, created_at AS createdAt,
                project_id AS projectId
         FROM sessions WHERE project_id = ? ORDER BY created_at DESC`
      )
      .all(projectId) as SessionRow[]
    return rows.map(toSession)
  }

  /** 把已有会话归入（传 null 移出）某个空间；用于旧会话归类 */
  updateSessionProject(sessionId: string, projectId: string | null): void {
    this.db.prepare(`UPDATE sessions SET project_id = ? WHERE id = ?`).run(projectId, sessionId)
  }

  renameSession(id: string, title: string): void {
    this.db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, id)
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
  }

  // ---------- messages ----------

  /**
   * 追加一条消息。tool_calls 序列化成 JSON 文本列，读取时再反序列化。
   * 保留 created_at 时间戳用于恢复会话顺序。
   */
  appendMessage(sessionId: string, msg: ChatMessage): { id: string; createdAt: number } {
    const id = randomUUID()
    const createdAt = Date.now()
    const toolCallsJson = msg.tool_calls ? JSON.stringify(msg.tool_calls) : null
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, name, reasoning, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        msg.role,
        msg.content,
        toolCallsJson,
        msg.tool_call_id ?? null,
        msg.name ?? null,
        msg.reasoning ?? null,
        createdAt
      )
    return { id, createdAt }
  }

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, tool_calls, tool_call_id, name, reasoning, created_at
         FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(sessionId) as Array<{
      role: ChatMessage['role']
      content: string
      tool_calls: string | null
      tool_call_id: string | null
      name: string | null
      reasoning: string | null
      created_at: number
    }>
    return rows.map((r) => {
      const m: ChatMessage = { role: r.role, content: r.content }
      if (r.tool_calls) m.tool_calls = JSON.parse(r.tool_calls) as ToolCall[]
      if (r.tool_call_id) m.tool_call_id = r.tool_call_id
      if (r.name) m.name = r.name
      if (r.reasoning) m.reasoning = r.reasoning
      m.createdAt = r.created_at
      return m
    })
  }

  // ---------- artifacts ----------

  registerArtifact(sessionId: string, callId: string, draft: ArtifactDraft): StoredArtifact {
    const a: StoredArtifact = {
      id: randomUUID(),
      sessionId,
      callId,
      kind: draft.kind,
      name: draft.name,
      relPath: draft.relPath,
      url: draft.url,
      createdAt: Date.now()
    }
    this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, call_id, kind, name, rel_path, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        a.id,
        a.sessionId,
        a.callId,
        a.kind,
        a.name,
        a.relPath ?? null,
        a.url ?? null,
        a.createdAt
      )
    return a
  }

  listArtifacts(sessionId: string): StoredArtifact[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id AS sessionId, call_id AS callId, kind, name,
                rel_path AS relPath, url, created_at AS createdAt
         FROM artifacts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(sessionId) as Array<
      Omit<StoredArtifact, 'relPath' | 'url'> & {
        relPath: string | null
        url: string | null
      }
    >
    return rows.map((r) => ({
      ...r,
      relPath: r.relPath ?? undefined,
      url: r.url ?? undefined
    }))
  }

  deleteArtifact(id: string): void {
    this.db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(id)
  }

  // ---------- projects（项目空间） ----------

  createProject(input: {
    name: string
    workDir: string
    instructions?: string
    providerId?: string
  }): Project {
    const p: Project = {
      id: randomUUID(),
      name: input.name,
      workDir: input.workDir,
      createdAt: Date.now()
    }
    if (input.instructions !== undefined) p.instructions = input.instructions
    if (input.providerId) p.providerId = input.providerId
    this.db
      .prepare(
        `INSERT INTO projects (id, name, work_dir, instructions, provider_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(p.id, p.name, p.workDir, p.instructions ?? null, p.providerId ?? null, p.createdAt)
    return p
  }

  getProject(id: string): Project | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, work_dir AS workDir, instructions, provider_id AS providerId,
                created_at AS createdAt
         FROM projects WHERE id = ?`
      )
      .get(id) as ProjectRow | undefined
    return row && toProject(row)
  }

  /** 全部空间，新的在前 */
  listProjects(): Project[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, work_dir AS workDir, instructions, provider_id AS providerId,
                created_at AS createdAt
         FROM projects ORDER BY created_at DESC, rowid DESC`
      )
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  /** patch 语义：只改传入的字段，未传字段保持原值 */
  updateProject(
    id: string,
    patch: { name?: string; instructions?: string; providerId?: string; workDir?: string }
  ): Project | undefined {
    const cols: string[] = []
    const vals: (string | null)[] = []
    if (patch.name !== undefined) {
      cols.push('name = ?')
      vals.push(patch.name)
    }
    if (patch.instructions !== undefined) {
      cols.push('instructions = ?')
      vals.push(patch.instructions)
    }
    if (patch.providerId !== undefined) {
      cols.push('provider_id = ?')
      vals.push(patch.providerId || null)
    }
    if (patch.workDir !== undefined) {
      cols.push('work_dir = ?')
      vals.push(patch.workDir)
    }
    if (cols.length) {
      this.db.prepare(`UPDATE projects SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getProject(id)
  }

  /** 删空间：任务转为未归类（FK SET NULL），消息/产物一概保留 */
  deleteProject(id: string): void {
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id)
  }

  /**
   * 空间内跨任务产物：只取 file 类且有 relPath 的，按 relPath 去重保留最新一条，
   * 结果新的在前（上限由调用方按 token 预算裁）。
   */
  listArtifactsByProject(projectId: string): ProjectArtifact[] {
    const rows = this.db
      .prepare(
        `SELECT a.id AS id, a.session_id AS sessionId, a.call_id AS callId, a.kind AS kind,
                a.name AS name, a.rel_path AS relPath, a.url AS url, a.created_at AS createdAt,
                s.title AS sessionTitle
         FROM artifacts a JOIN sessions s ON s.id = a.session_id
         WHERE s.project_id = ? AND a.kind = 'file' AND a.rel_path IS NOT NULL AND a.rel_path <> ''
         ORDER BY a.created_at DESC, a.rowid DESC`
      )
      .all(projectId) as Array<{
      id: string
      sessionId: string
      callId: string
      kind: ProjectArtifact['kind']
      name: string
      relPath: string | null
      url: string | null
      createdAt: number
      sessionTitle: string
    }>
    const seen = new Set<string>()
    const out: ProjectArtifact[] = []
    for (const r of rows) {
      const relPath = r.relPath ?? ''
      if (seen.has(relPath)) continue
      seen.add(relPath)
      out.push({
        id: r.id,
        sessionId: r.sessionId,
        callId: r.callId,
        kind: r.kind,
        name: r.name,
        relPath,
        createdAt: r.createdAt,
        sessionTitle: r.sessionTitle
      })
    }
    return out
  }

  // ---------- skills（Stage 4 技能管理） ----------

  listSkillRows(): SkillRow[] {
    const rows = this.db
      .prepare(`SELECT name, dir, enabled, created_at, display_name FROM skills ORDER BY name ASC`)
      .all() as Array<{
      name: string
      dir: string
      enabled: number
      created_at: number
      display_name: string | null
    }>
    return rows.map((r) => ({
      name: r.name,
      dir: r.dir,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      displayName: r.display_name
    }))
  }

  /**
   * 登记技能；同名已存在时刷新 dir，display_name 取新值非空者（null 不覆盖旧显示名），
   * 保留原 enabled（重启重扫不翻转用户设置）。
   */
  upsertSkillRow(row: SkillRow): void {
    this.db
      .prepare(
        `INSERT INTO skills (name, dir, enabled, created_at, display_name) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           dir = excluded.dir,
           display_name = COALESCE(excluded.display_name, skills.display_name)`
      )
      .run(row.name, row.dir, row.enabled ? 1 : 0, row.createdAt, row.displayName ?? null)
  }

  setSkillEnabled(name: string, enabled: boolean): void {
    this.db.prepare(`UPDATE skills SET enabled = ? WHERE name = ?`).run(enabled ? 1 : 0, name)
  }

  deleteSkillRow(name: string): void {
    this.db.prepare(`DELETE FROM skills WHERE name = ?`).run(name)
  }

  // ---------- mcp servers（Stage 5）----------

  listMcpServers(): McpServerInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, transport, config, enabled, created_at, display_name, hub_id, description, category, source_url, stars, call_volume, readme, tools_doc, license, publisher, icon_url, updated_at, view_count FROM mcp_servers ORDER BY created_at ASC`
      )
      .all() as Array<{
      id: string
      name: string
      transport: string
      config: string
      enabled: number
      created_at: number
      display_name: string | null
      hub_id: string | null
      description: string | null
      category: string | null
      source_url: string | null
      stars: number | null
      call_volume: number | null
      readme: string | null
      tools_doc: string | null
      license: string | null
      publisher: string | null
      icon_url: string | null
      updated_at: number | null
      view_count: number | null
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      transport: r.transport as McpTransport,
      config: JSON.parse(r.config) as McpServerInfo['config'],
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      displayName: r.display_name ?? undefined,
      hubId: r.hub_id ?? undefined,
      description: r.description ?? undefined,
      category: parseCategory(r.category),
      sourceUrl: r.source_url ?? undefined,
      stars: r.stars ?? undefined,
      callVolume: r.call_volume ?? undefined,
      readme: r.readme ?? undefined,
      toolsDoc: parseToolsDoc(r.tools_doc),
      license: r.license ?? undefined,
      publisher: r.publisher ?? undefined,
      iconUrl: r.icon_url ?? undefined,
      updatedAt: r.updated_at ?? undefined,
      viewCount: r.view_count ?? undefined
    }))
  }

  getMcpServer(id: string): McpServerInfo | null {
    return this.listMcpServers().find((s) => s.id === id) ?? null
  }

  addMcpServer(input: {
    name: string
    transport: McpTransport
    config: McpServerInfo['config']
    displayName?: string
    hubId?: string
    description?: string
    category?: string[]
    sourceUrl?: string
    stars?: number
    callVolume?: number
    readme?: string
    toolsDoc?: McpToolDoc[]
    license?: string
    publisher?: string
    iconUrl?: string
    updatedAt?: number
    viewCount?: number
  }): McpServerInfo {
    const row: McpServerInfo = {
      id: randomUUID(),
      name: input.name,
      transport: input.transport,
      config: input.config,
      enabled: true,
      createdAt: Date.now(),
      displayName: input.displayName,
      hubId: input.hubId,
      description: input.description,
      category: input.category,
      sourceUrl: input.sourceUrl,
      stars: input.stars,
      callVolume: input.callVolume,
      readme: input.readme,
      toolsDoc: input.toolsDoc,
      license: input.license,
      publisher: input.publisher,
      iconUrl: input.iconUrl,
      updatedAt: input.updatedAt,
      viewCount: input.viewCount
    }
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at, display_name, hub_id, description, category, source_url, stars, call_volume, readme, tools_doc, license, publisher, icon_url, updated_at, view_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.name,
        row.transport,
        JSON.stringify(row.config),
        1,
        row.createdAt,
        row.displayName ?? null,
        row.hubId ?? null,
        row.description ?? null,
        row.category && row.category.length ? JSON.stringify(row.category) : null,
        row.sourceUrl ?? null,
        row.stars ?? null,
        row.callVolume ?? null,
        row.readme ?? null,
        row.toolsDoc && row.toolsDoc.length ? JSON.stringify(row.toolsDoc) : null,
        row.license ?? null,
        row.publisher ?? null,
        row.iconUrl ?? null,
        row.updatedAt ?? null,
        row.viewCount ?? null
      )
    return row
  }

  setMcpServerEnabled(id: string, enabled: boolean): void {
    this.db.prepare(`UPDATE mcp_servers SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
  }

  deleteMcpServer(id: string): void {
    this.db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id)
  }

  // ---------- settings kv（杂项配置；敏感值由调用方先加密再存）----------

  getKv(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings_kv WHERE key = ?`).get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  deleteKv(key: string): void {
    this.db.prepare(`DELETE FROM settings_kv WHERE key = ?`).run(key)
  }

  /**
   * 清空全部业务数据（设置页「清空全部数据」用）：会话/消息/产物/技能登记/
   * MCP 登记/通用偏好全表删除；schema_version 不动，表结构保留。
   * 注意：已连接的 MCP 子进程不在此关闭，调用方负责提示重启。
   */
  wipeAll(): void {
    this.db.exec(`
      DELETE FROM messages;
      DELETE FROM artifacts;
      DELETE FROM sessions;
      DELETE FROM projects;
      DELETE FROM skills;
      DELETE FROM mcp_servers;
      DELETE FROM settings_kv;
    `)
  }
}
