import type { AgentStreamEvent, ChatMessage, ToolCall } from '@shared/types'

/**
 * 单个会话「进行中 turn」的状态。多任务并发的关键：每个 sessionId 各持一份，
 * 切走再切回也不丢进度；后台会话的事件也照常更新自己那一份。
 */
export interface TurnState {
  activeTurnId: string | null
  /** 本 turn 开始时间戳（渲染「执行中 · Ns」计时） */
  turnStartedAt: number | null
  /** turn 开始时的消息快照（历史 + 本次 user）；运行中用它做静态基座，避免与 liveBlocks 重复 */
  baseMessages: ChatMessage[]
  liveBlocks: LiveBlock[]
  pendingToolCalls: Record<string, ToolCallState>
  pendingApprovals: PendingApproval[]
  lastError: string | null
}

export interface ToolCallState {
  call: ToolCall
  result?: { ok: boolean; content: string }
}

export interface PendingApproval {
  requestId: string
  call: ToolCall
  reason: string
}

/**
 * in-flight 交错时间线的一个块：思考块 / 工具块 / 文本块按到达顺序排列。
 * 不落库：turn-end 从 DB 重载 messages 后清空。
 */
export type LiveBlock =
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; callId: string }
  | { kind: 'text'; text: string }

/** 向时间线追加一段流式文本：与末块同类则拼接，异类则开新块 */
export function appendBlockText(
  blocks: LiveBlock[],
  kind: 'reasoning' | 'text',
  text: string
): LiveBlock[] {
  const last = blocks[blocks.length - 1]
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + text }]
  }
  return [...blocks, { kind, text }]
}

/** 一个空 turn（用于未运行会话的兜底，保持引用稳定） */
export function emptyTurn(baseMessages: ChatMessage[] = []): TurnState {
  return {
    activeTurnId: null,
    turnStartedAt: null,
    baseMessages,
    liveBlocks: [],
    pendingToolCalls: {},
    pendingApprovals: [],
    lastError: null
  }
}

/**
 * 纯 reducer：把一个 AgentStreamEvent 应用到某会话的 turn 上，返回新 turn。
 * 无副作用（不碰 window / 不做异步），便于单测。artifact 事件不改 turn（由 store 侧刷新产物）。
 */
export function reduceTurn(turn: TurnState, e: AgentStreamEvent): TurnState {
  switch (e.type) {
    case 'text-delta':
      return { ...turn, liveBlocks: appendBlockText(turn.liveBlocks, 'text', e.text) }
    case 'reasoning-delta':
      return { ...turn, liveBlocks: appendBlockText(turn.liveBlocks, 'reasoning', e.text) }
    case 'tool-call':
      return {
        ...turn,
        pendingToolCalls: { ...turn.pendingToolCalls, [e.call.id]: { call: e.call } },
        liveBlocks: [...turn.liveBlocks, { kind: 'tool', callId: e.call.id }]
      }
    case 'tool-result': {
      const cur = turn.pendingToolCalls[e.callId]
      if (!cur) return turn
      return {
        ...turn,
        pendingToolCalls: {
          ...turn.pendingToolCalls,
          [e.callId]: { ...cur, result: { ok: e.ok, content: e.content } }
        }
      }
    }
    case 'approval-required':
      return {
        ...turn,
        pendingApprovals: [
          ...turn.pendingApprovals,
          { requestId: e.requestId, call: e.call, reason: e.reason }
        ]
      }
    case 'artifact':
      return turn
    case 'turn-end':
      // 收尾：清空进行态，保留错误；baseMessages 待 store 侧从 DB 刷新
      return {
        ...turn,
        activeTurnId: null,
        turnStartedAt: null,
        liveBlocks: [],
        pendingToolCalls: {},
        pendingApprovals: [],
        lastError: e.reason === 'error' ? (e.error ?? 'unknown error') : null
      }
    default:
      return turn
  }
}
