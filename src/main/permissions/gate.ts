import { randomUUID } from 'node:crypto'
import { ToolCall } from '@shared/types'

/**
 * PermissionGate：把引擎里同步的"要不要批准这次工具调用"决策，
 * 桥接成一段可等待 UI 回应的异步流程，并支持"本会话内始终允许"记忆。
 *
 * 关键设计：
 * - requestApproval 返回 Promise<boolean>，Promise 只有在 reply()/rejectAllForSession() 后 settle
 * - 每次询问生成一个 requestId，UI 通过它把用户选择回传
 * - sessionGrants 是"某会话中已被用户勾选‘始终允许’"的工具名集合；
 *   命中时不再挂 Promise，直接返回 true 且不推送事件，避免"每次都弹框"的疲劳
 * - 会话结束或用户取消对话时应调用 clearSession，防止 pending Promise 永挂
 * - autoApprove 是全局「自动允许全部」开关（设置页写入，启动时从偏好加载）；
 *   开启时所有询问直接放行、不推事件——危险行为由用户在设置页显式确认
 */
export class PermissionGate {
  private pending = new Map<
    string,
    { sessionId: string; toolName: string; resolve: (v: boolean) => void }
  >()
  private sessionGrants = new Map<string, Set<string>>()
  private autoApprove = false

  setAutoApprove(v: boolean): void {
    this.autoApprove = v
  }

  isAutoApprove(): boolean {
    return this.autoApprove
  }

  isAlwaysAllowed(sessionId: string, toolName: string): boolean {
    return this.sessionGrants.get(sessionId)?.has(toolName) === true
  }

  /**
   * 询问用户。命中"始终允许"时直接返回 true，onRequest 不会被调用。
   * @param onRequest 把本次询问推送给 UI 的副作用（通常是 event.sender.send）
   */
  async request(opts: {
    sessionId: string
    call: ToolCall
    reason: string
    onRequest: (requestId: string, call: ToolCall, reason: string) => void
  }): Promise<boolean> {
    const { sessionId, call, reason, onRequest } = opts
    if (this.autoApprove) return true
    if (this.isAlwaysAllowed(sessionId, call.function.name)) return true

    const requestId = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pending.set(requestId, { sessionId, toolName: call.function.name, resolve })
      onRequest(requestId, call, reason)
    })
  }

  /**
   * UI 回应。alwaysAllow=true 且 approved=true 时才写入"始终允许"集合
   * （拒绝一次不代表永久拒绝，用户下次仍应看到批准框）。
   * 未知 requestId 静默忽略，避免因竞态导致崩溃。
   */
  reply(requestId: string, approved: boolean, alwaysAllow = false): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    if (approved && alwaysAllow) {
      let set = this.sessionGrants.get(p.sessionId)
      if (!set) {
        set = new Set()
        this.sessionGrants.set(p.sessionId, set)
      }
      set.add(p.toolName)
    }
    p.resolve(approved)
  }

  /**
   * 撤销某会话所有 pending（视为拒绝），但保留 grants。
   * 用于 turn 被取消 / 渲染进程已销毁：防止 Agent 循环永挂在批准 Promise 上。
   */
  rejectPendingForSession(sessionId: string): void {
    for (const [id, p] of this.pending) {
      if (p.sessionId === sessionId) {
        this.pending.delete(id)
        p.resolve(false)
      }
    }
  }

  /** 会话被销毁/重置：撤销所有 pending（视为拒绝），清空 grants */
  clearSession(sessionId: string): void {
    this.rejectPendingForSession(sessionId)
    this.sessionGrants.delete(sessionId)
  }

  /** 清空全部数据时用：撤销所有 pending（视为拒绝），清空所有 grants（不动 autoApprove） */
  clearAll(): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id)
      p.resolve(false)
    }
    this.sessionGrants.clear()
  }

  /** 当前 pending 数量（测试与观测用） */
  pendingCount(): number {
    return this.pending.size
  }
}
