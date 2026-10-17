import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveAssetConfig } from '@shared/asset-config'
import { scanWorkspaceAssets } from './scan-assets'

const dirs: string[] = []

function makeTree(relatives: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-scan-'))
  dirs.push(root)
  for (const rel of relatives) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, 'x')
  }
  return root
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop() as string
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function relPathsOf(root: string, cfg = resolveAssetConfig(undefined)): string[] {
  return scanWorkspaceAssets(root, cfg).files.map((f) => f.relPath)
}

describe('scanWorkspaceAssets', () => {
  it('只收白名单扩展名，relPath 一律正斜杠', () => {
    const root = makeTree([
      '报告.md',
      'notes.txt',
      'data.csv',
      'main.ts',
      'LICENSE',
      'docs/说明.md',
      'docs/sub.json'
    ])
    const got = relPathsOf(root).sort()
    expect(got).toEqual(['data.csv', 'docs/sub.json', 'docs/说明.md', 'notes.txt', '报告.md'])
    expect(got).not.toContain('main.ts')
  })

  it('忽略目录整棵剪枝，且大小写不敏感', () => {
    const root = makeTree([
      'keep.md',
      'node_modules/pkg/readme.md',
      'dist/bundle.md',
      // 大小写不同也照样剪枝
      'App/Node_Modules/pkg/readme.md',
      // 只按路径段命中，文件名里带 node_modules 的照常收
      'docs/node_modules_notes.md'
    ])
    expect(relPathsOf(root).sort()).toEqual(['docs/node_modules_notes.md', 'keep.md'])
  })

  it('深度到顶只停在下探，当前层文件照常收', () => {
    const root = makeTree(['a.md', 'sub/b.md', 'sub/deep/c.md'])
    expect(
      scanWorkspaceAssets(root, resolveAssetConfig(undefined), { maxDepth: 1 }).files.map(
        (f) => f.relPath
      )
    ).toEqual(['a.md'])
    expect(
      scanWorkspaceAssets(root, resolveAssetConfig(undefined), { maxDepth: 2 })
        .files.map((f) => f.relPath)
        .sort()
    ).toEqual(['a.md', 'sub/b.md'])
  })

  it('条数上限触发 truncated，且确实只返回上限个', () => {
    const root = makeTree(['a.md', 'b.md', 'c.md', 'd.md'])
    const res = scanWorkspaceAssets(root, resolveAssetConfig(undefined), { maxFiles: 2 })
    expect(res.files).toHaveLength(2)
    expect(res.truncated).toBe(true)
    expect(scanWorkspaceAssets(root, resolveAssetConfig(undefined)).truncated).toBe(false)
  })

  it('带上文件大小与修改时间，供资产列表排序与展示', () => {
    const root = makeTree(['a.md'])
    const [first] = scanWorkspaceAssets(root, resolveAssetConfig(undefined)).files
    expect(first.size).toBeGreaterThan(0)
    expect(first.mtime).toBeGreaterThan(0)
    expect(first.name).toBe('a.md')
    expect(path.isAbsolute(first.absPath)).toBe(true)
  })

  it('根目录不存在或不是目录时回 error，不抛异常', () => {
    const missing = scanWorkspaceAssets(
      path.join(os.tmpdir(), 'bb-not-exists-xyz'),
      resolveAssetConfig(undefined)
    )
    expect(missing.files).toEqual([])
    expect(missing.truncated).toBe(false)
    expect(missing.error).toContain('不可访问')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-scan-'))
    dirs.push(dir)
    const aFile = path.join(dir, 'f.md')
    fs.writeFileSync(aFile, 'x')
    expect(scanWorkspaceAssets(aFile, resolveAssetConfig(undefined)).error).toContain('不是目录')
  })

  it('符号链接跳过（环境不允许创建软链时本条自动略过）', () => {
    const root = makeTree(['real.md'])
    let created = true
    try {
      fs.symlinkSync(path.join(root, 'real.md'), path.join(root, 'link.md'))
      fs.symlinkSync(root, path.join(root, 'loop'), 'dir')
    } catch {
      created = false // Windows 建软链需要开发者模式/管理员权限
    }
    if (!created) return
    const got = relPathsOf(root)
    expect(got).toEqual(['real.md'])
  })

  it('用户覆盖的扩展名与忽略目录都参与扫描', () => {
    const root = makeTree(['a.ts', 'b.md', 'docs/c.md', 'notes/d.md'])
    const cfg = resolveAssetConfig({ includeExts: ['ts', 'md'], ignoreDirs: ['docs'] })
    expect(relPathsOf(root, cfg).sort()).toEqual(['a.ts', 'b.md', 'notes/d.md'])
  })
})
