import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LocalWorkspace } from './local'
import { PathTraversalError } from './provider'

/**
 * 集成测试：在临时目录中创建一个 workspace root，验证 LocalWorkspace 的所有行为。
 * 每个用例前重置 root 内容。
 */

let tmpRoot: string
let ws: LocalWorkspace

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-ws-'))
})

afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  // 清空 root 内容
  const entries = await fs.readdir(tmpRoot)
  await Promise.all(
    entries.map((e) => fs.rm(path.join(tmpRoot, e), { recursive: true, force: true }))
  )
  ws = new LocalWorkspace(tmpRoot)
})

describe('LocalWorkspace.resolve 路径安全', () => {
  it('相对路径拼上 root 返回绝对路径', () => {
    const abs = ws.resolve('sub/hello.txt')
    expect(abs).toBe(path.join(tmpRoot, 'sub', 'hello.txt'))
  })

  it('空字符串解析为 root 本身', () => {
    expect(ws.resolve('')).toBe(tmpRoot)
  })

  it('点号当前目录不越界', () => {
    const abs = ws.resolve('./a/b')
    expect(abs.startsWith(tmpRoot)).toBe(true)
  })

  it('拒绝 ../ 越界访问', () => {
    expect(() => ws.resolve('../../etc/passwd')).toThrow(PathTraversalError)
  })

  it('拒绝混合式 .. 逃逸：a/../../outside', () => {
    expect(() => ws.resolve('a/../../outside')).toThrow(PathTraversalError)
  })

  it('root 内的绝对路径允许（同盘场景）', () => {
    const inside = path.join(tmpRoot, 'sub', 'file.txt')
    expect(ws.resolve(inside)).toBe(inside)
  })

  it('root 外的绝对路径拒绝', () => {
    const outside = path.resolve(tmpRoot, '..', 'outside.txt')
    expect(() => ws.resolve(outside)).toThrow(PathTraversalError)
  })

  it('兄弟目录同名前缀不算 inside（防 /tmp/root vs /tmp/root-evil 混淆）', () => {
    const sibling = tmpRoot + '-evil'
    expect(() => ws.resolve(sibling + path.sep + 'x.txt')).toThrow(PathTraversalError)
  })
})

describe('LocalWorkspace 文件读写', () => {
  it('writeFile 自动创建中间目录，readFile 能读回', async () => {
    await ws.writeFile('a/b/c.txt', 'hello')
    const content = await ws.readFile('a/b/c.txt')
    expect(content).toBe('hello')
  })

  it('readFile 越界路径抛 PathTraversalError', async () => {
    await expect(ws.readFile('../outside')).rejects.toThrow(PathTraversalError)
  })

  it('writeFile 越界路径抛 PathTraversalError', async () => {
    await expect(ws.writeFile('../evil.txt', 'x')).rejects.toThrow(PathTraversalError)
  })

  it('readFile 不存在的文件抛 ENOENT', async () => {
    await expect(ws.readFile('missing.txt')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('LocalWorkspace.listDir', () => {
  it('返回目录内文件和子目录，带 isDir 与 size', async () => {
    await ws.writeFile('one.txt', 'aaa')
    await ws.writeFile('sub/two.txt', 'bb')
    const entries = await ws.listDir('.')
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['one.txt', 'sub'])
    const sub = entries.find((e) => e.name === 'sub')!
    expect(sub.isDir).toBe(true)
    const one = entries.find((e) => e.name === 'one.txt')!
    expect(one.isDir).toBe(false)
    expect(one.size).toBe(3)
  })

  it('不存在的目录抛 ENOENT', async () => {
    await expect(ws.listDir('missing')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('越界目录抛 PathTraversalError', async () => {
    await expect(ws.listDir('..')).rejects.toThrow(PathTraversalError)
  })
})

describe('LocalWorkspace.exec', () => {
  it('在工作根下执行命令，返回 stdout 与 exitCode=0', async () => {
    // 用 node 本身，跨平台且无需依赖系统命令
    const r = await ws.exec(process.execPath, ['-e', 'console.log(process.cwd())'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe(tmpRoot)
  })

  it('非零退出码正确回传', async () => {
    const r = await ws.exec(process.execPath, ['-e', 'process.exit(42)'])
    expect(r.exitCode).toBe(42)
  })

  it('stderr 分离捕获', async () => {
    const r = await ws.exec(process.execPath, ['-e', 'console.error("boom"); console.log("out")'])
    expect(r.stdout).toContain('out')
    expect(r.stderr).toContain('boom')
  })

  it('命令不存在时不抛异常，走 error 事件返回 exitCode=-1', async () => {
    const r = await ws.exec('__definitely_not_a_real_command_xyz__', [])
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toMatch(/ENOENT|not found|cannot find/i)
  })

  it('超时强杀挂死命令，返回 exitCode=-1 + 超时提示（不再永久挂起）', async () => {
    const r = await ws.exec(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], {
      timeoutMs: 200
    })
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toMatch(/timed out/i)
  })

  it('预先 abort 的信号立即杀进程', async () => {
    const c = new AbortController()
    c.abort()
    const r = await ws.exec(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], {
      signal: c.signal
    })
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toMatch(/aborted/i)
  })

  it('运行中 abort 会杀掉子进程', async () => {
    const c = new AbortController()
    const p = ws.exec(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { signal: c.signal })
    setTimeout(() => c.abort(), 100)
    const r = await p
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toMatch(/aborted/i)
  })

  it('立即关闭 stdin：读 stdin 的命令收到 EOF 而非永久等待', async () => {
    const script =
      'let d="";process.stdin.on("data",(x)=>d+=x);process.stdin.on("end",()=>console.log("eof:"+d))'
    const r = await ws.exec(process.execPath, ['-e', script])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('eof:')
  })
})

describe('LocalWorkspace 只读可信根 readRoots（技能目录）', () => {
  let skillRoot: string
  beforeEach(async () => {
    skillRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-skills-'))
    ws = new LocalWorkspace(tmpRoot, { readRoots: [skillRoot] })
  })
  afterEach(async () => {
    if (skillRoot) await fs.rm(skillRoot, { recursive: true, force: true })
  })

  it('readFile 可读 readRoot 内的绝对路径文件（技能自带脚本）', async () => {
    const f = path.join(skillRoot, 'legal-query', 'scripts', 'query_index.py')
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, 'print(1)', 'utf-8')
    expect(await ws.readFile(f)).toBe('print(1)')
  })

  it('listDir 可列 readRoot 内目录', async () => {
    await fs.mkdir(path.join(skillRoot, 's1', 'scripts'), { recursive: true })
    await fs.writeFile(path.join(skillRoot, 's1', 'scripts', 'a.py'), 'x', 'utf-8')
    const names = (await ws.listDir(path.join(skillRoot, 's1', 'scripts'))).map((e) => e.name)
    expect(names).toEqual(['a.py'])
  })

  it('writeFile 到 readRoot 内（工作区外）仍被拒：写锁不放宽', async () => {
    await expect(ws.writeFile(path.join(skillRoot, 'evil.txt'), 'x')).rejects.toThrow(
      PathTraversalError
    )
  })

  it('readRoot 兄弟目录同名前缀不算 inside', async () => {
    const evil = skillRoot + '-evil'
    await fs.mkdir(evil, { recursive: true })
    try {
      await expect(ws.readFile(path.join(evil, 'x.txt'))).rejects.toThrow(PathTraversalError)
    } finally {
      await fs.rm(evil, { recursive: true, force: true })
    }
  })

  it('越出 root 与全部 readRoot 的绝对路径仍被拒', async () => {
    await expect(
      ws.readFile(path.resolve(tmpRoot, '..', '..', 'definitely-outside-xyz.txt'))
    ).rejects.toThrow(PathTraversalError)
  })
})
