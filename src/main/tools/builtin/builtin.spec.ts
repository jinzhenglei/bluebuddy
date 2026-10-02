import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LocalWorkspace } from '../../workspace/local'
import { PathTraversalError } from '../../workspace/provider'
import { ToolContext, ToolResult } from '../types'
import { readFileTool, writeFileTool, listDirTool } from './filesystem'
import { runCommandTool, normalizeArgs } from './terminal'
import { fetchUrlTool } from './web'

let tmpRoot: string

function ctxAt(root: string, fetchImpl?: typeof fetch): ToolContext {
  return {
    workspace: new LocalWorkspace(root),
    fetch: fetchImpl ?? (vi.fn() as unknown as typeof fetch)
  }
}

/**
 * 工具实际签名是 execute(input: I, ctx)，泛型擦除后一律当 unknown 传入，
 * 工具的 zod schema 已定义类型。这里只提供一个类型方便的封装，避免每个测试里写 never。
 * 注意：这个 exec 与 node:child_process.exec 无关，没有 shell 拼接风险。
 */
async function exec(
  t: { execute(input: never, ctx: ToolContext): Promise<ToolResult> },
  args: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  return t.execute(args as never, ctx)
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluebuddy-tools-'))
})
afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})
beforeEach(async () => {
  const entries = await fs.readdir(tmpRoot)
  await Promise.all(
    entries.map((e) => fs.rm(path.join(tmpRoot, e), { recursive: true, force: true }))
  )
})

describe('read_file', () => {
  it('读到工作区内的文件', async () => {
    await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'hello', 'utf-8')
    const r = await exec(readFileTool, { path: 'a.txt' }, ctxAt(tmpRoot))
    expect(r.ok).toBe(true)
    expect(r.content).toBe('hello')
  })

  it('越界路径 execute 直接抛 PathTraversalError（registry 层会包成 ok=false）', async () => {
    await expect(exec(readFileTool, { path: '../outside' }, ctxAt(tmpRoot))).rejects.toThrow(
      PathTraversalError
    )
  })
})

describe('write_file', () => {
  it('写入自动建目录，返回 artifact draft', async () => {
    const r = await exec(writeFileTool, { path: 'docs/note.md', content: '# hi' }, ctxAt(tmpRoot))
    expect(r.ok).toBe(true)
    expect(r.artifact).toMatchObject({ kind: 'file', relPath: 'docs/note.md', name: 'note.md' })
    const onDisk = await fs.readFile(path.join(tmpRoot, 'docs', 'note.md'), 'utf-8')
    expect(onDisk).toBe('# hi')
  })
})

describe('list_dir', () => {
  it('默认列 workspace 根', async () => {
    await fs.writeFile(path.join(tmpRoot, 'x.txt'), 'a')
    await fs.mkdir(path.join(tmpRoot, 'sub'))
    const r = await exec(listDirTool, {}, ctxAt(tmpRoot))
    expect(r.ok).toBe(true)
    expect(r.content).toMatch(/x\.txt/)
    expect(r.content).toMatch(/sub/)
  })

  it('列子目录', async () => {
    await fs.mkdir(path.join(tmpRoot, 'sub'), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, 'sub', 'inner.txt'), 'y')
    const r = await exec(listDirTool, { path: 'sub' }, ctxAt(tmpRoot))
    expect(r.content).toMatch(/inner\.txt/)
  })
})

describe('run_command', () => {
  it('标记 requiresApproval=true', () => {
    expect(runCommandTool.requiresApproval).toBe(true)
  })

  it('approvalReason 描述命令与参数', () => {
    const reason = runCommandTool.approvalReason!({ command: 'git', args: ['status', '-s'] })
    expect(reason).toContain('git')
    expect(reason).toContain('status')
    expect(reason).toContain('-s')
  })

  it('approvalReason 对非数组 args（模型常犯）容错，不抛异常', () => {
    // 模拟 zod 校验前的原始解析：args 被误写成字符串
    const bad = { command: 'ls', args: '-la' } as unknown as {
      command: string
      args?: string[]
    }
    expect(() => runCommandTool.approvalReason!(bad)).not.toThrow()
    expect(runCommandTool.approvalReason!(bad)).toContain('-la')
    // args 完全缺失也不能报错
    expect(() => runCommandTool.approvalReason!({ command: 'pwd' })).not.toThrow()
  })

  it('执行 node 命令捕获 stdout + exit 0', async () => {
    const r = await exec(
      runCommandTool,
      { command: process.execPath, args: ['-e', 'console.log("hi")'] },
      ctxAt(tmpRoot)
    )
    expect(r.ok).toBe(true)
    expect(r.content).toContain('hi')
    expect(r.content).toContain('exit: 0')
  })

  it('非零退出码返回 ok=false', async () => {
    const r = await exec(
      runCommandTool,
      { command: process.execPath, args: ['-e', 'process.exit(3)'] },
      ctxAt(tmpRoot)
    )
    expect(r.ok).toBe(false)
    expect(r.content).toContain('exit: 3')
  })

  it('默认 args 为空时能完成一次安全调用', async () => {
    const r = await exec(
      runCommandTool,
      { command: process.execPath, args: ['--version'] },
      ctxAt(tmpRoot)
    )
    expect(r.ok).toBe(true)
    expect(r.content).toMatch(/v\d+\.\d+/)
  })

  it('normalizeArgs 把模型常见的错误形态归一为参数数组', () => {
    expect(normalizeArgs(null)).toEqual([])
    expect(normalizeArgs(undefined)).toEqual([])
    expect(normalizeArgs(['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeArgs('-la')).toEqual(['-la'])
    expect(normalizeArgs('status --short')).toEqual(['status', '--short'])
    // 关键：用户现场遇到的字面量 "[/t]"
    expect(normalizeArgs('[/t]')).toEqual(['/t'])
    expect(normalizeArgs('["a","b"]')).toEqual(['a', 'b'])
    expect(normalizeArgs('[]')).toEqual([])
  })

  it('schema 会把字符串 args 预处理成数组，不再因类型错误而卡住', () => {
    const parsed = runCommandTool.parameters.safeParse({ command: 'date', args: '[/t]' })
    expect(parsed.success).toBe(true)
    expect((parsed as { data: { args: string[] } }).data.args).toEqual(['/t'])
    // 缺省 args 时默认空数组
    const p2 = runCommandTool.parameters.safeParse({ command: 'pwd' })
    expect((p2 as { data: { args: string[] } }).data.args).toEqual([])
  })
})

describe('fetch_url', () => {
  it('正常返回截断前的文本', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('hello world', { status: 200 })
    }) as unknown as typeof fetch
    const r = await exec(fetchUrlTool, { url: 'https://example.com' }, ctxAt(tmpRoot, fetchMock))
    expect(r.ok).toBe(true)
    expect(r.content).toContain('hello world')
    expect(r.content).toContain('status: 200')
    expect(r.artifact).toMatchObject({ kind: 'link', url: 'https://example.com' })
  })

  it('超过 100KB 截断并加标记', async () => {
    const big = 'x'.repeat(150_000)
    const fetchMock = vi.fn(
      async () => new Response(big, { status: 200 })
    ) as unknown as typeof fetch
    const r = await exec(fetchUrlTool, { url: 'https://example.com' }, ctxAt(tmpRoot, fetchMock))
    expect(r.content).toContain('[truncated]')
    expect(r.content.length).toBeLessThan(120_000)
  })

  it('非 200 状态返回 ok=false 但 content 仍含状态码', async () => {
    const fetchMock = vi.fn(
      async () => new Response('nope', { status: 404 })
    ) as unknown as typeof fetch
    const r = await exec(fetchUrlTool, { url: 'https://example.com' }, ctxAt(tmpRoot, fetchMock))
    expect(r.ok).toBe(false)
    expect(r.content).toContain('status: 404')
  })

  it('拒绝非 http(s) 协议：zod 校验层拦截 file://', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    // 直接用工具 parameters 校验，绕过 execute 观察 zod 结果
    const parsed = fetchUrlTool.parameters.safeParse({ url: 'file:///etc/passwd' })
    expect(parsed.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
