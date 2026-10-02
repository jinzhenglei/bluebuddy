import { describe, it, expect, vi } from 'vitest'
import { ToolCall } from '@shared/types'
import { PermissionGate } from './gate'

function call(name: string, id = 'c1'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } }
}

describe('PermissionGate.request / reply', () => {
  it('未命中 grants 时挂 Promise，reply(true) 后 resolve true', async () => {
    const g = new PermissionGate()
    const onRequest = vi.fn()
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest
    })
    expect(onRequest).toHaveBeenCalledTimes(1)
    const [requestId] = onRequest.mock.calls[0] as [string, ToolCall, string]
    expect(g.pendingCount()).toBe(1)
    g.reply(requestId, true)
    await expect(p).resolves.toBe(true)
    expect(g.pendingCount()).toBe(0)
  })

  it('reply(false) resolve false', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, false)
    await expect(p).resolves.toBe(false)
  })

  it('未知 requestId 的 reply 静默无副作用', () => {
    const g = new PermissionGate()
    expect(() => g.reply('unknown-id', true)).not.toThrow()
  })

  it('onRequest 参数携带 call/reason 供 UI 展示', async () => {
    const g = new PermissionGate()
    const spy = vi.fn()
    const c = call('danger', 'cc')
    const p = g.request({ sessionId: 's1', call: c, reason: 'why', onRequest: spy })
    expect(spy).toHaveBeenCalledWith(expect.any(String), c, 'why')
    // 释放 pending
    g.reply(spy.mock.calls[0][0] as string, true)
    await p
  })
})

describe('PermissionGate 始终允许', () => {
  it('reply(approved=true, alwaysAllow=true) 后，同 session 同 tool 下次 request 直接返回 true 且不再触发 onRequest', async () => {
    const g = new PermissionGate()
    let first = ''
    const p1 = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (first = id)
    })
    g.reply(first, true, true)
    await p1
    const onRequest2 = vi.fn()
    const second = await g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: onRequest2
    })
    expect(second).toBe(true)
    expect(onRequest2).not.toHaveBeenCalled()
  })

  it('同 session 其他 tool 仍需批准', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p1 = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, true, true)
    await p1
    const spy2 = vi.fn()
    const p2 = g.request({
      sessionId: 's1',
      call: call('other'),
      reason: 'r',
      onRequest: spy2
    })
    expect(spy2).toHaveBeenCalledTimes(1)
    g.reply(spy2.mock.calls[0][0] as string, false)
    await expect(p2).resolves.toBe(false)
  })

  it('不同 session 不共享 grants', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, true, true)
    await p
    const spy = vi.fn()
    const p2 = g.request({
      sessionId: 's2',
      call: call('danger'),
      reason: 'r',
      onRequest: spy
    })
    expect(spy).toHaveBeenCalledTimes(1)
    g.reply(spy.mock.calls[0][0] as string, true)
    await expect(p2).resolves.toBe(true)
  })

  it('reply(false, alwaysAllow=true) 不写入 grants（拒绝一次不代表永久拒绝）', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, false, true)
    await p
    const spy = vi.fn()
    const p2 = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: spy
    })
    expect(spy).toHaveBeenCalledTimes(1)
    g.reply(spy.mock.calls[0][0] as string, true)
    await expect(p2).resolves.toBe(true)
  })
})

describe('PermissionGate.rejectPendingForSession', () => {
  it('撤销 pending（视为拒绝）但保留 grants', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, true, true) // 写入 grants：s1 + danger 始终允许
    await p
    const p2 = g.request({
      sessionId: 's1',
      call: call('other'),
      reason: 'r',
      onRequest: () => {
        /* id unused */
      }
    })
    g.rejectPendingForSession('s1')
    await expect(p2).resolves.toBe(false)
    expect(g.pendingCount()).toBe(0)
    // grants 仍在：danger 直接放行且不再触发 onRequest
    const spy = vi.fn()
    await expect(
      g.request({ sessionId: 's1', call: call('danger'), reason: 'r', onRequest: spy })
    ).resolves.toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('不影响其他 session 的 pending', async () => {
    const g = new PermissionGate()
    let rid2 = ''
    const p1 = g.request({
      sessionId: 's1',
      call: call('a'),
      reason: '',
      onRequest: () => {
        /* id unused */
      }
    })
    const p2 = g.request({
      sessionId: 's2',
      call: call('b'),
      reason: '',
      onRequest: (id) => (rid2 = id)
    })
    g.rejectPendingForSession('s1')
    await expect(p1).resolves.toBe(false)
    g.reply(rid2, true)
    await expect(p2).resolves.toBe(true)
  })
})

describe('PermissionGate.clearSession', () => {
  it('清空 pending：所有等待中的 Promise 以 false settle', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    expect(rid).toBeTruthy()
    g.clearSession('s1')
    await expect(p).resolves.toBe(false)
    expect(g.pendingCount()).toBe(0)
  })

  it('清空 grants：之前"始终允许"的工具下次重新弹批准', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, true, true)
    await p
    g.clearSession('s1')
    const spy = vi.fn()
    const p2 = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: spy
    })
    expect(spy).toHaveBeenCalledTimes(1)
    g.reply(spy.mock.calls[0][0] as string, true)
    await p2
  })

  it('不影响其他 session 的 pending', async () => {
    const g = new PermissionGate()
    let rid2 = ''
    const p1 = g.request({
      sessionId: 's1',
      call: call('a'),
      reason: '',
      onRequest: () => {
        /* id unused */
      }
    })
    const p2 = g.request({
      sessionId: 's2',
      call: call('b'),
      reason: '',
      onRequest: (id) => (rid2 = id)
    })
    g.clearSession('s1')
    await expect(p1).resolves.toBe(false)
    g.reply(rid2, true)
    await expect(p2).resolves.toBe(true)
  })
})

describe('PermissionGate 全局自动允许（设置页「自动允许全部」）', () => {
  it('autoApprove 开启时直接放行且不推事件', async () => {
    const g = new PermissionGate()
    g.setAutoApprove(true)
    const spy = vi.fn()
    const p = g.request({ sessionId: 's1', call: call('danger'), reason: 'r', onRequest: spy })
    await expect(p).resolves.toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(g.pendingCount()).toBe(0)
  })

  it('关闭后恢复询问；开启前已挂起的询问仍可 reply', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.setAutoApprove(true)
    // 已挂起的由用户回应，不被自动放行默默吞掉
    g.reply(rid, false)
    await expect(p).resolves.toBe(false)
    // 新开启后直接放行
    await expect(
      g.request({
        sessionId: 's1',
        call: call('danger'),
        reason: 'r',
        onRequest: () => {
          /* 不应被调 */
        }
      })
    ).resolves.toBe(true)
    g.setAutoApprove(false)
    const spy = vi.fn()
    const p2 = g.request({ sessionId: 's1', call: call('x'), reason: 'r', onRequest: spy })
    expect(spy).toHaveBeenCalledTimes(1)
    g.reply(spy.mock.calls[0][0] as string, true)
    await expect(p2).resolves.toBe(true)
  })

  it('clearAll 撤销所有 pending 并清空全部 grants，但不重置 autoApprove', async () => {
    const g = new PermissionGate()
    let rid = ''
    const p = g.request({
      sessionId: 's1',
      call: call('danger'),
      reason: 'r',
      onRequest: (id) => (rid = id)
    })
    g.reply(rid, true, true) // 给 s1 记一条 always 授权
    await p
    expect(g.isAlwaysAllowed('s1', 'danger')).toBe(true)
    let asked2 = false
    const p2 = g.request({
      sessionId: 's2',
      call: call('other'),
      reason: 'r',
      onRequest: () => (asked2 = true)
    })
    expect(asked2).toBe(true)
    g.setAutoApprove(true)
    g.clearAll()
    await expect(p2).resolves.toBe(false)
    expect(g.isAlwaysAllowed('s1', 'danger')).toBe(false)
    expect(g.isAutoApprove()).toBe(true)
  })
})
