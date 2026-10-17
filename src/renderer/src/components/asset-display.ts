import type { AssetFilter, ProjectAssetEntry } from '@shared/types'

/**
 * 资产列表的展示层纯逻辑：类型归类、列宽、时间与体积格式化、行可见性判定。
 * 与页面拆开是为了能脱开 DOM 直接测（与 tool-display / mcp-detail 同一套路）。
 */

/** 按扩展名归到少数几类：类型徽标的形状配色与「类型筛选」胶囊共用这一份口径 */
export type AssetKind = 'doc' | 'sheet' | 'slide' | 'web' | 'data' | 'code' | 'other'

/** 胶囊的固定出现顺序，不按数量排，免得每次扫完顺序都在跳 */
export const KIND_ORDER: AssetKind[] = ['doc', 'sheet', 'slide', 'web', 'data', 'code', 'other']

export const KIND_META: Record<AssetKind, { label: string; badge: string }> = {
  doc: { label: '文档', badge: 'bg-sky-50 text-sky-700' },
  sheet: { label: '表格', badge: 'bg-emerald-50 text-emerald-700' },
  slide: { label: '幻灯片', badge: 'bg-amber-50 text-amber-700' },
  web: { label: '网页', badge: 'bg-orange-50 text-orange-700' },
  data: { label: '数据', badge: 'bg-violet-50 text-violet-700' },
  code: { label: '代码', badge: 'bg-slate-100 text-slate-700' },
  other: { label: '其他', badge: 'bg-black/5 text-ink-3' }
}

const EXT_KIND: Record<string, AssetKind> = {
  md: 'doc',
  markdown: 'doc',
  txt: 'doc',
  rst: 'doc',
  adoc: 'doc',
  doc: 'doc',
  docx: 'doc',
  pdf: 'doc',
  csv: 'sheet',
  xls: 'sheet',
  xlsx: 'sheet',
  ppt: 'slide',
  pptx: 'slide',
  html: 'web',
  htm: 'web',
  css: 'web',
  json: 'data',
  jsonl: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  ini: 'data',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  py: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  sh: 'code'
}

/** 只认结尾那一段扩展名；LICENSE 这类无后缀文件归「其他」 */
export function extOf(name: string): string {
  return name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? ''
}

export function assetKindOf(name: string): AssetKind {
  return EXT_KIND[extOf(name)] ?? 'other'
}

/** 列头与行共用同一份列宽，两侧才可能对得齐；来源列常驻，所以只有一份 */
export const ASSET_GRID_COLS =
  'minmax(0,2.2fr) minmax(0,1.15fr) minmax(0,1.15fr) 76px minmax(0,1fr) 44px'

/** 「上次更新」：同年写到分，跨年只到日，不让一列里挤满同一种长度 */
export function fmtAssetTime(ts: number, now: Date = new Date()): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const md = `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
  return d.getFullYear() === now.getFullYear()
    ? `${md} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}年${md}`
}

/** 只有扫描到的文件有大小，任务产物取登记时的元信息可能缺失 */
export function fmtSize(bytes?: number): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 位置列只到目录：文件名已经在第一列，重复一遍是噪声 */
export function dirLabel(relPath?: string): string {
  if (!relPath) return '—'
  const i = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'))
  return i <= 0 ? '工作目录根' : relPath.slice(0, i)
}

/** 一行的可见性：来源档、类型档、关键词三者相与；关键词同时命文件名与相对路径 */
export function matchAsset(
  a: ProjectAssetEntry,
  f: { source: AssetFilter; kind: AssetKind | 'all'; query: string }
): boolean {
  if (f.source !== 'all' && a.source !== f.source) return false
  if (f.kind !== 'all' && assetKindOf(a.name) !== f.kind) return false
  const q = f.query.trim().toLowerCase()
  if (!q) return true
  return `${a.name} ${a.relPath ?? ''}`.toLowerCase().includes(q)
}

/** 当前来源档下真实存在的类型：没有文件的类型不配占一个胶囊 */
export function kindsPresent(assets: ProjectAssetEntry[], source: AssetFilter): AssetKind[] {
  const hit = new Set<AssetKind>()
  assets.forEach((a) => {
    if (source === 'all' || a.source === source) hit.add(assetKindOf(a.name))
  })
  return KIND_ORDER.filter((k) => hit.has(k))
}
