import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HubClient } from './hub'

/**
 * HubClient 测试：本地 http server 扮演 api.skillhub.cn，
 * 断言请求参数传递、字段投影、下载把关（魔数/大小）。
 */

const RAW_SKILL = {
  slug: 'excel-merge',
  namespace: { canonicalName: '@user_af28adda/excel-merge' },
  name: 'Excel数据合并',
  description: 'merge excel files',
  description_zh: 'Excel多文件智能合并',
  downloads: 5911,
  stars: 5,
  iconUrl: 'https://example.com/i.png',
  category: 'office-efficiency',
  version: '1.0.0',
  labels: { requires_api_key: 'true' }
}

describe('HubClient', () => {
  let server: http.Server
  let baseUrl: string
  let lastQuery: URLSearchParams

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      lastQuery = url.searchParams
      if (url.pathname === '/api/skills') {
        if (lastQuery.get('keyword') === 'slow') {
          setTimeout(() => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ code: 0, data: { skills: [], total: 0 } }))
          }, 500)
          return
        }
        if (lastQuery.get('keyword') === 'bad') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ code: 500, message: 'boom' }))
          return
        }
        if (lastQuery.get('keyword') === 'httperr') {
          res.statusCode = 500
          res.end('server on fire')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ code: 0, data: { skills: [RAW_SKILL], total: 42 } }))
        return
      }
      if (url.pathname === '/api/v1/download') {
        const slug = lastQuery.get('slug') ?? ''
        if (slug === '@x/not-zip') {
          res.end('this is plain text, not a zip')
          return
        }
        if (slug === '@x/huge') {
          res.end(Buffer.alloc(2048, 0x41))
          return
        }
        if (slug === '@x/missing') {
          res.statusCode = 404
          res.end('nope')
          return
        }
        const zip = new AdmZip()
        zip.addFile('demo/SKILL.md', Buffer.from('---\nname: demo\ndescription: d\n---\nbody'))
        res.end(zip.toBuffer())
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

  function tmpFile(name: string): string {
    return path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-hub-')), name)
  }

  it('search 传 keyword/category/page 并投影字段', async () => {
    const hub = new HubClient({ baseUrl })
    const res = await hub.search({ keyword: 'excel', category: 'office-efficiency', page: 2 })

    expect(lastQuery.get('keyword')).toBe('excel')
    expect(lastQuery.get('category')).toBe('office-efficiency')
    expect(lastQuery.get('page')).toBe('2')
    expect(res.total).toBe(42)
    expect(res.page).toBe(2)
    expect(res.skills[0]).toMatchObject({
      slug: 'excel-merge',
      canonicalName: '@user_af28adda/excel-merge',
      name: 'Excel数据合并',
      descriptionZh: 'Excel多文件智能合并',
      downloads: 5911,
      stars: 5,
      iconUrl: 'https://example.com/i.png',
      category: 'office-efficiency',
      version: '1.0.0',
      requiresApiKey: true
    })
  })

  it('search 缺省参数：page=1 且不带 keyword/category', async () => {
    const hub = new HubClient({ baseUrl })
    await hub.search({})
    expect(lastQuery.get('page')).toBe('1')
    expect(lastQuery.has('keyword')).toBe(false)
    expect(lastQuery.has('category')).toBe(false)
  })

  it('search 业务码非 0 抛错', async () => {
    const hub = new HubClient({ baseUrl })
    await expect(hub.search({ keyword: 'bad' })).rejects.toThrow(/返回数据异常/)
  })

  it('search HTTP 错误抛错', async () => {
    const hub = new HubClient({ baseUrl })
    await expect(hub.search({ keyword: 'httperr' })).rejects.toThrow(/HTTP 500/)
  })

  it('downloadZip 落盘合法 zip', async () => {
    const hub = new HubClient({ baseUrl })
    const dest = tmpFile('pkg.zip')
    await hub.downloadZip('@user_af28adda/excel-merge', dest)

    const zip = new AdmZip(dest)
    expect(zip.getEntries().map((e) => e.entryName)).toContain('demo/SKILL.md')
    await fs.rm(path.dirname(dest), { recursive: true, force: true })
  })

  it('downloadZip 拒绝非 zip 内容', async () => {
    const hub = new HubClient({ baseUrl })
    await expect(hub.downloadZip('@x/not-zip', tmpFile('a.zip'))).rejects.toThrow(/不是 zip/)
  })

  it('downloadZip 拒绝超大小上限的包', async () => {
    const hub = new HubClient({ baseUrl, maxZipBytes: 1024 })
    await expect(hub.downloadZip('@x/huge', tmpFile('b.zip'))).rejects.toThrow(/大小上限/)
  })

  it('downloadZip HTTP 404 抛错', async () => {
    const hub = new HubClient({ baseUrl })
    await expect(hub.downloadZip('@x/missing', tmpFile('c.zip'))).rejects.toThrow(/HTTP 404/)
  })

  it('search 超时中断', async () => {
    const hub = new HubClient({ baseUrl, timeoutMs: 100 })
    // 服务端挂 500ms 才回，客户端 100ms 就放弃
    await expect(hub.search({ keyword: 'slow' })).rejects.toThrow()
  })
})
