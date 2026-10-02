import { create } from 'zustand'
import type { AgentStreamEvent, ArtifactInfo, ChatMessage, SessionInfo } from '@shared/types'
import { emptyTurn, reduceTurn, type TurnState } from './turn-reducer'

// 复用 turn-reducer 里的类型，保持既有消费方（Chat / ApprovalPanel / ToolCallCard）的导入路径不变
export type { LiveBlock, PendingApproval, ToolCallState } from './turn-reducer'

interface AgentState {
  sessions: SessionInfo[]
  activeSessionId: string | null
  /** 当前会话展示用的消息基座：无运行 turn 时为 DB 全量，运行中为该 turn 起始快照 */
  messages: ChatMessage[]
  artifacts: ArtifactInfo[]
  /** 按 sessionId 分片的进行中 turn 状态；多任务并发的核心，切走切回都不丢进度 */
  sessionTurns: Record<string, TurnState>

  loadSessions(): Promise<void>
  selectSession(id: string | null): Promise<void>
  createSession(input: { title: string; workDir: string; providerId: string }): Promise<SessionInfo>
  deleteSession(id: string): Promise<void>
  send(text: string): Promise<void>
  cancel(): Promise<void>
  replyPermission(requestId: string, approved: boolean, always: boolean): Promise<void>
  handleEvent(e: AgentStreamEvent): void
  loadArtifacts(): Promise<void>
  clearError(): void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  artifacts: [],
  sessionTurns: {},

  loadSessions: async () => {
    const sessions = await window.api.sessions.list()
    const cur = get().activeSessionId
    set({ sessions })
    if (cur && sessions.some((s) => s.id === cur)) {
      // 保持原选中
    } else if (sessions.length > 0) {
      await get().selectSession(sessions[0].id)
    } else {
      await get().selectSession(null)
    }
  },

  selectSession: async (id) => {
    const turn = id ? get().sessionTurns[id] : undefined
    const running = !!turn?.activeTurnId
    // 运行中的会话：用其起始快照做基座（进行态由 liveBlocks 呈现），避免与 DB 已落库的中间消息重复；
    // 不在这里清任何 turn 状态——后台会话的 turn 必须原样保留继续跑。
    const msgs = running ? turn!.baseMessages : id ? await window.api.messages.list(id) : []
    set({
      activeSessionId: id,
      messages: msgs,
      artifacts: id ? await window.api.artifacts.list(id) : []
    })
  },

  createSession: async (input) => {
    const s = await window.api.sessions.create(input)
    await get().loadSessions()
    await get().selectSession(s.id)
    return s
  },

  deleteSession: async (id) => {
    await window.api.sessions.delete(id)
    const wasActive = get().activeSessionId === id
    const sessions = await window.api.sessions.list()
    set((s) => {
      const sessionTurns = { ...s.sessionTurns }
      delete sessionTurns[id]
      return { sessions, sessionTurns }
    })
    if (wasActive) {
      await get().selectSession(sessions[0]?.id ?? null)
    }
  },

  send: async (text) => {
    const sid = get().activeSessionId
    if (!sid) return
    const prev = get().messages
    const withUser: ChatMessage[] = [...prev, { role: 'user', content: text }]
    // 同步置占位 activeTurnId + 乐观展示 user 消息（DB 已写入，全量重载留给 turn-end）
    set((s) => ({
      messages: withUser,
      sessionTurns: {
        ...s.sessionTurns,
        [sid]: { ...emptyTurn(withUser), activeTurnId: 'pending', turnStartedAt: Date.now() }
      }
    }))
    let res: Awaited<ReturnType<typeof window.api.agent.send>>
    try {
      res = await window.api.agent.send(sid, text)
    } catch (err) {
      set((s) => ({
        sessionTurns: {
          ...s.sessionTurns,
          [sid]: {
            ...(s.sessionTurns[sid] ?? emptyTurn(withUser)),
            activeTurnId: null,
            turnStartedAt: null,
            lastError: err instanceof Error ? err.message : String(err)
          }
        }
      }))
      return
    }
    if (!res.ok || !res.turnId) {
      set((s) => ({
        sessionTurns: {
          ...s.sessionTurns,
          [sid]: {
            ...(s.sessionTurns[sid] ?? emptyTurn(withUser)),
            activeTurnId: null,
            turnStartedAt: null,
            ...(res.error ? { lastError: res.error } : {})
          }
        }
      }))
      return
    }
    const turnId = res.turnId
    set((s) => ({
      sessionTurns: {
        ...s.sessionTurns,
        [sid]: { ...(s.sessionTurns[sid] ?? emptyTurn(withUser)), activeTurnId: turnId }
      }
    }))
  },

  cancel: async () => {
    const sid = get().activeSessionId
    if (!sid) return
    const res = await window.api.agent.cancel(sid)
    // 主进程已无活跃 turn（如渲染进程 reload 后遗留的死锁）：直接清本地进行态
    if (!res.ok) {
      set((s) => ({
        sessionTurns: {
          ...s.sessionTurns,
          [sid]: {
            ...(s.sessionTurns[sid] ?? emptyTurn()),
            activeTurnId: null,
            turnStartedAt: null,
            liveBlocks: [],
            pendingToolCalls: {},
            pendingApprovals: []
          }
        }
      }))
    }
  },

  replyPermission: async (requestId, approved, always) => {
    await window.api.permission.reply(requestId, approved, always)
    set((s) => {
      const sessionTurns = { ...s.sessionTurns }
      for (const [id, t] of Object.entries(sessionTurns)) {
        if (t.pendingApprovals.some((p) => p.requestId === requestId)) {
          sessionTurns[id] = {
            ...t,
            pendingApprovals: t.pendingApprovals.filter((p) => p.requestId !== requestId)
          }
          break
        }
      }
      return { sessionTurns }
    })
  },

  handleEvent: (e) => {
    const sid = e.sessionId
    // 产物事件：仅刷新当前前台会话的产物列表（后台会话下次切入时自然加载）
    if (e.type === 'artifact') {
      if (get().activeSessionId === sid) void get().loadArtifacts()
      return
    }
    // 关键：无论该会话是否在前台，都把事件应用到它自己的 turn 上——后台任务照常累积进度
    set((s) => {
      const turn = s.sessionTurns[sid] ?? emptyTurn()
      return { sessionTurns: { ...s.sessionTurns, [sid]: reduceTurn(turn, e) } }
    })
    // turn 结束且正被查看：从 DB 拉取完整消息覆盖，并刷新该 turn 的基座快照
    if (e.type === 'turn-end' && get().activeSessionId === sid) {
      void (async () => {
        const msgs = await window.api.messages.list(sid)
        set((s) => {
          const t = s.sessionTurns[sid] ?? emptyTurn()
          return {
            messages: msgs,
            sessionTurns: { ...s.sessionTurns, [sid]: { ...t, baseMessages: msgs } }
          }
        })
      })()
    }
  },

  loadArtifacts: async () => {
    const id = get().activeSessionId
    set({ artifacts: id ? await window.api.artifacts.list(id) : [] })
  },

  clearError: () => {
    const sid = get().activeSessionId
    if (!sid) return
    set((s) => ({
      sessionTurns: {
        ...s.sessionTurns,
        [sid]: { ...(s.sessionTurns[sid] ?? emptyTurn()), lastError: null }
      }
    }))
  }
}))

/** 便捷选择器：某会话是否正在运行（侧边栏运行指示用） */
export function isSessionRunning(sessionTurns: Record<string, TurnState>, id: string): boolean {
  return !!sessionTurns[id]?.activeTurnId
}
