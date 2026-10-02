import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsStore, maskApiKey, type Crypto } from './settings'

/** 测试用假加密：简单做一层可逆变换，验证"存的是密文、取回是明文"这个行为契约，不验证真加密强度 */
const fakeCrypto: Crypto = {
  available: true,
  encrypt: (s) => Buffer.from(`enc::${s}`, 'utf8').toString('base64'),
  decrypt: (b) =>
    Buffer.from(b, 'base64')
      .toString('utf8')
      .replace(/^enc::/, '')
}

const unavailableCrypto: Crypto = {
  available: false,
  encrypt: () => {
    throw new Error('should not be called')
  },
  decrypt: () => {
    throw new Error('should not be called')
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bluebuddy-settings-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('maskApiKey', () => {
  it('长度足够时只保留末 4 位', () => {
    expect(maskApiKey('sk-abcdefg1234')).toBe('••••1234')
  })
  it('空串返回空串（表示未设置）', () => {
    expect(maskApiKey('')).toBe('')
  })
  it('过短的 Key 也不暴露原文', () => {
    expect(maskApiKey('ab')).toBe('••••')
  })
})

describe('SettingsStore', () => {
  it('保存后再读取，能拿到解密后的明文 Key（内存态）', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'secret',
      streaming: true
    })
    const raw = store.getRaw('a')
    expect(raw?.apiKey).toBe('secret')
  })

  it('磁盘文件内容不包含明文 Key', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'super-secret-token',
      streaming: true
    })
    const fileContent = readFileSync(join(dir, 'providers.json'), 'utf8')
    expect(fileContent).not.toContain('super-secret-token')
  })

  it('重启（重新 new 一个实例读同一文件）后数据仍在', () => {
    const store1 = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store1.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'abcd1234',
      streaming: false
    })

    const store2 = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    const list = store2.listMasked()
    expect(list).toHaveLength(1)
    expect(list[0].apiKey).toBe('••••1234')
    expect(list[0].name).toBe('P1')
    expect(store2.getRaw('a')?.apiKey).toBe('abcd1234')
  })

  it('listMasked 永不返回明文 Key', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'very-secret',
      streaming: true
    })
    expect(store.listMasked()[0].apiKey).toBe('••••cret')
  })

  it('getRaw 不存在的 id 返回 undefined', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    expect(store.getRaw('nope')).toBeUndefined()
  })

  it('remove 后再读取不再存在', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'k',
      streaming: true
    })
    store.remove('a')
    expect(store.getRaw('a')).toBeUndefined()
  })

  it('加密不可用时降级为明文存储，但依然能用、依然不通过 listMasked 泄露', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), unavailableCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'plain-key',
      streaming: true
    })
    expect(store.getRaw('a')?.apiKey).toBe('plain-key')
    expect(store.listMasked()[0].apiKey).toBe('••••-key')
  })

  it('新建时没给 id 会自动生成一个', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'k',
      streaming: true
    } as never)
    expect(store.listMasked()[0].id).toBeTruthy()
  })

  it('clear 后列表为空且落盘（重启后仍为空）', () => {
    const store = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    store.upsert({
      id: 'a',
      name: 'P1',
      baseUrl: 'https://x.test/v1',
      model: 'm',
      apiKey: 'k',
      streaming: true
    })
    store.clear()
    expect(store.listMasked()).toEqual([])
    expect(store.getRaw('a')).toBeUndefined()
    const reopened = new SettingsStore(join(dir, 'providers.json'), fakeCrypto)
    expect(reopened.listMasked()).toEqual([])
  })
})
