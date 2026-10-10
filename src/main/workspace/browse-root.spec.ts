import { describe, it, expect } from 'vitest'
import { resolveBrowseRoot, type BrowseRootTarget } from './browse-root'

/** 只用到 getSession / getProject 两个方法，用结构化替身即可，无需真库 */
const db = {
  getSession: (id: string) => (id === 's1' ? { id, workDir: 'D:/tasks/one' } : undefined),
  getProject: (id: string) =>
    id === 'p1'
      ? { id, workDir: 'D:/spaces/blue' }
      : id === 'p-empty'
        ? { id, workDir: '' }
        : undefined
}

describe('resolveBrowseRoot（浏览沙箱根解析：会话或项目空间）', () => {
  it('按 sessionId 解析出会话工作目录', () => {
    expect(resolveBrowseRoot(db, { sessionId: 's1' })).toEqual({ ok: true, root: 'D:/tasks/one' })
  })

  it('按 projectId 解析出空间工作目录（空间资产 Tab 用）', () => {
    expect(resolveBrowseRoot(db, { projectId: 'p1' })).toEqual({
      ok: true,
      root: 'D:/spaces/blue'
    })
  })

  it('两者都给时以 sessionId 优先（对话页结果区语义不变）', () => {
    expect(resolveBrowseRoot(db, { sessionId: 's1', projectId: 'p1' })).toEqual({
      ok: true,
      root: 'D:/tasks/one'
    })
  })

  it('空选择器返回错误，不去猜根目录', () => {
    const r = resolveBrowseRoot(db, {})
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBeTruthy()
  })

  it('会话不存在时报错并说明是会话', () => {
    const r = resolveBrowseRoot(db, { sessionId: 'ghost' })
    expect(r.ok === false && r.error).toContain('会话')
  })

  it('空间不存在时报错并说明是项目空间', () => {
    const r = resolveBrowseRoot(db, { projectId: 'ghost' })
    expect(r.ok === false && r.error).toContain('项目空间')
  })

  it('空间工作目录为空串视为未设置，拒绝浏览', () => {
    const r = resolveBrowseRoot(db, { projectId: 'p-empty' })
    expect(r.ok === false && r.error).toContain('工作目录')
  })

  it('返回类型可被调用方收窄（ok/error 与 ok/root 互斥）', () => {
    const ok = resolveBrowseRoot(db, { sessionId: 's1' })
    const bad = resolveBrowseRoot(db, { sessionId: 'ghost' })
    expect(ok.ok === true && 'root' in ok).toBe(true)
    expect(bad.ok === false && 'error' in bad).toBe(true)
    // 编译期约束：联合类型可判别
    const t: BrowseRootTarget = { projectId: 'p1' }
    expect(t).toBeTruthy()
  })
})
