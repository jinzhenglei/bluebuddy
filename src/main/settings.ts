import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { ProviderConfig } from '@shared/types'

/**
 * 加密能力抽象出来成接口，而不是直接调用 electron.safeStorage：
 * 这是本项目反复使用的"依赖倒置"手法（和阶段 2 的 WorkspaceProvider 同一个思路）——
 * 业务逻辑（这里是怎么存/怎么掩码）不直接依赖具体平台 API，测试时才能塞进一个
 * 假实现来验证行为，而不用真的启动 Electron。
 */
export interface Crypto {
  available: boolean
  encrypt(plain: string): string
  decrypt(cipherBase64: string): string
}

export const electronCrypto: Crypto = {
  get available() {
    return safeStorage.isEncryptionAvailable()
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipherBase64) => safeStorage.decryptString(Buffer.from(cipherBase64, 'base64'))
}

/**
 * 掩码：只保留末 4 位，且总长不足 4 位时全掩（不能因为 Key 短就原样回传，
 * 那等于把最短、往往也最弱的 Key 完全暴露）。空串保持空串，语义是"未配置"。
 */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 4) return '••••'
  return `••••${key.slice(-4)}`
}

/** 落盘格式：apiKey 要么是密文（encrypted 为 true），要么是明文降级存储（encrypted 为 false） */
interface StoredProvider {
  id: string
  name: string
  baseUrl: string
  model: string
  encrypted: boolean
  apiKeyStored: string
  streaming: boolean
}

export class SettingsStore {
  private providers: StoredProvider[] = []

  constructor(
    private readonly filePath: string,
    private readonly crypto: Crypto
  ) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      this.providers = JSON.parse(raw)
    } catch {
      // 文件损坏时宁可当作"没有配置"，也不能让应用启动即崩溃——
      // 但这属于必须留痕的异常，静默吞掉是坏习惯，这里先记录到控制台。
      console.error('[settings] providers.json 解析失败，已按空配置启动')
      this.providers = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.providers, null, 2), 'utf8')
  }

  /** 给渲染进程用：永远只返回掩码后的 Key */
  listMasked(): ProviderConfig[] {
    return this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: maskApiKey(this.tryDecrypt(p)),
      streaming: p.streaming
    }))
  }

  /** 只在主进程内部使用（发起真实请求前取明文 Key），绝不经由 IPC 直接返回给渲染进程 */
  getRaw(id: string): ProviderConfig | undefined {
    const p = this.providers.find((x) => x.id === id)
    if (!p) return undefined
    return {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: this.tryDecrypt(p),
      streaming: p.streaming
    }
  }

  /**
   * 保存/更新一个 Provider。
   * 若传入的 apiKey 是掩码占位（说明用户没有改动 Key 输入框，UI 只是把掩码回填了），
   * 则保留数据库里原有的真实 Key，不能把 "••••abcd" 当成新 Key 存进去。
   */
  upsert(input: ProviderConfig): ProviderConfig {
    const existing = this.providers.find((x) => x.id === input.id)
    const realKey =
      input.apiKey.startsWith('••••') && existing ? this.tryDecrypt(existing) : input.apiKey

    const stored: StoredProvider = {
      id: input.id || randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      encrypted: this.crypto.available,
      apiKeyStored: this.crypto.available ? this.crypto.encrypt(realKey) : realKey,
      streaming: input.streaming
    }

    const index = this.providers.findIndex((x) => x.id === (input.id || stored.id))
    if (index === -1) this.providers.push(stored)
    else this.providers[index] = stored

    this.save()
    return { ...input, id: stored.id, apiKey: maskApiKey(realKey) }
  }

  remove(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id)
    this.save()
  }

  /** 清空全部数据（设置页危险操作）：删除所有 Provider 并落盘 */
  clear(): void {
    this.providers = []
    this.save()
  }

  private tryDecrypt(p: StoredProvider): string {
    if (!p.encrypted) return p.apiKeyStored
    if (!this.crypto.available) {
      // 之前加密过、当前环境解不开（例如换了机器/换了系统密钥环），不能假装没事。
      console.error(`[settings] provider ${p.id} 无法解密，请重新配置 API Key`)
      return ''
    }
    return this.crypto.decrypt(p.apiKeyStored)
  }
}

/** 默认存储路径：<userData>/providers.json */
export function defaultSettingsFilePath(): string {
  return join(app.getPath('userData'), 'providers.json')
}
