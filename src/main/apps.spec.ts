import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  expandEnv,
  detectIdes,
  openFolderInIde,
  registerOpenCodeProject,
  type DetectProbes
} from './apps'

/**
 * apps.ts 纯逻辑单测：用注入探针模拟"装了哪些 IDE"，不依赖真实环境/Electron。
 */

function makeProbes(opts: {
  env?: Record<string, string | undefined>
  files?: string[]
  dirs?: Record<string, string[]>
  path?: Record<string, string>
}): DetectProbes {
  const files = new Set(opts.files ?? [])
  const dirs = opts.dirs ?? {}
  const pathMap = opts.path ?? {}
  return {
    env: opts.env ?? {},
    exists: (p) => files.has(p),
    readDir: (p) => dirs[p] ?? [],
    which: (cmd) => pathMap[cmd] ?? null
  }
}

describe('expandEnv', () => {
  it('大小写不敏感地展开 %VAR%', () => {
    const out = expandEnv('%ProgramFiles%\\app\\a.exe', { programfiles: 'C:\\PF' })
    expect(out).toBe(path.join('C:\\PF', 'app', 'a.exe').replace(/\\/g, path.sep))
  })

  it('有未解析变量时返回 null', () => {
    expect(expandEnv('%NOPE%\\x', { OTHER: 'y' })).toBeNull()
  })
})

describe('detectIdes', () => {
  it('扫描安装目录命中主程序 exe（排除卸载器）', () => {
    const probes = makeProbes({
      env: { ProgramFiles: 'C:\\PF' },
      dirs: { 'C:\\PF\\Microsoft VS Code': ['Code.exe', 'unins000.exe'] }
    })
    const vscode = detectIdes(probes).find((a) => a.id === 'vscode')
    expect(vscode).toMatchObject({ name: 'Visual Studio Code', source: 'auto' })
    expect(vscode?.path).toBe('C:\\PF\\Microsoft VS Code\\Code.exe')
  })

  it('主程序名带空格（如 "Qoder IDE.exe"）也能命中', () => {
    const probes = makeProbes({
      env: { ProgramFiles: 'C:\\PF' },
      dirs: { 'C:\\PF\\Qoder IDE': ['unins000.exe', 'Qoder IDE.exe'] }
    })
    const qoder = detectIdes(probes).find((a) => a.id === 'qoder')
    expect(qoder?.path).toBe('C:\\PF\\Qoder IDE\\Qoder IDE.exe')
  })

  it('排除 "Uninstall *.exe" 不致误命中', () => {
    const probes = makeProbes({
      env: { LOCALAPPDATA: 'C:\\LA' },
      dirs: { 'C:\\LA\\Programs\\@opencode-aidesktop': ['Uninstall OpenCode.exe', 'OpenCode.exe'] }
    })
    const oc = detectIdes(probes).find((a) => a.id === 'opencode')
    expect(oc?.path).toBe('C:\\LA\\Programs\\@opencode-aidesktop\\OpenCode.exe')
  })

  it('扫描 JetBrains 子目录 bin 命中', () => {
    const probes = makeProbes({
      env: { ProgramFiles: 'C:\\PF' },
      dirs: { 'C:\\PF\\JetBrains': ['IntelliJ IDEA 2024.1', 'notepad'] },
      files: ['C:\\PF\\JetBrains\\IntelliJ IDEA 2024.1\\bin\\idea64.exe']
    })
    const idea = detectIdes(probes).find((a) => a.id === 'idea')
    expect(idea?.path).toBe('C:\\PF\\JetBrains\\IntelliJ IDEA 2024.1\\bin\\idea64.exe')
  })

  it('PATH 上 CLI 兜底命中', () => {
    const probes = makeProbes({ env: {}, path: { cursor: 'C:\\cursor\\bin\\cursor.exe' } })
    const cursor = detectIdes(probes).find((a) => a.id === 'cursor')
    expect(cursor?.path).toBe('C:\\cursor\\bin\\cursor.exe')
  })

  it('什么都没装时返回空数组', () => {
    expect(detectIdes(makeProbes({}))).toEqual([])
  })

  it('优先级：目录扫描命中胜过 CLI 兜底', () => {
    const probes = makeProbes({
      env: { LOCALAPPDATA: 'C:\\LA' },
      dirs: { 'C:\\LA\\Programs\\Trae': ['Trae.exe'] },
      path: { trae: 'C:\\somewhere\\trae.exe' }
    })
    const trae = detectIdes(probes).find((a) => a.id === 'trae')
    expect(trae?.path).toBe('C:\\LA\\Programs\\Trae\\Trae.exe')
  })

  it('OpenCode 带出它 GUI 状态库的绝对路径（%APPDATA% 已展开）', () => {
    const probes = makeProbes({
      env: { LOCALAPPDATA: 'C:\\LA', APPDATA: 'C:\\AA' },
      dirs: { 'C:\\LA\\Programs\\@opencode-aidesktop': ['OpenCode.exe'] }
    })
    const oc = detectIdes(probes).find((a) => a.id === 'opencode')
    expect(oc?.shellLaunch).toBe(true)
    expect(oc?.projectStateDb).toBe('C:\\AA\\ai.opencode.desktop\\drafts.sqlite')
  })
})

describe('registerOpenCodeProject（把工作目录登记进 OpenCode 项目列表头部）', () => {
  const NAME = 'opencode.global.dat'
  const KEY = 'server'
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'bb-oc-'))

  /** 造一个与 OpenCode 同构的状态库，初始 projects.local 为给定条目 */
  const makeDb = (worktrees: string[], tag: string): string => {
    const file = path.join(tmpRoot, `drafts-${tag}.sqlite`)
    const db = new Database(file)
    db.exec(
      'CREATE TABLE state (name text NOT NULL, key text NOT NULL, value text NOT NULL, updated_at integer NOT NULL, CONSTRAINT state_pk PRIMARY KEY (name, key))'
    )
    db.prepare('INSERT INTO state (name, key, value, updated_at) VALUES (?,?,?,?)').run(
      NAME,
      KEY,
      JSON.stringify({
        list: [],
        hidden: {},
        projects: { local: worktrees.map((w) => ({ worktree: w, expanded: true })) }
      }),
      0
    )
    db.close()
    return file
  }

  const readValue = (file: string): string => {
    const db = new Database(file, { readonly: true })
    try {
      return (
        db.prepare('SELECT value FROM state WHERE name=? AND key=?').get(NAME, KEY) as {
          value: string
        }
      ).value
    } finally {
      db.close()
    }
  }

  const readWorktrees = (file: string): string[] =>
    (JSON.parse(readValue(file)).projects.local as { worktree: string }[]).map((p) => p.worktree)

  it('新目录插到头部；重复登记不重复插入', () => {
    const file = makeDb(['D:\\work\\LinkCode', 'D:\\work\\OpenWorkBuddy'], 'head')
    expect(registerOpenCodeProject(file, 'D:\\work\\AgentWorker')).toBe(true)
    expect(readWorktrees(file)).toEqual([
      'D:\\work\\AgentWorker',
      'D:\\work\\LinkCode',
      'D:\\work\\OpenWorkBuddy'
    ])
    expect(registerOpenCodeProject(file, 'D:\\work\\AgentWorker')).toBe(false)
    expect(readWorktrees(file)).toHaveLength(3)
  })

  it('正斜杠与大小写差异视为同一目录，不新增条目', () => {
    const file = makeDb(['D:\\work\\Demo'], 'same')
    expect(registerOpenCodeProject(file, 'D:/work/demo/')).toBe(false)
    expect(readWorktrees(file)).toEqual(['D:\\work\\Demo'])
  })

  it('库不存在 / 缺 projects.local 时返回 false 且不改原值', () => {
    expect(registerOpenCodeProject(path.join(tmpRoot, 'no-such.sqlite'), 'D:\\x')).toBe(false)
    const bad = path.join(tmpRoot, 'bad.sqlite')
    const db = new Database(bad)
    db.exec('CREATE TABLE state (name text, key text, value text, updated_at integer)')
    db.prepare('INSERT INTO state VALUES (?,?,?,?)').run(NAME, KEY, '{"list":[]}', 0)
    db.close()
    expect(registerOpenCodeProject(bad, 'D:\\x')).toBe(false)
    expect(readValue(bad)).toBe('{"list":[]}')
  })
})

describe('openFolderInIde 入参校验（不实际启动）', () => {
  it('exe 非绝对路径被拒', async () => {
    const r = openFolderInIde('relative/App.exe', 'C:\\work')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/绝对路径/)
  })

  it('exe 不存在被拒', () => {
    const r = openFolderInIde('C:\\__no_such_ide__.exe', 'C:\\work')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/找不到可执行文件/)
  })

  it('folder 非绝对路径被拒（exe 用真实存在的 node）', () => {
    const r = openFolderInIde(process.execPath, 'relative-folder')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/文件夹路径必须为绝对路径/)
  })
})
