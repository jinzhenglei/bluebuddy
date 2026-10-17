import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveAssetConfig } from '@shared/asset-config'
import { collectProjectAssets } from './project-assets'
import type { ProjectAssetSource } from './project-assets'

const dirs: string[] = []

function makeDir(relatives: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-assets-'))
  dirs.push(root)
  for (const rel of relatives) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, 'content')
  }
  return root
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop() as string
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function fakeDb(
  artifacts: Array<{
    id: string
    name: string
    relPath: string
    createdAt: number
    sessionTitle: string
  }>
): ProjectAssetSource {
  return { listArtifactsByProject: () => artifacts }
}

describe('collectProjectAssets', () => {
  it('任务写过的文件只出一条且归为 task，不会被扫描再列一遍', () => {
    const root = makeDir(['报告.md', '手工放的.md'])
    const db = fakeDb([
      { id: 'a1', name: '报告.md', relPath: '报告.md', createdAt: 1000, sessionTitle: '写报告' }
    ])
    const res = collectProjectAssets(db, { id: 'p', workDir: root }, resolveAssetConfig(undefined))
    const hit = res.assets.filter((a) => a.relPath === '报告.md')
    expect(hit).toHaveLength(1)
    expect(hit[0].source).toBe('task')
    expect(hit[0].sessionTitle).toBe('写报告')
    expect(res.assets.map((a) => a.source)).toEqual(['other', 'task']) // 手工文件 mtime 更新
    expect(res.counts).toEqual({ all: 2, task: 1, other: 1 })
    expect(res.ok).toBe(true)
  })

  it('未登记的源码类文件按默认配置不进列表，改了配置就进', () => {
    const root = makeDir(['notes.md', 'main.ts'])
    const db = fakeDb([])
    const byDefault = collectProjectAssets(
      db,
      { id: 'p', workDir: root },
      resolveAssetConfig(undefined)
    )
    expect(byDefault.assets.map((a) => a.relPath)).toEqual(['notes.md'])

    const withTs = collectProjectAssets(
      db,
      { id: 'p', workDir: root },
      resolveAssetConfig({ includeExts: ['ts', 'md'] })
    )
    expect(withTs.assets.map((a) => a.relPath).sort()).toEqual(['main.ts', 'notes.md'])
    expect(withTs.counts.other).toBe(2)
  })

  it('两类按时间倒序混排，任务产物用登记时间、其他途径用 mtime', () => {
    const root = makeDir(['old.md'])
    // 把老文件的 mtime 明确压到很早，避免与 createdAt 同毫秒导致排序不稳定
    const t = new Date(Date.now() - 60_000)
    fs.utimesSync(path.join(root, 'old.md'), t, t)
    const db = fakeDb([
      { id: 'a1', name: 'new.md', relPath: 'new.md', createdAt: Date.now(), sessionTitle: 's' }
    ])
    const res = collectProjectAssets(db, { id: 'p', workDir: root }, resolveAssetConfig(undefined))
    expect(res.assets.map((a) => a.relPath)).toEqual(['new.md', 'old.md'])
  })

  it('工作目录不可访问时 ok=false，但任务产物照常返回', () => {
    const missing = path.join(os.tmpdir(), 'bb-assets-not-exists-xyz')
    const db = fakeDb([
      { id: 'a1', name: 'a.md', relPath: 'a.md', createdAt: 1, sessionTitle: 's' }
    ])
    const res = collectProjectAssets(
      db,
      { id: 'p', workDir: missing },
      resolveAssetConfig(undefined)
    )
    expect(res.ok).toBe(false)
    expect(res.error).toContain('不可访问')
    expect(res.assets.map((a) => a.key)).toEqual(['task:a1'])
    expect(res.counts).toEqual({ all: 1, task: 1, other: 0 })
  })

  it('counts 与 assets 始终自洽（扫描层的上限与 truncated 在 scan-assets.spec 里验）', () => {
    const root = makeDir(['a.md', 'b.md', 'c.md'])
    const res = collectProjectAssets(
      fakeDb([]),
      { id: 'p', workDir: root },
      resolveAssetConfig({ includeExts: ['md'] })
    )
    expect(res.truncated).toBe(false)
    expect(res.counts.all).toBe(res.assets.length)
    expect(res.counts.task + res.counts.other).toBe(res.counts.all)
    expect(res.counts.other).toBe(3)
    expect(new Set(res.assets.map((a) => a.key)).size).toBe(res.assets.length)
  })
})
