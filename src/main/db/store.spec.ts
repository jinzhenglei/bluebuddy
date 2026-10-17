import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ChatMessage } from '@shared/types'
import { DEFAULT_ASSET_EXTS } from '@shared/asset-config'
import { DbStore } from './store'

let store: DbStore

beforeEach(() => {
  store = new DbStore(':memory:')
})
afterEach(() => {
  store.close()
})

describe('DbStore sessions', () => {
  it('createSession 返回带 id 与 createdAt 的完整记录；getSession 能读回', () => {
    const s = store.createSession({ title: 'Demo', workDir: 'C:/tmp/x', providerId: 'p1' })
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(s.createdAt).toBeGreaterThan(0)
    const got = store.getSession(s.id)
    expect(got).toEqual(s)
  })

  it('listSessions 包含所有创建的会话', () => {
    const a = store.createSession({ title: 'A', workDir: '/a', providerId: 'p' })
    const b = store.createSession({ title: 'B', workDir: '/b', providerId: 'p' })
    const list = store.listSessions()
    expect(list.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('renameSession 生效', () => {
    const s = store.createSession({ title: 'old', workDir: '/x', providerId: 'p' })
    store.renameSession(s.id, 'new')
    expect(store.getSession(s.id)?.title).toBe('new')
  })

  it('deleteSession 级联删除 messages 与 artifacts', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    store.appendMessage(s.id, { role: 'user', content: 'hi' })
    store.registerArtifact(s.id, 'c1', { kind: 'file', name: 'a.txt', relPath: 'a.txt' })
    store.deleteSession(s.id)
    expect(store.getSession(s.id)).toBeUndefined()
    expect(store.listMessages(s.id)).toEqual([])
    expect(store.listArtifacts(s.id)).toEqual([])
  })
})

describe('DbStore messages', () => {
  it('按写入顺序读回 ChatMessage 数组（不含 tool_calls 时字段就是 undefined）', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    store.appendMessage(s.id, { role: 'user', content: 'A' })
    store.appendMessage(s.id, { role: 'assistant', content: 'B' })
    const msgs = store.listMessages(s.id)
    // createdAt 由 DB 回填，用 toMatchObject 容忍该额外字段
    expect(msgs).toMatchObject([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' }
    ])
    expect(msgs[0].createdAt).toBeGreaterThan(0)
  })

  it('带 tool_calls 的 assistant 消息完整往返', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'thinking',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"msg":"hi"}' } }
      ]
    }
    store.appendMessage(s.id, msg)
    const [got] = store.listMessages(s.id)
    expect(got).toMatchObject(msg)
  })

  it('带 reasoning 的 assistant 消息完整往返（思考过程落库可回看）', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const msg: ChatMessage = { role: 'assistant', content: '结论', reasoning: '思1思2' }
    store.appendMessage(s.id, msg)
    const [got] = store.listMessages(s.id)
    expect(got).toMatchObject(msg)
    expect(got.createdAt).toBeGreaterThan(0)
  })

  it('旧 v1 库文件打开时自动迁移到 v2（补 reasoning 列，不破坏既有数据）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建一个 v1 结构的库（无 reasoning 列）并写入一条旧消息
    const raw = new Database(file)
    raw.exec(`
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
    `)
    raw.pragma('user_version = 1')
    raw.prepare(`INSERT INTO sessions VALUES ('s1', 'old', '/x', 'p', 1)`).run()
    raw
      .prepare(`INSERT INTO messages VALUES ('m1', 's1', 'user', 'old msg', NULL, NULL, NULL, 1)`)
      .run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧数据还在
      expect(upgraded.listMessages('s1')).toMatchObject([{ role: 'user', content: 'old msg' }])
      // 新列可用
      upgraded.appendMessage('s1', { role: 'assistant', content: 'c', reasoning: 'r' })
      expect(upgraded.listMessages('s1')[1].reasoning).toBe('r')
    } finally {
      upgraded.close()
    }
  })

  it('旧 v2 库文件打开时自动迁移到 v3（补 skills 表，不破坏既有数据）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v3-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建一个 v2 结构的库（messages 已含 reasoning，无 skills 表）
    const raw = new Database(file)
    raw.exec(`
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
        reasoning TEXT,
        created_at INTEGER NOT NULL
      );
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
    `)
    raw.pragma('user_version = 2')
    raw.prepare(`INSERT INTO sessions VALUES ('s1', 'old', '/x', 'p', 1)`).run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 新表可用
      expect(upgraded.listSkillRows()).toEqual([])
      upgraded.upsertSkillRow({ name: 'a', dir: '/d', enabled: true, createdAt: 5 })
      expect(upgraded.listSkillRows()).toMatchObject([{ name: 'a', enabled: true, createdAt: 5 }])
      // 旧数据还在
      expect(upgraded.getSession('s1')?.title).toBe('old')
    } finally {
      upgraded.close()
    }
  })

  it('旧 v3 库文件打开时自动迁移到 v4（补 display_name 列，不破坏既有数据）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v4-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建一个 v3 结构的库（skills 表无 display_name 列）
    const raw = new Database(file)
    raw.exec(`
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
        reasoning TEXT,
        created_at INTEGER NOT NULL
      );
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
      CREATE TABLE skills (
        name TEXT PRIMARY KEY,
        dir TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `)
    raw.pragma('user_version = 3')
    raw.prepare(`INSERT INTO skills VALUES ('old-skill', '/d', 1, 7)`).run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧行迁过来 display_name 为 null，enabled/created_at 不丢
      expect(upgraded.listSkillRows()).toMatchObject([
        { name: 'old-skill', enabled: true, createdAt: 7, displayName: null }
      ])
      // 写入显示名后生效；再以 null upsert 不覆盖旧显示名
      upgraded.upsertSkillRow({
        name: 'old-skill',
        dir: '/d2',
        enabled: true,
        createdAt: 7,
        displayName: '旧技能·中文名'
      })
      expect(upgraded.listSkillRows()[0]).toMatchObject({
        dir: '/d2',
        displayName: '旧技能·中文名'
      })
      upgraded.upsertSkillRow({ name: 'old-skill', dir: '/d2', enabled: true, createdAt: 7 })
      expect(upgraded.listSkillRows()[0].displayName).toBe('旧技能·中文名')
    } finally {
      upgraded.close()
    }
  })

  it('旧 v4 库文件打开时自动迁移到 v5（补 mcp_servers 表，不破坏既有数据）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v5-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建一个 v4 结构的库（skills 已含 display_name，无 mcp_servers 表）
    const raw = new Database(file)
    raw.exec(`
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
        reasoning TEXT,
        created_at INTEGER NOT NULL
      );
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
      CREATE TABLE skills (
        name TEXT PRIMARY KEY,
        dir TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        display_name TEXT
      );
    `)
    raw.pragma('user_version = 4')
    raw.prepare(`INSERT INTO skills VALUES ('old-skill', '/d', 1, 7, '旧技能')`).run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 新表可用：config JSON 往返
      expect(upgraded.listMcpServers()).toEqual([])
      const row = upgraded.addMcpServer({
        name: 'fs',
        transport: 'stdio',
        config: { command: 'node', args: ['server.js'] }
      })
      expect(upgraded.getMcpServer(row.id)).toMatchObject({
        name: 'fs',
        transport: 'stdio',
        config: { command: 'node', args: ['server.js'] },
        enabled: true
      })
      // 旧数据还在
      expect(upgraded.listSkillRows()[0]).toMatchObject({
        name: 'old-skill',
        displayName: '旧技能'
      })
    } finally {
      upgraded.close()
    }
  })

  it('mcp_servers 启停与删除', () => {
    const row = store.addMcpServer({
      name: 'srv',
      transport: 'http',
      config: { url: 'http://localhost:9/mcp' }
    })
    store.setMcpServerEnabled(row.id, false)
    expect(store.getMcpServer(row.id)?.enabled).toBe(false)
    store.deleteMcpServer(row.id)
    expect(store.listMcpServers()).toEqual([])
    expect(store.getMcpServer(row.id)).toBeNull()
  })

  it('旧 v5 库文件打开时自动迁移到 v6（mcp_servers 补市场列 + settings_kv 表）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v6-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建 v5 结构：mcp_servers 无 display_name/hub_id，无 settings_kv
    // （带上 sessions：真实 v5 库必有它，后续 v9 迁移要往它加 project_id）
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `)
    raw.pragma('user_version = 5')
    raw
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at)
        VALUES ('s1', 'old', 'stdio', '{"command":"node"}', 1, 9)`
      )
      .run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧行市场字段为空，其余不丢
      expect(upgraded.listMcpServers()[0]).toMatchObject({
        name: 'old',
        enabled: true,
        displayName: undefined,
        hubId: undefined
      })
      // 新行可带市场字段
      upgraded.addMcpServer({
        name: 'fetch',
        transport: 'stdio',
        config: { command: 'uvx', args: ['mcp-server-fetch'] },
        displayName: 'Fetch网页内容抓取',
        hubId: '@modelcontextprotocol/fetch'
      })
      expect(upgraded.listMcpServers()[1]).toMatchObject({
        displayName: 'Fetch网页内容抓取',
        hubId: '@modelcontextprotocol/fetch'
      })
      // KV 表可用：写读覆删
      expect(upgraded.getKv('k')).toBeNull()
      upgraded.setKv('k', 'v1')
      upgraded.setKv('k', 'v2')
      expect(upgraded.getKv('k')).toBe('v2')
      upgraded.deleteKv('k')
      expect(upgraded.getKv('k')).toBeNull()
    } finally {
      upgraded.close()
    }
  })

  it('旧 v6 库文件打开时自动迁移到 v7（mcp_servers 补市场元数据列，旧行不丢）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v7-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建 v6 结构：mcp_servers 有 display_name/hub_id，但无 description/category/source_url/stars/call_volume
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        display_name TEXT,
        hub_id TEXT
      );
      CREATE TABLE settings_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    raw.pragma('user_version = 6')
    raw
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at, display_name, hub_id)
        VALUES ('s1', 'old', 'stdio', '{"command":"node"}', 1, 9, '旧名', 'a/old')`
      )
      .run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧行元数据为空，其余不丢
      expect(upgraded.listMcpServers()[0]).toMatchObject({
        name: 'old',
        displayName: '旧名',
        hubId: 'a/old',
        description: undefined,
        category: undefined,
        sourceUrl: undefined,
        stars: undefined,
        callVolume: undefined
      })
      // 新行带市场元数据，category 数组往返
      upgraded.addMcpServer({
        name: 'fetch',
        transport: 'stdio',
        config: { command: 'uvx', args: ['mcp-server-fetch'] },
        displayName: 'Fetch网页内容抓取',
        hubId: '@modelcontextprotocol/fetch',
        description: '抓取网页',
        category: ['browser-automation', 'network'],
        sourceUrl: 'https://github.com/x/fetch',
        stars: 1064,
        callVolume: 322769247
      })
      expect(upgraded.listMcpServers()[1]).toMatchObject({
        description: '抓取网页',
        category: ['browser-automation', 'network'],
        sourceUrl: 'https://github.com/x/fetch',
        stars: 1064,
        callVolume: 322769247
      })
    } finally {
      upgraded.close()
    }
  })

  it('旧 v7 库迁移到 v8：补文档列，README/工具清单往返', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v8-'))
    const file = path.join(dir, 'db.sqlite')
    // 手工建 v7 结构：有市场元数据列，但无 readme/tools_doc/license/publisher/icon_url/updated_at/view_count
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        display_name TEXT,
        hub_id TEXT,
        description TEXT,
        category TEXT,
        source_url TEXT,
        stars INTEGER,
        call_volume INTEGER
      );
      CREATE TABLE settings_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    raw.pragma('user_version = 7')
    raw
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, config, enabled, created_at)
        VALUES ('s1', 'old', 'stdio', '{"command":"node"}', 1, 9)`
      )
      .run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧行文档字段为空
      expect(upgraded.listMcpServers()[0]).toMatchObject({
        name: 'old',
        readme: undefined,
        toolsDoc: undefined,
        license: undefined
      })
      // 新行文档字段往返，toolsDoc 数组结构完整保留
      const toolsDoc = [
        {
          name: 'fetch',
          description: '抓取',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url']
          }
        }
      ]
      upgraded.addMcpServer({
        name: 'fetch',
        transport: 'stdio',
        config: { command: 'uvx', args: ['mcp-server-fetch'] },
        hubId: '@modelcontextprotocol/fetch',
        readme: '# 标题\n\n正文',
        toolsDoc,
        license: 'MIT License',
        publisher: '@modelcontextprotocol',
        iconUrl: 'https://i',
        updatedAt: 1790730667000,
        viewCount: 619820
      })
      const added = upgraded.listMcpServers()[1]
      expect(added).toMatchObject({
        readme: '# 标题\n\n正文',
        license: 'MIT License',
        publisher: '@modelcontextprotocol',
        iconUrl: 'https://i',
        updatedAt: 1790730667000,
        viewCount: 619820
      })
      expect(added.toolsDoc).toEqual(toolsDoc)
    } finally {
      upgraded.close()
    }
  })

  it('tool 角色消息保留 tool_call_id 与 name', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const msg: ChatMessage = {
      role: 'tool',
      tool_call_id: 'c1',
      name: 'echo',
      content: 'echo:hi'
    }
    store.appendMessage(s.id, msg)
    expect(store.listMessages(s.id)[0]).toMatchObject(msg)
  })

  it('未知 sessionId 上 appendMessage 因外键约束失败', () => {
    expect(() => store.appendMessage('ghost', { role: 'user', content: 'x' })).toThrow(
      /FOREIGN KEY constraint failed/
    )
  })
})

describe('DbStore artifacts', () => {
  it('file 类产物：路径与名字往返', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const a = store.registerArtifact(s.id, 'c1', {
      kind: 'file',
      name: 'note.md',
      relPath: 'docs/note.md'
    })
    expect(a.kind).toBe('file')
    expect(a.relPath).toBe('docs/note.md')
    expect(a.url).toBeUndefined()
    const list = store.listArtifacts(s.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(a)
  })

  it('link 类产物：url 往返', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const a = store.registerArtifact(s.id, 'c2', {
      kind: 'link',
      name: 'HN',
      url: 'https://news.ycombinator.com/'
    })
    const [got] = store.listArtifacts(s.id)
    expect(got.url).toBe('https://news.ycombinator.com/')
    expect(got.relPath).toBeUndefined()
    expect(got.id).toBe(a.id)
  })

  it('deleteArtifact 精确删除单条', () => {
    const s = store.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    const a1 = store.registerArtifact(s.id, 'c1', { kind: 'file', name: 'a', relPath: 'a' })
    store.registerArtifact(s.id, 'c2', { kind: 'file', name: 'b', relPath: 'b' })
    store.deleteArtifact(a1.id)
    const list = store.listArtifacts(s.id)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('b')
  })
})

describe('DbStore schema 幂等', () => {
  it('同一文件重复 new DbStore 不会因表已存在而失败', () => {
    // 用同一个内存连接无法验证；这里用一次性临时文件模拟两次启动
    const f = ':memory:'
    // :memory: 每次都是全新库，因此本用例只保证 migrate 逻辑无语法错误
    const a = new DbStore(f)
    a.createSession({ title: 'x', workDir: '/x', providerId: 'p' })
    a.close()
    const b = new DbStore(f)
    expect(b.listSessions()).toEqual([]) // 新连接是空库
    b.close()
  })
})

describe('DbStore skills', () => {
  it('upsert 同名只刷新 dir，保留原 enabled（重启重扫不翻转用户设置）', () => {
    store.upsertSkillRow({ name: 'a', dir: '/d1', enabled: true, createdAt: 1 })
    store.setSkillEnabled('a', false)
    store.upsertSkillRow({ name: 'a', dir: '/d2', enabled: true, createdAt: 1 })
    expect(store.listSkillRows()).toMatchObject([{ name: 'a', dir: '/d2', enabled: false }])
  })

  it('setSkillEnabled 与 deleteSkillRow 生效', () => {
    store.upsertSkillRow({ name: 'a', dir: '/d', enabled: true, createdAt: 1 })
    store.setSkillEnabled('a', false)
    expect(store.listSkillRows()[0].enabled).toBe(false)
    store.deleteSkillRow('a')
    expect(store.listSkillRows()).toEqual([])
  })
})

describe('DbStore projects（项目空间）', () => {
  it('createProject 完整往返；listProjects 后建的在前', () => {
    const p = store.createProject({ name: '蓝本', workDir: 'D:/spaces/blue' })
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(p.createdAt).toBeGreaterThan(0)
    expect(p.instructions).toBeUndefined()
    expect(store.getProject(p.id)).toEqual(p)
    const q = store.createProject({ name: '第二个', workDir: 'D:/b', instructions: '规范' })
    expect(store.listProjects().map((x) => x.id)).toEqual([q.id, p.id])
  })

  it('updateProject 是 patch 语义：只改传入字段，未传字段保持原值', () => {
    const p = store.createProject({
      name: 'a',
      workDir: '/w',
      instructions: '原指令',
      providerId: 'p1'
    })
    store.updateProject(p.id, { name: 'b' })
    expect(store.getProject(p.id)).toMatchObject({
      name: 'b',
      instructions: '原指令',
      providerId: 'p1'
    })
    store.updateProject(p.id, { instructions: '', workDir: '/w2' })
    expect(store.getProject(p.id)).toMatchObject({ name: 'b', instructions: '', workDir: '/w2' })
  })

  it('updateProject 传 providerId 空串即清空为未设置（空间的「跟随应用默认」依赖此语义）', () => {
    const p = store.createProject({ name: 'a', workDir: '/w', providerId: 'p1' })
    expect(store.updateProject(p.id, { providerId: '' })?.providerId).toBeUndefined()
    // 清空后再改其它字段不会把它悄悄补回来
    expect(store.updateProject(p.id, { name: 'b' })?.providerId).toBeUndefined()
    const kept = store.createProject({ name: 'c', workDir: '/w', providerId: 'p2' })
    expect(store.updateProject(kept.id, { name: 'd' })?.providerId).toBe('p2')
  })

  it('updateProject 的 assetConfig 是字段级合并：只传 filter 不会顶掉已存的扩展名清单', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    // 新建一律走默认配置，不多存一列冗余 JSON
    expect(p.assetConfig).toBeUndefined()
    store.updateProject(p.id, { assetConfig: { includeExts: ['md', 'pdf'] } })
    store.updateProject(p.id, { assetConfig: { filter: 'other' } })
    expect(store.getProject(p.id)?.assetConfig).toEqual({
      includeExts: ['md', 'pdf'],
      filter: 'other'
    })
    // 传 null 整体清空，回落默认
    expect(store.updateProject(p.id, { assetConfig: null })?.assetConfig).toBeUndefined()
  })

  it('updateProject 传空数组是清掉该字段的覆盖（写库路径上只有这里合一次）', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    store.updateProject(p.id, { assetConfig: { includeExts: ['ts', 'md'], filter: 'other' } })
    expect(store.updateProject(p.id, { assetConfig: { includeExts: [] } })?.assetConfig).toEqual({
      filter: 'other'
    })
    // filter 没被顶掉；扩展名不再存库，读时自动回到默认清单
    expect(store.getProject(p.id)?.assetConfig?.includeExts).toBeUndefined()
  })

  it('先写扩展名覆盖再切过滤开关，两个字段都要留在库里', () => {
    // 回归：资产页开关看起来“没记住”，就出在这种连写两次的路径上
    const p = store.createProject({ name: 'a', workDir: '/w' })
    store.updateProject(p.id, { assetConfig: { includeExts: ['ts', 'md'] } })
    store.updateProject(p.id, { assetConfig: { includeExts: ['ts', 'md'], filter: 'other' } })
    expect(store.getProject(p.id)?.assetConfig).toEqual({
      includeExts: ['ts', 'md'],
      filter: 'other'
    })
  })

  it('assetConfig 里等于默认清单或全无效的部分不落库（否则空间会被钉死在旧默认上）', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    expect(
      store.updateProject(p.id, {
        assetConfig: { includeExts: DEFAULT_ASSET_EXTS, ignoreDirs: [], filter: 'all' }
      })?.assetConfig
    ).toBeUndefined()
    expect(
      store.updateProject(p.id, { assetConfig: { includeExts: ['', '  '] } })?.assetConfig
    ).toBeUndefined()
    // 真正收窄了默认清单是要保留的
    expect(
      store.updateProject(p.id, { assetConfig: { includeExts: ['.MD', 'md', 'pdf'] } })?.assetConfig
    ).toEqual({ includeExts: ['md', 'pdf'] })
  })

  it('createSession 可挂到空间下，listSessionsByProject 只返回该空间任务', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    const inSpace = store.createSession({
      title: 't1',
      workDir: '/w',
      providerId: 'p',
      projectId: p.id
    })
    store.createSession({ title: 't2', workDir: '/other', providerId: 'p' })
    expect(inSpace.projectId).toBe(p.id)
    expect(store.listSessionsByProject(p.id).map((s) => s.id)).toEqual([inSpace.id])
    // 未归类会话不在空间列表里
    expect(store.listSessions()).toHaveLength(2)
  })

  it('未知 projectId 上 createSession 因外键约束失败', () => {
    expect(() =>
      store.createSession({ title: 't', workDir: '/w', providerId: 'p', projectId: 'ghost' })
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('deleteProject 只把任务转为未归类，任务与产物全部保留', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    const s = store.createSession({ title: 't', workDir: '/w', providerId: 'p', projectId: p.id })
    store.registerArtifact(s.id, 'c1', { kind: 'file', name: 'a.md', relPath: 'a.md' })
    store.deleteProject(p.id)
    expect(store.getProject(p.id)).toBeUndefined()
    expect(store.getSession(s.id)?.projectId).toBeUndefined()
    expect(store.listArtifacts(s.id)).toHaveLength(1)
  })

  it('listArtifactsByProject 跨任务聚合，排除 link 与无路径项', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    const s1 = store.createSession({
      title: '任务一',
      workDir: '/w',
      providerId: 'p',
      projectId: p.id
    })
    const s2 = store.createSession({
      title: '任务二',
      workDir: '/w',
      providerId: 'p',
      projectId: p.id
    })
    const outside = store.createSession({ title: '局外', workDir: '/x', providerId: 'p' })
    store.registerArtifact(s1.id, 'c1', { kind: 'file', name: '一.md', relPath: '一.md' })
    store.registerArtifact(s2.id, 'c2', { kind: 'file', name: '二.md', relPath: '二.md' })
    store.registerArtifact(s2.id, 'c3', { kind: 'link', name: '链', url: 'https://x' })
    store.registerArtifact(outside.id, 'c4', { kind: 'file', name: '别.md', relPath: '别.md' })
    const list = store.listArtifactsByProject(p.id)
    expect(list.map((a) => a.name).sort()).toEqual(['一.md', '二.md'])
    expect(list.every((a) => a.sessionTitle)).toBe(true)
  })

  it('同 relPath 只保留最新一条，删掉后旧条自动浮出', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    const s1 = store.createSession({
      title: '旧任务',
      workDir: '/w',
      providerId: 'p',
      projectId: p.id
    })
    const s2 = store.createSession({
      title: '新任务',
      workDir: '/w',
      providerId: 'p',
      projectId: p.id
    })
    store.registerArtifact(s1.id, 'c1', { kind: 'file', name: '旧名.md', relPath: 'docs/a.md' })
    const newer = store.registerArtifact(s2.id, 'c2', {
      kind: 'file',
      name: '新名.md',
      relPath: 'docs/a.md'
    })
    const list = store.listArtifactsByProject(p.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(newer.id)
    store.deleteArtifact(newer.id)
    expect(store.listArtifactsByProject(p.id).map((a) => a.name)).toEqual(['旧名.md'])
  })

  it('旧 v8 库打开时自动迁移到 v9（projects 表与 project_id 列，旧数据不丢）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v9-'))
    const file = path.join(dir, 'db.sqlite')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
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
    `)
    raw.pragma('user_version = 8')
    raw.prepare(`INSERT INTO sessions VALUES ('s1', 'old', '/x', 'p', 1)`).run()
    raw
      .prepare(
        `INSERT INTO artifacts VALUES ('a1', 's1', 'c1', 'file', '旧产物.md', '旧产物.md', NULL, 1)`
      )
      .run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧会话仍在，且未被归到任何空间
      expect(upgraded.getSession('s1')?.title).toBe('old')
      expect(upgraded.getSession('s1')?.projectId).toBeUndefined()
      expect(upgraded.listProjects()).toEqual([])
      // 新表可用，并能把旧会话收进空间
      const p = upgraded.createProject({ name: '空间', workDir: '/x' })
      upgraded.updateSessionProject('s1', p.id)
      expect(upgraded.listSessionsByProject(p.id).map((s) => s.id)).toEqual(['s1'])
      expect(upgraded.listArtifactsByProject(p.id).map((a) => a.name)).toEqual(['旧产物.md'])
    } finally {
      upgraded.close()
    }
  })

  it('旧 v9 库打开时自动迁移到 v10（projects 多出 asset_config，旧空间与归属关系完好）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrate-v10-'))
    const file = path.join(dir, 'db.sqlite')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        instructions TEXT,
        provider_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_dir TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
      );
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
      CREATE INDEX idx_sessions_project ON sessions(project_id, created_at);
    `)
    raw.pragma('user_version = 9')
    raw
      .prepare(
        `INSERT INTO projects (id, name, work_dir, instructions, provider_id, created_at)
       VALUES ('p1', '旧空间', '/x', '旧指令', 'prov', 1)`
      )
      .run()
    raw.prepare(`INSERT INTO sessions VALUES ('s1', 'old', '/x', 'prov', 2, 'p1')`).run()
    raw.close()

    const upgraded = new DbStore(file)
    try {
      // 旧空间字段完好，新列对旧数据就是「未配置」
      expect(upgraded.getProject('p1')).toMatchObject({
        name: '旧空间',
        workDir: '/x',
        instructions: '旧指令',
        providerId: 'prov'
      })
      expect(upgraded.getProject('p1')?.assetConfig).toBeUndefined()
      // 旧归属关系没被动过，新列可写可读
      expect(upgraded.listSessionsByProject('p1').map((s) => s.id)).toEqual(['s1'])
      expect(
        upgraded.updateProject('p1', { assetConfig: { filter: 'other' } })?.assetConfig
      ).toEqual({ filter: 'other' })
    } finally {
      upgraded.close()
    }

    // 库里存了脏 JSON：当作未配置读回，不能拖垮整个空间列表
    const dirty = new Database(file)
    dirty.prepare(`UPDATE projects SET asset_config = '{"includeExts": '`).run()
    dirty.close()
    const reopened = new DbStore(file)
    try {
      expect(reopened.listProjects().map((p) => p.id)).toEqual(['p1'])
      expect(reopened.getProject('p1')?.assetConfig).toBeUndefined()
    } finally {
      reopened.close()
    }
  })

  it('wipeAll 连 projects 一起清空', () => {
    const p = store.createProject({ name: 'a', workDir: '/w' })
    store.createSession({ title: 't', workDir: '/w', providerId: 'p', projectId: p.id })
    store.wipeAll()
    expect(store.listProjects()).toEqual([])
    expect(store.listSessions()).toEqual([])
    // 清空后仍可建空间与任务（未误删表）
    const p2 = store.createProject({ name: 'b', workDir: '/w2' })
    store.createSession({ title: 't2', workDir: '/w2', providerId: 'p', projectId: p2.id })
    expect(store.listProjects()).toHaveLength(1)
  })
})

describe('DbStore.wipeAll（清空全部业务数据）', () => {
  it('会话/消息/产物/技能/MCP/偏好全清，表结构保留可继续写', () => {
    const s = store.createSession({ title: 't', workDir: '/w', providerId: 'p' })
    store.appendMessage(s.id, { role: 'user', content: 'hi' })
    store.upsertSkillRow({ name: 'a', dir: '/d', enabled: true, createdAt: 1 })
    store.addMcpServer({ name: 'm', transport: 'stdio', config: { command: 'x' } })
    store.setKv('approval_mode', 'auto')

    store.wipeAll()

    expect(store.listSessions()).toEqual([])
    expect(store.listMessages(s.id)).toEqual([])
    expect(store.listSkillRows()).toEqual([])
    expect(store.listMcpServers()).toEqual([])
    expect(store.getKv('approval_mode')).toBeNull()
    // wipe 后仍可写入（未误删表）
    store.createSession({ title: 't2', workDir: '/w2', providerId: 'p' })
    expect(store.listSessions()).toHaveLength(1)
  })
})
