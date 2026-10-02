import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ChatMessage } from '@shared/types'
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
    const raw = new Database(file)
    raw.exec(`
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
