import { describe, expect, it } from 'vitest'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DbStore } from '../db/store'
import type { Crypto } from '../settings'
import { HubTokenStore } from './token'

/** 可开关的假加密：仅验证「是否走加密路径 + 掩码」，不依赖真实 safeStorage */
function fakeCrypto(available: boolean): Crypto & { calls: number } {
  const c: Crypto & { calls: number } = {
    available,
    calls: 0,
    encrypt: (plain) => {
      c.calls++
      return Buffer.from('X' + plain).toString('base64')
    },
    decrypt: (cipher) => Buffer.from(cipher, 'base64').toString('utf8').slice(1)
  }
  return c
}

function makeDb(): DbStore {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-token-'))
  return new DbStore(path.join(base, 'db.sqlite'))
}

describe('HubTokenStore', () => {
  it('加密可用时落库为密文、get 还原明文、masked 只露末位', () => {
    const db = makeDb()
    const crypto = fakeCrypto(true)
    const t = new HubTokenStore(db, crypto)
    t.set('ms-secret-token-9876')
    expect(crypto.calls).toBe(1) // 确实走了 encrypt
    expect(db.getKv('modelscope_token')).not.toContain('ms-secret-token-9876')
    expect(t.get()).toBe('ms-secret-token-9876')
    expect(t.masked()).toBe('••••9876')
    db.close()
  })

  it('加密不可用时明文降级存，仍能读回', () => {
    const db = makeDb()
    const t = new HubTokenStore(db, fakeCrypto(false))
    t.set('ms-plain-1234')
    expect(db.getKv('modelscope_token')).toBe('ms-plain-1234')
    expect(t.get()).toBe('ms-plain-1234')
    db.close()
  })

  it('空串/纯空白即清除；重复 set 覆盖旧值', () => {
    const db = makeDb()
    const t = new HubTokenStore(db, fakeCrypto(false))
    t.set('ms-aaa-1111')
    t.set('   ')
    expect(t.get()).toBe('')
    expect(t.masked()).toBe('')
    t.set('ms-bbb-2222')
    expect(t.get()).toBe('ms-bbb-2222')
    db.close()
  })

  it('曾密文存储但当前无法解密时按未配置处理，不崩溃', () => {
    const db = makeDb()
    db.setKv('modelscope_token', 'enc:unreadable-cipher')
    const t = new HubTokenStore(db, fakeCrypto(false)) // available=false 解不开 enc: 前缀
    expect(t.get()).toBe('')
    db.close()
  })

  it('clear 删除记录', () => {
    const db = makeDb()
    const t = new HubTokenStore(db, fakeCrypto(false))
    t.set('ms-x-0000')
    t.clear()
    expect(db.getKv('modelscope_token')).toBeNull()
    db.close()
  })
})
