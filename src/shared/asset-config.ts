import type { AssetFilter, ProjectAssetConfig } from './types'

/**
 * 空间「资产识别」配置：默认值与纯函数，主进程与渲染层共用一份。
 *
 * 产物分两类——任务生成的（artifacts 表登记）与其他途径产生的（手工放进工作目录、外部拷来的）。
 * 后者不入库，每次按这里的配置实时扫盘得出，所以默认清单必须两侧同源，
 * 否则配置框的 placeholder 与真实生效值会说的不是一回事。
 */

/**
 * 默认识别的扩展名：只收文档/数据类文本。
 * 刻意不含 ts/js/py/go 等源码——在自己代码仓库里建空间会把整个 src 扫成"产物"，
 * 真正的产出被淹没；需要收源码的用户在配置框里自己加。
 * 也不含 env/pem/key 一类——它们会被列进资产表并注入提示词。
 */
export const DEFAULT_ASSET_EXTS = [
  'md',
  'markdown',
  'txt',
  'rst',
  'adoc',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'ini',
  'properties',
  'csv',
  'tsv',
  'log',
  'xml',
  'svg'
]

/** 默认忽略目录：构建产物、依赖、缓存与本地数据目录 */
export const DEFAULT_ASSET_IGNORE_DIRS = [
  'node_modules',
  'out',
  'dist',
  'build',
  'release',
  'coverage',
  'cache',
  'logs',
  'tmp',
  'temp',
  '.git',
  '.kb',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__'
]

/** 扫描递归深度上限（防超深目录树） */
export const ASSET_SCAN_MAX_DEPTH = 8
/** 单次扫描最多收多少个文件（防大目录把资产页与提示词撑爆） */
export const ASSET_SCAN_MAX_FILES = 500

export const ASSET_FILTERS: AssetFilter[] = ['all', 'task', 'other']

/** 展开后的生效配置：字段一定非空，调用方不再处理"未设置" */
export interface ResolvedAssetConfig {
  includeExts: string[]
  ignoreDirs: string[]
  filter: AssetFilter
}

/** trim + 小写；剔掉空串与纯点（'.'、'..' 永远不是真要忽略的目录名） */
function toName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  if (!s || /^\.+$/.test(s)) return ''
  return s
}

/** 扩展名再去前导点：用户会写 `.md` */
function toExt(raw: unknown): string {
  return toName(raw).replace(/^\.+/, '')
}

function dedupe(items: string[], fallback: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out.length ? out : [...fallback]
}

/** 目录名清单：未传/全无效回落 fallback（留空 = 用默认） */
export function normalizeNameList(raw: unknown[] | undefined | null, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  return dedupe(raw.map(toName), fallback)
}

/** 扩展名清单：同上，另去前导点 */
export function normalizeExtList(raw: unknown[] | undefined | null, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  return dedupe(raw.map(toExt), fallback)
}

/** 配置输入框的原文解析：逗号/中文逗号/分号/空白/换行都算分隔符 */
export function parseNameList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function toFilter(raw: unknown): AssetFilter | undefined {
  return ASSET_FILTERS.includes(raw as AssetFilter) ? (raw as AssetFilter) : undefined
}

/** 库里/IPC 入参的数组字段只保证“要么是数组要么什么都不是” */
function asArray(raw: unknown): unknown[] | undefined {
  return Array.isArray(raw) ? raw : undefined
}

/** 读库/收 IPC 入参时的防御：只认识三个字段，元素类型逐一过筛 */
export function sanitizeAssetConfig(raw: unknown): ProjectAssetConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  const out: ProjectAssetConfig = {}
  const exts = normalizeExtList(asArray(v.includeExts), [])
  if (exts.length) out.includeExts = exts
  const dirs = normalizeNameList(asArray(v.ignoreDirs), [])
  if (dirs.length) out.ignoreDirs = dirs
  const filter = toFilter(v.filter)
  if (filter) out.filter = filter
  return Object.keys(out).length ? out : undefined
}

/** 把（可能只填了一部分的）配置展开成生效值 */
export function resolveAssetConfig(stored?: ProjectAssetConfig | null): ResolvedAssetConfig {
  return {
    includeExts: normalizeExtList(stored?.includeExts, DEFAULT_ASSET_EXTS),
    ignoreDirs: normalizeNameList(stored?.ignoreDirs, DEFAULT_ASSET_IGNORE_DIRS),
    filter: toFilter(stored?.filter) ?? 'all'
  }
}

/** 文件扩展名（不含点，小写）；无扩展名与点开头文件返回空串 */
export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  if (i <= 0) return ''
  return fileName.slice(i + 1).toLowerCase()
}

/**
 * 这个相对路径（正斜杠、相对浏览根）算不算"其他途径产物"。
 * 忽略目录按任意层级路径段命中即整棵排除；末段按扩展名白名单命中。
 */
export function matchesAssetFile(relPathPosix: string, cfg: ResolvedAssetConfig): boolean {
  const segments = relPathPosix.split('/').filter(Boolean)
  if (segments.length < 1) return false
  const fileName = segments[segments.length - 1]
  const ignore = new Set(cfg.ignoreDirs)
  if (segments.slice(0, -1).some((seg) => ignore.has(seg.toLowerCase()))) return false
  const ext = extOf(fileName)
  return !!ext && cfg.includeExts.includes(ext)
}

/**
 * 绝对路径归一，供"任务产物与扫描结果指向同一文件"去重。
 * 只有盘符开头的 Windows 路径大小写不敏感；POSIX 下 /A.md 与 /a.md 是两个文件。
 */
export function normalizeAssetKey(absPath: string): string {
  const unified = String(absPath ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((x) => set.has(x))
}

/**
 * 写库前瘦身：与默认一致的、空的、无效的一律不落，全空返回 null（列存 NULL）。
 * 这样"用户只是把默认清单抄了一遍"不会把空间钉死在旧默认上——日后默认清单扩充仍能受益。
 */
export function compactAssetConfig(cfg?: ProjectAssetConfig | null): ProjectAssetConfig | null {
  const clean = sanitizeAssetConfig(cfg ?? null)
  if (!clean) return null
  const out: ProjectAssetConfig = {}
  if (clean.includeExts && !sameList(clean.includeExts, DEFAULT_ASSET_EXTS)) {
    out.includeExts = clean.includeExts
  }
  if (clean.ignoreDirs && !sameList(clean.ignoreDirs, DEFAULT_ASSET_IGNORE_DIRS)) {
    out.ignoreDirs = clean.ignoreDirs
  }
  if (clean.filter && clean.filter !== 'all') out.filter = clean.filter
  return Object.keys(out).length ? out : null
}

/**
 * 库内配置与 patch 的字段级合并：patch 里未传的字段保持原值，传 null 表示整体清空。
 * 传了空数组表示「清掉这个字段的覆盖、回落默认」（配置框被清空 / 恢复默认按钮就发这个），
 * 与「未传」必须区分开，否则恢复默认会变成一个什么也没改的伪 patch。
 * 元素级脏值在这里就地归一；类型整个不对（传成字符串）就当没传，不顺手清用户的配置。
 */
export function mergeAssetConfig(
  existing: ProjectAssetConfig | undefined,
  patch: ProjectAssetConfig | null | undefined
): ProjectAssetConfig | undefined {
  if (patch === null) return undefined
  if (!patch) return existing
  const out: ProjectAssetConfig = { ...(existing ?? {}) }
  if (Array.isArray(patch.includeExts)) {
    const v = normalizeExtList(patch.includeExts, [])
    if (v.length) out.includeExts = v
    else delete out.includeExts
  }
  if (Array.isArray(patch.ignoreDirs)) {
    const v = normalizeNameList(patch.ignoreDirs, [])
    if (v.length) out.ignoreDirs = v
    else delete out.ignoreDirs
  }
  if (patch.filter !== undefined) {
    const f = toFilter(patch.filter)
    if (f) out.filter = f
    else delete out.filter
  }
  return out
}

/** 两份配置归一到库里是不是同一个值 */
function sameStoredConfig(
  a: ProjectAssetConfig | undefined,
  b: ProjectAssetConfig | undefined
): boolean {
  return JSON.stringify(compactAssetConfig(a)) === JSON.stringify(compactAssetConfig(b))
}

/**
 * 决定 assetConfig 这块要不要写库：返回 undefined 表示与库里等价（伪改动，丢弃），
 * 否则返回要交给 DB 层的**原始 patch**。
 *
 * 不能返回合并结果：写库路径上 store 层自己还会合一次，两侧各合就把
 * 「空数组 = 清掉该字段覆盖」这个信号在第一次合掉了，第二次看成未传，清空永远写不进去。
 */
export function planAssetConfigWrite(
  existing: ProjectAssetConfig | undefined,
  patch: ProjectAssetConfig | null
): ProjectAssetConfig | null | undefined {
  const merged = mergeAssetConfig(existing, patch)
  if (sameStoredConfig(merged, existing)) return undefined
  return patch
}

/** 配置对象转输入框文本 */
export function formatNameList(list?: string[] | null): string {
  return (list ?? []).join(', ')
}
