import { z } from 'zod'
import { Tool } from '../types'

/** 返回体最大字节数，超过截断，防止 OOM 与 prompt 爆炸 */
const MAX_BYTES = 100_000

/**
 * fetch_url：GET 一个 HTTP(S) URL，返回文本内容（截断到 MAX_BYTES）。
 * MVP 只对 http/https 白名单，拒绝 file:// 等协议。
 */
export const fetchUrlTool: Tool<{ url: string }> = {
  name: 'fetch_url',
  description:
    'Fetch a public web page or API by HTTP(S) GET and return its text body (truncated to 100 KB).',
  parameters: z.object({
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
        message: 'Only http(s) URLs are allowed'
      })
      .describe('Absolute URL starting with http:// or https://')
  }),
  requiresApproval: false,
  async execute(input, ctx) {
    const res = await ctx.fetch(input.url, { redirect: 'follow' })
    const text = await res.text()
    const truncated = text.length > MAX_BYTES
    const body = truncated ? text.slice(0, MAX_BYTES) + '\n...[truncated]' : text
    return {
      ok: res.ok,
      content: `status: ${res.status}\n\n${body}`,
      data: { status: res.status, length: text.length, truncated },
      artifact: { kind: 'link', name: input.url, url: input.url }
    }
  }
}
