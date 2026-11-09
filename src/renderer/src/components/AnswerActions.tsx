import { useAgentStore } from '@renderer/stores/agent'
import { downloadTrajectory, type TurnView } from './turn-trajectory'

function IconThumbUp({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  )
}

function IconThumbDown({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  )
}

/** 轨迹图标：端点节点 + 蜿蜒路径，表示一轮任务从提问到答案的过程轨迹 */
function IconTrajectory(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  )
}

/**
 * 回答下方的操作条：点赞 / 点踩 / 导出 Trajectory。
 * 点赞与点踩互斥，再点一次可取消；反馈按回答消息 id 落库（重启/重开会话后仍在）。
 * 导出把本轮用户请求、过程步骤与最终答案打包成 JSON 文件下载。
 */
export function AnswerActions({
  turn,
  sessionId
}: {
  turn: TurnView
  sessionId: string
}): React.JSX.Element {
  const setFeedback = useAgentStore((s) => s.setFeedback)
  const vote = turn.feedback

  const toggle = (next: 'up' | 'down'): void => {
    // 反馈按回答消息 id 落库；消息还没有 id 时（乐观展示）点了不生效
    if (!turn.answerId) return
    setFeedback(turn.answerId, vote === next ? null : next)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        title="点赞"
        onClick={() => toggle('up')}
        className={
          'rounded-md p-1.5 ' +
          (vote === 'up'
            ? 'bg-emerald-500/10 text-emerald-500'
            : 'text-ink-3 hover:bg-black/5 hover:text-ink')
        }
      >
        <IconThumbUp active={vote === 'up'} />
      </button>
      <button
        title="点踩"
        onClick={() => toggle('down')}
        className={
          'rounded-md p-1.5 ' +
          (vote === 'down'
            ? 'bg-red-500/10 text-red-500'
            : 'text-ink-3 hover:bg-black/5 hover:text-ink')
        }
      >
        <IconThumbDown active={vote === 'down'} />
      </button>
      <button
        title="导出 Trajectory"
        onClick={() => void downloadTrajectory(turn, sessionId, turn.key)}
        className="rounded-md p-1.5 text-ink-3 hover:bg-black/5 hover:text-ink"
      >
        <IconTrajectory />
      </button>
    </div>
  )
}
