import type { MessageFeedback, TurnPrompt } from '@shared/types'
import type { ToolCallState } from '@renderer/stores/agent'

/**
 * 过程组里的一条：思考块 / 中间叙述 / 工具步骤行，按到达顺序排列。
 * 一轮任务的这些过程记录会被折叠进同一个「过程组」，最终答案留在组外。
 */
export type ProcessItem =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tools'; calls: ToolCallState[] }

/** 一轮任务的展示视图（buildTurns 从持久化消息序列派生） */
export interface TurnView {
  key: number
  /** 本轮的用户请求气泡文本 */
  userText: string | null
  /** 本轮 user 消息的落库 id（提示词快照按它锚定）；无消息/乐观消息为 null */
  userMsgId: string | null
  /** 过程记录：思考 / 工具与技能调用 / 中间叙述，折叠展示 */
  process: ProcessItem[]
  /** 最终答案（过程组外展开渲染） */
  answer: string | null
  /** 最终答案所在消息的落库 id（反馈按它定位）；live turn / 乐观消息为 null */
  answerId: string | null
  /** 对最终答案的反馈（点赞/点踩）；无反馈为 null */
  feedback: MessageFeedback | null
  /** 是否正在流式执行（过程组默认展开 + 头部显示「执行中」） */
  live: boolean
  /** 历史 turn 的耗时秒数（首尾消息落库时间戳相减）；live turn 为 null */
  durationSec: number | null
}

/**
 * 单轮 Trajectory 的导出结构：用户请求 + 过程步骤（思考/叙述/工具调用与结果）
 * + 最终答案。JSON 平铺、带 format 标记，便于外部工具/评测流水线消费。
 */
interface Trajectory {
  format: 'bluebuddy-trajectory'
  version: 2
  exportedAt: string
  sessionId: string
  /** 会话内轮次序号（0 起） */
  turnIndex: number
  durationSec: number | null
  userText: string | null
  /**
   * 任务当时的系统提示词快照（装配结果）与模型名；旧数据无快照为 null。
   * 提示词会随技能/项目配置演进，只认任务当时那一份。
   */
  promptSnapshot: { system: string; model: string | null } | null
  steps: Array<
    | { kind: 'reasoning'; text: string }
    | { kind: 'text'; text: string }
    | {
        kind: 'tool'
        name: string
        arguments: string
        result: { ok: boolean; content: string } | null
      }
  >
  answer: string | null
  /** 最终答案所在消息的落库 id；导出后可与反馈数据按 id 关联 */
  answerId: string | null
  /** 对最终答案的反馈（点赞/点踩） */
  feedback: MessageFeedback | null
}

/** 纯组装（导出供测试）；downloadTrajectory 在其上补提示词快照与下载动作 */
export function buildTrajectory(
  turn: TurnView,
  sessionId: string,
  turnIndex: number,
  prompt: TurnPrompt | null
): Trajectory {
  const steps: Trajectory['steps'] = []
  for (const item of turn.process) {
    if (item.kind === 'tools') {
      for (const c of item.calls) {
        steps.push({
          kind: 'tool',
          name: c.call.function.name,
          arguments: c.call.function.arguments,
          result: c.result ?? null
        })
      }
    } else {
      steps.push({ kind: item.kind, text: item.text })
    }
  }
  return {
    format: 'bluebuddy-trajectory',
    version: 2,
    exportedAt: new Date().toISOString(),
    sessionId,
    turnIndex,
    durationSec: turn.durationSec,
    userText: turn.userText,
    promptSnapshot: prompt ? { system: prompt.prompt, model: prompt.model ?? null } : null,
    steps,
    answer: turn.answer,
    answerId: turn.answerId,
    feedback: turn.feedback
  }
}

/** 把一轮任务的 Trajectory 导出为 JSON 文件下载（先取任务当时的提示词快照一并写入） */
export async function downloadTrajectory(
  turn: TurnView,
  sessionId: string,
  turnIndex: number
): Promise<void> {
  const prompt = turn.userMsgId ? await window.api.messages.getTurnPrompt(turn.userMsgId) : null
  const data = buildTrajectory(turn, sessionId, turnIndex, prompt)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bluebuddy-trajectory-${new Date().toISOString().slice(0, 10)}-turn${turnIndex + 1}.json`
  a.click()
  URL.revokeObjectURL(url)
}
