import { useState } from 'react'
import type { ToolCall } from '@shared/types'
import type { ToolCallState } from '@renderer/stores/agent'
import { useSkillsStore } from '@renderer/stores/skills'
import {
  parseUseSkillName,
  runCommandDisplay,
  skillDisplayName,
  toolCallDisplay,
  toolTitle
} from './tool-display'

/** 已知内置工具的中文标签；未知工具（MCP 等）回落美化后的原始 name */
const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  list_dir: '列出目录',
  run_command: '执行命令',
  fetch_url: '抓取网页',
  use_skill: '加载技能'
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function IconSpinner(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin text-ink-3">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconOk(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-emerald-500">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m7 10 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconErr(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-red-500">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m7.5 7.5 5 5m0-5-5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={'h-3 w-3 transition-transform ' + (open ? 'rotate-90' : '')}
    >
      <path
        d="m8 6 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 一次工具调用的展示步骤条（WorkBuddy 式）：
 * 状态图标（转圈/绿勾/红叉）+ 中文标签 + 调用摘要，点击展开参数与结果。
 */
export function ToolCallCard({ state }: { state: ToolCallState }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const call: ToolCall = state.call
  const label = TOOL_LABELS[call.function.name] ?? toolTitle(call.function.name)
  const status = !state.result ? 'running' : state.result.ok ? 'ok' : 'error'
  // 摘要行：说清这次调用是干嘛的——use_skill 显示技能展示名；run_command 用模型给的
  // 摘要（回退命令行）；其余工具（含 MCP）从关键参数里提炼（如 `查询: 浙江 婚假 天数`）。
  const skills = useSkillsStore((s) => s.skills)
  const skillName =
    call.function.name === 'use_skill' ? parseUseSkillName(call.function.arguments) : null
  const skillLabel = skillName ? skillDisplayName(skills, skillName) : null
  const detail =
    skillLabel ??
    (call.function.name === 'run_command'
      ? runCommandDisplay(call.function.arguments)
      : toolCallDisplay(call.function.arguments))

  return (
    <div className="rounded-xl bg-canvas/80 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {status === 'running' ? <IconSpinner /> : status === 'ok' ? <IconOk /> : <IconErr />}
        <span className="font-medium text-ink">{label}</span>
        {detail ? (
          <span className="min-w-0 truncate text-ink-2" title={detail}>
            {detail}
          </span>
        ) : (
          <span className="font-mono text-xs text-ink-3">{call.function.name}</span>
        )}
        <span className="ml-auto text-ink-3">
          <IconChevron open={open} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div>
            <div className="mb-1 text-xs text-ink-3">参数</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface p-2 font-mono text-xs text-ink-2">
              {prettyArgs(call.function.arguments)}
            </pre>
          </div>
          {state.result && (
            <div>
              <div className="mb-1 text-xs text-ink-3">结果</div>
              <pre
                className={
                  'max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface p-2 font-mono text-xs ' +
                  (state.result.ok ? 'text-ink-2' : 'text-red-600')
                }
              >
                {state.result.content || '（空）'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
