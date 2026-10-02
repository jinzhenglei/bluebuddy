import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { streamChat, testConnection } from './gateway'
import type { ChatMessage } from '@shared/types'

const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]

/** 构造一个 OpenAI 兼容流式响应的假 fetch，按给定文本分片依次吐出 */
function mockStreamFetch(sseChunks: string[], status = 200): typeof fetch {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of sseChunks) controller.enqueue(encoder.encode(c))
        controller.close()
      }
    })
    return new Response(stream, {
      status,
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }) as unknown as typeof fetch
}

function collectEvents<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = []
    for await (const e of gen) out.push(e)
    return out
  })()
}

describe('streamChat', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      mockStreamFetch([
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按顺序产出每个 delta 文本片段，最后产出 done', async () => {
    const events = await collectEvents(
      streamChat({ baseUrl: 'https://fake.test/v1', apiKey: 'k', model: 'm', messages })
    )
    expect(events).toEqual([
      { type: 'delta', text: '你好' },
      { type: 'delta', text: '，世界' },
      { type: 'done' }
    ])
  })

  it('请求体携带 stream: true 与 messages，Authorization 头带 Bearer Key', async () => {
    const spy = fetch as unknown as ReturnType<typeof vi.fn>
    await collectEvents(
      streamChat({ baseUrl: 'https://fake.test/v1', apiKey: 'secret-key', model: 'm', messages })
    )
    const [, init] = spy.mock.calls[0]
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-key')
    const body = JSON.parse(init!.body as string)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('m')
    expect(body.messages).toEqual(messages)
  })

  it('非 200 响应抛出带状态码与响应文本的错误', async () => {
    vi.stubGlobal('fetch', mockStreamFetch(['{"error":"invalid api key"}'], 401))
    await expect(
      collectEvents(
        streamChat({ baseUrl: 'https://fake.test/v1', apiKey: 'bad', model: 'm', messages })
      )
    ).rejects.toThrow(/401/)
  })

  it('signal 中止时提前结束生成器，不再产出后续事件', async () => {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })) as unknown as typeof fetch
    )

    const abortController = new AbortController()
    const gen = streamChat({
      baseUrl: 'https://fake.test/v1',
      apiKey: 'k',
      model: 'm',
      messages,
      signal: abortController.signal
    })

    // 先产出第一段，再中止
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'))
    const first = await gen.next()
    expect(first.value).toEqual({ type: 'delta', text: '第一段' })

    abortController.abort()
    controller.close()

    const rest = await collectEvents(gen)
    expect(rest).not.toContainEqual({ type: 'done' })
  })
})

describe('testConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 且有 choices 时返回 ok: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ choices: [{ message: { content: 'pong' } }] })
      ) as unknown as typeof fetch
    )
    const result = await testConnection({
      baseUrl: 'https://fake.test/v1',
      apiKey: 'k',
      model: 'm'
    })
    expect(result.ok).toBe(true)
  })

  it('网络异常时返回 ok: false 并带错误信息，不抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch
    )
    const result = await testConnection({
      baseUrl: 'https://fake.test/v1',
      apiKey: 'k',
      model: 'm'
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('ECONNREFUSED')
  })
})
