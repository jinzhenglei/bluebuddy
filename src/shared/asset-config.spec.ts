import { describe, expect, it } from 'vitest'
import {
  ASSET_SCAN_MAX_DEPTH,
  ASSET_SCAN_MAX_FILES,
  DEFAULT_ASSET_EXTS,
  DEFAULT_ASSET_IGNORE_DIRS,
  compactAssetConfig,
  extOf,
  formatNameList,
  matchesAssetFile,
  mergeAssetConfig,
  normalizeAssetKey,
  normalizeExtList,
  normalizeNameList,
  parseNameList,
  planAssetConfigWrite,
  resolveAssetConfig,
  sanitizeAssetConfig
} from './asset-config'

describe('资产识别默认配置', () => {
  it('默认白名单只收文档/数据类文本，刻意不含源码扩展名', () => {
    expect(DEFAULT_ASSET_EXTS).toContain('md')
    expect(DEFAULT_ASSET_EXTS).toContain('csv')
    for (const src of ['ts', 'tsx', 'js', 'py', 'go', 'rs', 'java']) {
      expect(DEFAULT_ASSET_EXTS).not.toContain(src)
    }
    // 密钥/环境类文件绝不进默认白名单（会被列进资产表并注入提示词）
    expect(DEFAULT_ASSET_EXTS).not.toContain('env')
  })

  it('默认忽略目录覆盖前端与 Python 常见的生成目录', () => {
    for (const d of ['node_modules', 'dist', 'out', '.git', '__pycache__']) {
      expect(DEFAULT_ASSET_IGNORE_DIRS).toContain(d)
    }
  })

  it('扫描上限是显式常量，供主进程与文案共用', () => {
    expect(ASSET_SCAN_MAX_DEPTH).toBeGreaterThan(0)
    expect(ASSET_SCAN_MAX_FILES).toBeGreaterThanOrEqual(100)
  })
})

describe('normalizeNameList', () => {
  it('去空格、转小写、去重；目录用的清单保留前导点（.git 不能被剔成 git）', () => {
    expect(normalizeNameList([' .git ', '.GIT ', 'node_modules', '', '  '], [])).toEqual([
      '.git',
      'node_modules'
    ])
  })

  it('扩展名清单额外去前导点', () => {
    expect(normalizeExtList([' .MD ', 'md', 'TXT', ''], [])).toEqual(['md', 'txt'])
  })

  it('未传或全为无效项时回落 fallback', () => {
    expect(normalizeNameList(undefined, DEFAULT_ASSET_EXTS)).toEqual(DEFAULT_ASSET_EXTS)
    expect(normalizeNameList([], DEFAULT_ASSET_EXTS)).toEqual(DEFAULT_ASSET_EXTS)
    expect(normalizeNameList(['', ' ', '.', '..'], DEFAULT_ASSET_EXTS)).toEqual(DEFAULT_ASSET_EXTS)
    // 返回的是副本，调用方改动不会污染默认常量
    const out = normalizeNameList(undefined, DEFAULT_ASSET_EXTS)
    out.push('zzz')
    expect(DEFAULT_ASSET_EXTS).not.toContain('zzz')
  })
})

describe('resolveAssetConfig', () => {
  it('未配置时展开成默认清单 + filter=all', () => {
    expect(resolveAssetConfig(undefined)).toEqual({
      includeExts: DEFAULT_ASSET_EXTS,
      ignoreDirs: DEFAULT_ASSET_IGNORE_DIRS,
      filter: 'all'
    })
    expect(resolveAssetConfig(null).filter).toBe('all')
  })

  it('脏 filter 值回落 all，不能让资产页开关进入未知态', () => {
    expect(resolveAssetConfig({ filter: 'bogus' as never }).filter).toBe('all')
    expect(resolveAssetConfig({ filter: 'other' }).filter).toBe('other')
  })
})

describe('matchesAssetFile', () => {
  const cfg = resolveAssetConfig(undefined)

  it('按扩展名命中，大小写与多点取最后一段', () => {
    expect(matchesAssetFile('notes.md', cfg)).toBe(true)
    expect(matchesAssetFile('docs/报告.MARKDOWN', cfg)).toBe(true)
    expect(matchesAssetFile('a/b/data.csv', cfg)).toBe(true)
    expect(matchesAssetFile('src/main/ipc.ts', cfg)).toBe(false)
  })

  it('无扩展名与点开头文件不算命中（LICENSE、.npmrc）', () => {
    expect(matchesAssetFile('LICENSE', cfg)).toBe(false)
    expect(matchesAssetFile('.npmrc', cfg)).toBe(false)
    expect(extOf('Makefile')).toBe('')
    expect(extOf('x.tar.gz')).toBe('gz')
  })

  it('忽略目录在任意层级命中即整条排除，且大小写不敏感', () => {
    expect(matchesAssetFile('node_modules/pkg/readme.md', cfg)).toBe(false)
    expect(matchesAssetFile('app/node_modules/pkg/readme.md', cfg)).toBe(false)
    expect(matchesAssetFile('App/Node_Modules/pkg/readme.md', cfg)).toBe(false)
    // 只是名字里含关键字的目录不该被误杀
    expect(matchesAssetFile('docs/node_modules_notes.md', cfg)).toBe(true)
  })

  it('空路径段与根路径不命中', () => {
    expect(matchesAssetFile('', cfg)).toBe(false)
    expect(matchesAssetFile('///', cfg)).toBe(false)
  })

  it('用户覆盖的忽略目录同样生效', () => {
    const custom = resolveAssetConfig({ ignoreDirs: ['草稿'] })
    expect(custom.includeExts).toEqual(DEFAULT_ASSET_EXTS) // 未覆盖的字段仍走默认
    expect(matchesAssetFile('草稿/a.md', custom)).toBe(false)
    expect(matchesAssetFile('docs/a.md', custom)).toBe(true)
  })
})

describe('normalizeAssetKey', () => {
  it('Windows 路径分隔符与大小写归一到同一个 key', () => {
    expect(normalizeAssetKey('D:\\Repo\\Docs\\A.MD')).toBe(normalizeAssetKey('d:/repo/docs/a.md'))
    expect(normalizeAssetKey('d:/repo/docs/a.md/')).toBe(normalizeAssetKey('d:/repo/docs/a.md'))
  })

  it('POSIX 路径大小写敏感，不能把两个不同文件并成一个', () => {
    expect(normalizeAssetKey('/repo/A.md')).not.toBe(normalizeAssetKey('/repo/a.md'))
  })
})

describe('parseNameList（配置输入框解析）', () => {
  it('逗号/中文逗号/分号/空白/换行都是分隔符', () => {
    expect(parseNameList(' md ,txt；\n yaml,  .csv ')).toEqual(['md', 'txt', 'yaml', '.csv'])
    expect(parseNameList('')).toEqual([])
  })

  it('切分结果交给 normalizeExtList 后才是生效清单', () => {
    expect(normalizeExtList(parseNameList(' md ,txt；\n yaml,  .csv '), [])).toEqual([
      'md',
      'txt',
      'yaml',
      'csv'
    ])
  })
})

describe('sanitizeAssetConfig（读库时的防御）', () => {
  it('非对象/数组/未知类型一律当没配过', () => {
    expect(sanitizeAssetConfig(null)).toBeUndefined()
    expect(sanitizeAssetConfig('md')).toBeUndefined()
    expect(sanitizeAssetConfig(['md'])).toBeUndefined()
    expect(sanitizeAssetConfig(42)).toBeUndefined()
  })

  it('只保留认识的字段，且逐项剔除非法元素', () => {
    const out = sanitizeAssetConfig({
      includeExts: [' .MD ', 1 as never, 'ts'],
      ignoreDirs: 'node_modules',
      filter: 'other',
      bogus: 1
    })
    expect(out).toEqual({ includeExts: ['md', 'ts'], filter: 'other' })
  })
})

describe('mergeAssetConfig（patch 的字段级合并）', () => {
  it('patch 里没传的字段保持原值，只传 filter 不会顶掉已存的扩展名清单', () => {
    expect(
      mergeAssetConfig({ includeExts: ['md', 'pdf'], ignoreDirs: ['草稿'] }, { filter: 'other' })
    ).toEqual({ includeExts: ['md', 'pdf'], ignoreDirs: ['草稿'], filter: 'other' })
  })

  it('显式空数组是「清掉这个字段的覆盖」，不是「保持原值」', () => {
    // 「资产识别」里的恢复默认就靠这条语义
    expect(
      mergeAssetConfig(
        { includeExts: ['pdf'], ignoreDirs: ['草稿'], filter: 'other' },
        { includeExts: [], ignoreDirs: [] }
      )
    ).toEqual({ filter: 'other' })
    expect(mergeAssetConfig({ includeExts: ['pdf'] }, { includeExts: [] })).toEqual({})
  })

  it('patch 为 null 整体清空；为 undefined 不动', () => {
    expect(mergeAssetConfig({ includeExts: ['pdf'], filter: 'task' }, null)).toBeUndefined()
    expect(mergeAssetConfig({ includeExts: ['pdf'] }, undefined)).toEqual({ includeExts: ['pdf'] })
  })

  it('非法值逐项丢掉：非数组的字段视同没传，filter 不认识就回落到未设置', () => {
    expect(mergeAssetConfig({ includeExts: ['pdf'] }, { includeExts: 'md' as never })).toEqual({
      includeExts: ['pdf']
    })
    expect(
      mergeAssetConfig({ includeExts: ['pdf'], filter: 'task' }, { filter: 'bogus' as never })
    ).toEqual({ includeExts: ['pdf'] })
  })
})

describe('formatNameList（配置输入框回显）', () => {
  it('未配置时回空串，让 placeholder 去讲默认清单', () => {
    expect(formatNameList(undefined)).toBe('')
    expect(formatNameList([])).toBe('')
    expect(formatNameList(['md', 'pdf'])).toBe('md, pdf')
  })
})

describe('planAssetConfigWrite（这块到底要不要写库）', () => {
  it('清掉一个已存在的覆盖不能被判成伪改动（返回的是原始 patch，不是合并结果）', () => {
    // 回归：写库路径上合并两次会把空数组信号在第一次合掉，第二次当成没传，清空永远写不进去
    const patch = { includeExts: [] }
    expect(planAssetConfigWrite({ includeExts: ['ts', 'md'], filter: 'other' }, patch)).toEqual(
      patch
    )
  })

  it('把默认清单抄一遍这种伪改动直接丢弃，不占一次写入', () => {
    expect(
      planAssetConfigWrite(undefined, { includeExts: [...DEFAULT_ASSET_EXTS] })
    ).toBeUndefined()
    expect(planAssetConfigWrite(undefined, { filter: 'all' })).toBeUndefined()
    expect(planAssetConfigWrite(undefined, null)).toBeUndefined()
  })

  it('已有覆盖时传 null 就是真的清空整个配置', () => {
    expect(planAssetConfigWrite({ includeExts: ['pdf'] }, null)).toBeNull()
  })

  it('真正收窄默认清单是要写的', () => {
    const patch = { ignoreDirs: ['草稿'] }
    expect(planAssetConfigWrite({ includeExts: ['pdf'] }, patch)).toEqual(patch)
  })
})

describe('compactAssetConfig（写库前瘦身）', () => {
  it('空配置与"把默认清单原样抄一遍"都不落库', () => {
    expect(compactAssetConfig(null)).toBeNull()
    expect(compactAssetConfig({})).toBeNull()
    expect(compactAssetConfig({ includeExts: [], ignoreDirs: [] })).toBeNull()
    expect(
      compactAssetConfig({
        includeExts: [...DEFAULT_ASSET_EXTS].reverse(),
        ignoreDirs: DEFAULT_ASSET_IGNORE_DIRS,
        filter: 'all'
      })
    ).toBeNull()
  })

  it('只落与默认不同的部分；真的收窄了默认清单是要保留的', () => {
    expect(compactAssetConfig({ includeExts: ['md', 'pdf'], filter: 'task' })).toEqual({
      includeExts: ['md', 'pdf'],
      filter: 'task'
    })
    expect(compactAssetConfig({ includeExts: ['MD', '.md'] })).toEqual({ includeExts: ['md'] })
  })
})
