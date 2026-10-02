import { promises as fs } from 'node:fs'
import type { HubSearchResult, HubSkill } from '@shared/types'
import { MAX_ZIP_BYTES } from './zip'

/**
 * SkillHub 市场客户端（skillhub.cn 公开接口，免鉴权）。
 *
 * 接口契约（2026-09 实测）：
 * - 搜索：GET /api/skills?keyword=&category=&page= → { code, data: { skills, total } }
 *   （搜索参数名是 keyword 不是 q；category 取 office-efficiency 等枚举）
 * - 下载：GET /api/v1/download?slug=@handle/slug → zip 字节流
 *
 * 安全模型：市场包是第三方内容，下载后一律走 SkillManager.importFromZip
 * 的安装链（zip-slip 把关 + SKILL.md 校验），这里只额外把两道关：
 * 响应大小上限与 zip 魔数，避免把非 zip 垃圾写进临时目录。
 */

export const SKILLHUB_BASE_URL = 'https://api.skillhub.cn'

export interface HubClientOpts {
  baseUrl?: string
  /** 搜索超时，默认 15s */
  timeoutMs?: number
  /** 下载超时，默认 60s */
  downloadTimeoutMs?: number
  /** 下载包大小上限，默认与解压上限同档 50MB */
  maxZipBytes?: number
}

/** 接口原始条目 → 展示投影；字段缺失给安全默认值 */
function projectSkill(raw: Record<string, unknown>): HubSkill {
  const namespace = (raw.namespace ?? {}) as Record<string, unknown>
  const labels = (raw.labels ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    slug: str(raw.slug),
    canonicalName: str(namespace.canonicalName),
    name: str(raw.name) || str(raw.slug),
    description: str(raw.description),
    descriptionZh: str(raw.description_zh),
    downloads: num(raw.downloads),
    stars: num(raw.stars),
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    category: str(raw.category),
    version: str(raw.version),
    requiresApiKey: labels.requires_api_key === 'true'
  }
}

export class HubClient {
  constructor(private opts: HubClientOpts = {}) {}

  private get base(): string {
    return this.opts.baseUrl ?? SKILLHUB_BASE_URL
  }

  async search(params: {
    keyword?: string
    category?: string
    page?: number
  }): Promise<HubSearchResult> {
    const url = new URL('/api/skills', this.base)
    if (params.keyword) url.searchParams.set('keyword', params.keyword)
    if (params.category) url.searchParams.set('category', params.category)
    url.searchParams.set('page', String(params.page ?? 1))

    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000)
    })
    if (!res.ok) throw new Error(`SkillHub 请求失败（HTTP ${res.status}）`)
    const json = (await res.json()) as {
      code?: number
      data?: { skills?: unknown[]; total?: number }
    }
    if (json.code !== 0 || !Array.isArray(json.data?.skills)) {
      throw new Error('SkillHub 返回数据异常')
    }
    return {
      skills: (json.data?.skills ?? [])
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map(projectSkill),
      total: typeof json.data?.total === 'number' ? json.data.total : 0,
      page: params.page ?? 1
    }
  }

  /** 下载技能 zip 到 destFile；校验大小上限与 zip 魔数（PK\x03\x04） */
  async downloadZip(canonicalName: string, destFile: string): Promise<void> {
    const url = new URL('/api/v1/download', this.base)
    url.searchParams.set('slug', canonicalName)
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.opts.downloadTimeoutMs ?? 60_000)
    })
    if (!res.ok) throw new Error(`SkillHub 下载失败（HTTP ${res.status}）`)
    const buf = Buffer.from(await res.arrayBuffer())
    const cap = this.opts.maxZipBytes ?? MAX_ZIP_BYTES
    if (buf.length > cap) {
      throw new Error(`技能包超过大小上限（${Math.round(cap / 1024 / 1024)}MB）`)
    }
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('下载内容不是 zip 技能包')
    }
    await fs.writeFile(destFile, buf)
  }
}
