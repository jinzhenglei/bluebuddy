import { describe, expect, it } from 'vitest'
import {
  assetKindOf,
  dirLabel,
  fmtAssetTime,
  fmtSize,
  kindsPresent,
  matchAsset
} from './asset-display'
import type { AssetKind } from './asset-display'
import type { AssetFilter, ProjectAssetEntry } from '@shared/types'

/** 只填判定要用的字段，其余给个能过类型的壳 */
function entry(over: Partial<ProjectAssetEntry>): ProjectAssetEntry {
  return {
    key: over.key ?? 'k',
    source: over.source ?? 'other',
    name: over.name ?? 'a.md',
    relPath: over.relPath ?? 'a.md',
    absPath: over.absPath ?? '/tmp/a.md',
    time: over.time ?? 0
  }
}

/** matchAsset 第二参的形状，测试里反复构造 */
type AssetView = { source: AssetFilter; kind: AssetKind | 'all'; query: string }

function view(over?: Partial<AssetView>): AssetView {
  return { source: 'all', kind: 'all', query: '', ...over }
}

describe('assetKindOf', () => {
  it('按扩展名归类，大小写不敏感', () => {
    expect(assetKindOf('README.md')).toBe('doc')
    expect(assetKindOf('notes.TXT')).toBe('doc')
    expect(assetKindOf('data.csv')).toBe('sheet')
    expect(assetKindOf('路演.pptx')).toBe('slide')
    expect(assetKindOf('index.html')).toBe('web')
    expect(assetKindOf('package.json')).toBe('data')
    expect(assetKindOf('main.ts')).toBe('code')
  })

  it('无扩展名与未知扩展名都归其他', () => {
    expect(assetKindOf('LICENSE')).toBe('other')
    expect(assetKindOf('Makefile.exe~')).toBe('other')
    // 只有结尾那一段算扩展名，中间带点的文件名不受影响
    expect(assetKindOf('report.2026.md')).toBe('doc')
  })
})

describe('fmtAssetTime', () => {
  it('同年写到分，跨年只到日', () => {
    const now = new Date(2026, 9, 12, 10, 0)
    expect(fmtAssetTime(new Date(2026, 9, 2, 20, 35).getTime(), now)).toBe('10月02日 20:35')
    expect(fmtAssetTime(new Date(2025, 0, 5, 8, 9).getTime(), now)).toBe('2025年01月05日')
  })

  it('个位月日补零，列宽才稳', () => {
    const now = new Date(2026, 0, 1, 0, 0)
    expect(fmtAssetTime(new Date(2026, 0, 1, 0, 0).getTime(), now)).toBe('01月01日 00:00')
  })
})

describe('fmtSize', () => {
  it('缺失大小显破折号，其余按量级换单位', () => {
    expect(fmtSize(undefined)).toBe('—')
    expect(fmtSize(0)).toBe('0B')
    expect(fmtSize(1023)).toBe('1023B')
    expect(fmtSize(1024)).toBe('1.0KB')
    expect(fmtSize(1.5 * 1024 * 1024)).toBe('1.5MB')
  })
})

describe('dirLabel', () => {
  it('只到目录，根目录文件另有说法', () => {
    expect(dirLabel('docs/wiki/README.md')).toBe('docs/wiki')
    expect(dirLabel('README.md')).toBe('工作目录根')
    expect(dirLabel('docs/sub/说明.md')).toBe('docs/sub')
    expect(dirLabel()).toBe('—')
  })

  it('反斜杠路径也能切', () => {
    expect(dirLabel('docs\\sub\\a.md')).toBe('docs\\sub')
  })
})

describe('matchAsset', () => {
  const task = entry({ key: 't', source: 'task', name: '报告.docx', relPath: 'out/报告.docx' })
  const other = entry({ key: 'o', source: 'other', name: 'data.csv', relPath: 'data/data.csv' })

  it('三个条件都不限时全部通过', () => {
    expect(matchAsset(task, view())).toBe(true)
    expect(matchAsset(other, view())).toBe(true)
  })

  it('来源档与类型档是相与关系', () => {
    expect(matchAsset(task, view({ source: 'task' }))).toBe(true)
    expect(matchAsset(task, view({ source: 'other' }))).toBe(false)
    expect(matchAsset(other, view({ kind: 'sheet' }))).toBe(true)
    expect(matchAsset(other, view({ kind: 'doc' }))).toBe(false)
    expect(matchAsset(task, view({ source: 'task', kind: 'doc' }))).toBe(true)
    expect(matchAsset(task, view({ source: 'task', kind: 'sheet' }))).toBe(false)
  })

  it('关键词同时命文件名与路径，且大小写不敏感', () => {
    expect(matchAsset(other, view({ query: 'DATA' }))).toBe(true)
    expect(matchAsset(other, view({ query: ' data/' }))).toBe(true)
    expect(matchAsset(other, view({ query: '报告' }))).toBe(false)
    // 前后空格不算条件
    expect(matchAsset(other, view({ query: '   ' }))).toBe(true)
  })
})

describe('kindsPresent', () => {
  const assets = [
    entry({ key: '1', name: 'a.md' }),
    entry({ key: '2', name: 'b.csv' }),
    entry({ key: '3', name: 'c.md' }),
    entry({ key: '4', name: 'main.ts', source: 'task' })
  ]

  it('只返回真实存在的类型，且按固定顺序排', () => {
    expect(kindsPresent(assets, 'all')).toEqual(['doc', 'sheet', 'code'])
  })

  it('来源档会收窄类型集', () => {
    expect(kindsPresent(assets, 'task')).toEqual(['code'])
    expect(kindsPresent(assets, 'other')).toEqual(['doc', 'sheet'])
  })

  it('空列表不占类型行', () => {
    expect(kindsPresent([], 'all')).toEqual([])
  })
})
