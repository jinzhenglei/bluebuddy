import type { Crypto } from '../settings'
import type { DbStore } from '../db/store'
import { maskApiKey } from '../settings'

const KV_KEY = 'modelscope_token'
/** 密文前缀：区分「加密存储」与「环境不支持加密时的明文降级」 */
const ENC_PREFIX = 'enc:'

/**
 * 魔搭访问令牌存储：值落 DB settings_kv，能加密就加密（safeStorage），
 * 明文只经 get() 留在主进程——绝不经 IPC 回传原文，UI 只给掩码。
 * 和 SettingsStore 存模型 API Key 是同一套安全模式。
 */
export class HubTokenStore {
  constructor(
    private readonly db: DbStore,
    private readonly crypto: Crypto
  ) {}

  set(token: string): void {
    const trimmed = token.trim()
    if (!trimmed) {
      this.db.deleteKv(KV_KEY)
      return
    }
    const stored = this.crypto.available ? ENC_PREFIX + this.crypto.encrypt(trimmed) : trimmed
    this.db.setKv(KV_KEY, stored)
  }

  /** 主进程内部取明文；解不开（换机器/密钥环丢失）按未配置处理 */
  get(): string {
    const raw = this.db.getKv(KV_KEY)
    if (!raw) return ''
    if (!raw.startsWith(ENC_PREFIX)) return raw
    if (!this.crypto.available) {
      console.error('[mcp] 魔搭 Token 无法解密，请重新配置')
      return ''
    }
    try {
      return this.crypto.decrypt(raw.slice(ENC_PREFIX.length))
    } catch {
      console.error('[mcp] 魔搭 Token 解密失败，请重新配置')
      return ''
    }
  }

  /** 给渲染进程展示：只有掩码；未配置为空串 */
  masked(): string {
    return maskApiKey(this.get())
  }

  clear(): void {
    this.db.deleteKv(KV_KEY)
  }
}
