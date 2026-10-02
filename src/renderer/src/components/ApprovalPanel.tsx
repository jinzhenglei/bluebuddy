import { useState } from 'react'
import { useAgentStore, type PendingApproval } from '@renderer/stores/agent'

// 稳定空数组兜底，避免选择器每次返回新引用
const NO_APPROVALS: PendingApproval[] = []

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/**
 * 单条待批准的工具调用。展示原因 + 完整参数，提供"本会话始终允许"复选框
 * 与批准/拒绝按钮。批准后从列表移除（引擎侧的挂起 Promise 会被唤醒）。
 */
function ApprovalRow({ approval }: { approval: PendingApproval }): React.JSX.Element {
  const [always, setAlways] = useState(false)
  const reply = useAgentStore((s) => s.replyPermission)

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          需要批准
        </span>
        <span className="font-mono text-xs text-ink-2">{approval.call.function.name}</span>
      </div>
      <p className="mb-2 text-ink">{approval.reason}</p>
      <pre className="mb-3 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-xs text-ink-2">
        {prettyArgs(approval.call.function.arguments)}
      </pre>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
            className="accent-amber-500"
          />
          本会话始终允许该工具
        </label>
        <div className="ml-auto flex gap-2">
          <button
            className="rounded border border-line bg-white px-3 py-1 text-ink-2 hover:bg-canvas"
            onClick={() => void reply(approval.requestId, false, false)}
          >
            拒绝
          </button>
          <button
            className="rounded bg-amber-500 px-3 py-1 text-white hover:bg-amber-400"
            onClick={() => void reply(approval.requestId, true, always)}
          >
            批准
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 批准面板：渲染当前会话所有挂起中的工具批准请求。
 * 无挂起项时不渲染任何内容。
 */
export function ApprovalPanel(): React.JSX.Element | null {
  const approvals = useAgentStore((s) =>
    s.activeSessionId
      ? (s.sessionTurns[s.activeSessionId]?.pendingApprovals ?? NO_APPROVALS)
      : NO_APPROVALS
  )
  if (approvals.length === 0) return null
  return (
    <div className="space-y-2">
      {approvals.map((a) => (
        <ApprovalRow key={a.requestId} approval={a} />
      ))}
    </div>
  )
}
