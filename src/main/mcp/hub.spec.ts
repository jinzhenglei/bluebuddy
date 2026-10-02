import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { MsHubClient } from './hub'

/**
 * 本地 mock 扮演魔搭接口，契约形状与 2026-09 实测抓包一致：
 * PUT /api/v1/dolphin/mcpServers + GET /api/v1/mcpServers/{path}/{name}
 */
let server: http.Server
let base: string

function json(res: http.ServerResponse, obj: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'PUT' && url.pathname === '/api/v1/dolphin/mcpServers') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const b = JSON.parse(body) as Record<string, unknown>
        const q = String(b.Query ?? '')
        if (q === 'slow') return setTimeout(() => json(res, { Code: 200, Data: {} }), 500)
        if (q === 'httperr') {
          res.writeHead(500)
          return res.end('boom')
        }
        if (q === 'bad') return json(res, { Code: 500, Message: 'inner error' })
        return json(res, {
          Code: 200,
          Success: true,
          Data: {
            McpServer: {
              TotalCount: 45,
              McpServers: [
                {
                  Name: 'fetch',
                  Path: '@modelcontextprotocol',
                  ChineseName: 'Fetch网页内容抓取',
                  AbstractCN: '让模型抓取并转换网页为 Markdown',
                  Abstract: 'en abstract',
                  Category: ['browser-automation'],
                  Hosted: true,
                  SupportedDeployTransportType: ['streamable_http', 'sse'],
                  CallVolume: 322769247,
                  Stars: 1064,
                  FromSiteUrl: 'https://github.com/x/fetch'
                },
                { Name: 'no-path-row' }, // 缺 Path 的脏行应被过滤
                null // 脏数据应被过滤
              ]
            }
          },
          _echo: { page: b.PageNumber, size: b.PageSize }
        })
      })
      return
    }
    const m = url.pathname.match(/^\/api\/v1\/mcpServers\/([^/]+)\/([^/]+)$/)
    if (req.method === 'GET' && m) {
      // 客户端对 path 做了 percent-encode（@ → %40），服务端视角应解码后比对
      const path = decodeURIComponent(m[1])
      const name = decodeURIComponent(m[2])
      const auth = req.headers.authorization
      if (path === '@modelcontextprotocol' && name === 'fetch') {
        return json(res, {
          Code: 200,
          Data: {
            McpServer: {
              Name: 'fetch',
              ChineseName: 'Fetch网页内容抓取',
              AbstractCN: '让模型抓取并转换网页为 Markdown',
              Category: ['browser-automation'],
              Stars: 1064,
              CallVolume: 322769247,
              FromSiteUrl: 'https://github.com/x/fetch',
              ReadmeCN: '# 获取 MCP 服务器\n\n抓取网页内容。',
              License: 'MIT License',
              Path: '@modelcontextprotocol',
              FromSiteIcon: 'https://img/icon.png',
              GmtUpdated: 1790730667,
              ViewCount: 619820,
              Tools: [
                {
                  name: 'fetch',
                  description: '抓取一个 URL 并以 markdown 返回',
                  inputSchema: {
                    type: 'object',
                    properties: { url: { type: 'string' } },
                    required: ['url']
                  }
                }
              ],
              DeployedUrl: '',
              ServerConfig: [
                { mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }
              ]
            }
          }
        })
      }
      if (path === 'hosted' && name === 'only') {
        // 带 Bearer 才发专属地址——复现魔搭登录态行为
        if (auth === 'Bearer ms-token-1234567890') {
          return json(res, {
            Code: 200,
            Data: {
              McpServer: {
                Name: 'only',
                ChineseName: '托管专属',
                DeployedUrl: 'https://mcp.example.com/only/sse',
                DeployedUrlTransportType: 'sse',
                ServerConfig: null
              }
            }
          })
        }
        return json(res, {
          Code: 200,
          Data: { McpServer: { Name: 'only', DeployedUrl: '', ServerConfig: null } }
        })
      }
      if (path === 'none' && name === 'atall') {
        return json(res, { Code: 200, Data: { McpServer: { Name: 'atall' } } })
      }
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
})

describe('MsHubClient.search', () => {
  it('PUT 传参正确，行投影干净且脏行被过滤', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    const r = await hub.search({ keyword: 'fetch', page: 2, pageSize: 10 })
    expect(r.total).toBe(45)
    expect(r.page).toBe(2)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toEqual({
      hubId: '@modelcontextprotocol/fetch',
      path: '@modelcontextprotocol',
      name: 'fetch',
      chineseName: 'Fetch网页内容抓取',
      description: '让模型抓取并转换网页为 Markdown',
      category: ['browser-automation'],
      hosted: true,
      transportTypes: ['streamable_http', 'sse'],
      callVolume: 322769247,
      stars: 1064,
      fromSiteUrl: 'https://github.com/x/fetch'
    })
  })

  it('缺省参数：空关键词第 1 页', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    const r = await hub.search({})
    expect(r.items[0]?.name).toBe('fetch')
  })

  it('业务码非 200 抛数据异常', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    await expect(hub.search({ keyword: 'bad' })).rejects.toThrow('魔搭返回数据异常')
  })

  it('HTTP 错误抛状态码', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    await expect(hub.search({ keyword: 'httperr' })).rejects.toThrow(/HTTP 500/)
  })

  it('超时中止', async () => {
    const hub = new MsHubClient({ baseUrl: base, timeoutMs: 100 })
    await expect(hub.search({ keyword: 'slow' })).rejects.toThrow()
  })
})

describe('MsHubClient.resolveInstall', () => {
  it('stdio 路线：解析 ServerConfig，名字取配置键、中文名进 displayName', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    const plan = await hub.resolveInstall('@modelcontextprotocol', 'fetch')
    expect(plan).toEqual({
      name: 'fetch',
      displayName: 'Fetch网页内容抓取',
      hubId: '@modelcontextprotocol/fetch',
      transport: 'stdio',
      config: { command: 'uvx', args: ['mcp-server-fetch'] },
      description: '让模型抓取并转换网页为 Markdown',
      category: ['browser-automation'],
      sourceUrl: 'https://github.com/x/fetch',
      stars: 1064,
      callVolume: 322769247,
      readme: '# 获取 MCP 服务器\n\n抓取网页内容。',
      toolsDoc: [
        {
          name: 'fetch',
          description: '抓取一个 URL 并以 markdown 返回',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url']
          }
        }
      ],
      license: 'MIT License',
      publisher: '@modelcontextprotocol',
      iconUrl: 'https://img/icon.png',
      updatedAt: 1790730667000,
      viewCount: 619820
    })
  })

  it('Hosted 路线：带 token 拿到专属 URL → http 配置并标 sse', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    const plan = await hub.resolveInstall('hosted', 'only', 'ms-token-1234567890')
    expect(plan.transport).toBe('http')
    expect(plan.config).toEqual({ url: 'https://mcp.example.com/only/sse', sse: true })
    expect(plan.displayName).toBe('托管专属')
  })

  it('无 token 且无 stdio 配置 → 给出导入指引错误', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    await expect(hub.resolveInstall('hosted', 'only')).rejects.toThrow('导入配置')
    await expect(hub.resolveInstall('none', 'atall')).rejects.toThrow('导入配置')
  })

  it('详情 404 抛 HTTP 错', async () => {
    const hub = new MsHubClient({ baseUrl: base })
    await expect(hub.resolveInstall('no', 'such')).rejects.toThrow(/HTTP 404/)
  })
})
