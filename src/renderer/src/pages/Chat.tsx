import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '@renderer/stores/agent'
import { emptyTurn } from '@renderer/stores/turn-reducer'
import { useSettingsStore } from '@renderer/stores/settings'
import { Composer } from '@renderer/components/Composer'
import { Markdown } from '@renderer/components/Markdown'
import { ResultPanel } from '@renderer/components/ResultPanel'
import { ToolCallCard } from '@renderer/components/ToolCallCard'
import { ApprovalPanel } from '@renderer/components/ApprovalPanel'
import { TaskOpenMenu } from '@renderer/components/TaskOpenMenu'
import type { ChatMessage } from '@shared/types'
import type { ToolCallState } from '@renderer/stores/agent'

/**
 * 过程组里的一条：思考块 / 中间叙述 / 工具步骤行，按到达顺序排列。
 * 一轮任务的这些过程记录会被折叠进同一个「过程组」，最终答案留在组外。
 */
type ProcessItem =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tools'; calls: ToolCallState[] }

interface TurnView {
  key: number
  /** 本轮的用户请求气泡文本 */
  userText: string | null
  /** 过程记录：思考 / 工具与技能调用 / 中间叙述，折叠展示 */
  process: ProcessItem[]
  /** 最终答案（过程组外展开渲染） */
  answer: string | null
  /** 是否正在流式执行（过程组默认展开 + 头部显示「执行中」） */
  live: boolean
  /** 历史 turn 的耗时秒数（首尾消息落库时间戳相减）；live turn 为 null */
  durationSec: number | null
}

/** 耗时格式化：<60s 显示 Ns，否则 Nm Ns（对齐 WorkBuddy 的「已完成 28s」） */
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

/**
 * 把持久化消息序列按 turn 分组：user 消息开新一轮，其后的 assistant/tool 消息归入该轮。
 * - assistant 带 tool_calls = 中间步骤：其叙述文本与工具卡片进过程组
 * - assistant 不带 tool_calls 的文本 = 最终答案；若其后又出现工具调用，
 *   原答案降级为过程组里的中间叙述（模型改主意继续动手了）
 * - tool 角色消息不单独成条，结果按 tool_call_id 配对进工具卡片
 */
function buildTurns(messages: ChatMessage[]): TurnView[] {
  const results = new Map<string, { ok: boolean; content: string }>()
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) {
      results.set(m.tool_call_id, { ok: true, content: m.content })
    }
  }

  const turns: TurnView[] = []
  let cur: TurnView | null = null
  let startTs: number | null = null
  let endTs: number | null = null
  // 用首尾消息的落库时间戳结算本轮耗时
  const finalize = (): void => {
    if (cur && startTs !== null && endTs !== null) {
      cur.durationSec = Math.max(0, Math.round((endTs - startTs) / 1000))
    }
  }
  let key = 0
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      if (m.createdAt !== undefined) endTs = m.createdAt
      continue
    }
    if (m.role === 'user') {
      finalize()
      cur = {
        key: key++,
        userText: m.content,
        process: [],
        answer: null,
        live: false,
        durationSec: null
      }
      turns.push(cur)
      startTs = m.createdAt ?? null
      endTs = m.createdAt ?? null
      continue
    }
    if (!cur) {
      cur = {
        key: key++,
        userText: null,
        process: [],
        answer: null,
        live: false,
        durationSec: null
      }
      turns.push(cur)
      startTs = m.createdAt ?? null
      endTs = m.createdAt ?? null
    }
    if (m.createdAt !== undefined) endTs = m.createdAt
    const calls: ToolCallState[] = (m.tool_calls ?? []).map((call) => ({
      call,
      result: results.get(call.id)
    }))
    if (m.reasoning) cur.process.push({ kind: 'reasoning', text: m.reasoning })
    if (calls.length > 0) {
      if (cur.answer) {
        cur.process.push({ kind: 'text', text: cur.answer })
        cur.answer = null
      }
      if (m.content) cur.process.push({ kind: 'text', text: m.content })
      cur.process.push({ kind: 'tools', calls })
    } else if (m.content) {
      if (cur.answer) cur.process.push({ kind: 'text', text: cur.answer })
      cur.answer = m.content
    }
  }
  finalize()
  return turns
}

// 未运行会话的稳定空 turn 兜底（避免每次渲染新建对象触发多余重渲染）
const NO_TURN = emptyTurn()

export function ChatPage(): React.JSX.Element {
  const sessions = useAgentStore((s) => s.sessions)
  const activeSessionId = useAgentStore((s) => s.activeSessionId)
  const messages = useAgentStore((s) => s.messages)
  // 当前会话的进行态从其分片读取；后台运行的会话切回来也能立刻看到进度
  const turn = useAgentStore((s) =>
    s.activeSessionId ? s.sessionTurns[s.activeSessionId] : undefined
  )
  const liveBlocks = turn?.liveBlocks ?? NO_TURN.liveBlocks
  const pendingToolCalls = turn?.pendingToolCalls ?? NO_TURN.pendingToolCalls
  const activeTurnId = turn?.activeTurnId ?? null
  const turnStartedAt = turn?.turnStartedAt ?? null
  const lastError = turn?.lastError ?? null
  const send = useAgentStore((s) => s.send)
  const cancel = useAgentStore((s) => s.cancel)
  const clearError = useAgentStore((s) => s.clearError)
  const providers = useSettingsStore((s) => s.providers)

  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const busy = activeTurnId !== null

  // 运行状态行的计时：busy 期间每秒刷新，展示「执行中 · Ns」；
  // 起始时间戳由 store 在 send/turn-end 时维护，渲染期只读
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [busy])
  const elapsedSec =
    busy && turnStartedAt !== null ? Math.max(0, Math.round((now - turnStartedAt) / 1000)) : 0

  const turns = useMemo(() => {
    const base = buildTurns(messages)
    if (!busy) return base
    // in-flight turn：liveBlocks 尾部连续的文本块 = 正在流式的最终答案，其余归过程组
    let cut = liveBlocks.length
    while (cut > 0 && liveBlocks[cut - 1].kind === 'text') cut--
    const process: ProcessItem[] = []
    for (const b of liveBlocks.slice(0, cut)) {
      if (b.kind === 'reasoning') process.push({ kind: 'reasoning', text: b.text })
      else if (b.kind === 'tool') {
        const tc = pendingToolCalls[b.callId]
        if (tc) process.push({ kind: 'tools', calls: [tc] })
      } else process.push({ kind: 'text', text: b.text })
    }
    const answer = liveBlocks
      .slice(cut)
      .map((b) => (b.kind === 'text' ? b.text : ''))
      .join('')
    const last = base[base.length - 1]
    if (last && last.process.length === 0 && last.answer === null) {
      return [...base.slice(0, -1), { ...last, process, answer: answer || null, live: true }]
    }
    return [
      ...base,
      { key: -1, userText: null, process, answer: answer || null, live: true, durationSec: null }
    ]
  }, [messages, busy, liveBlocks, pendingToolCalls])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns, lastError])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy || !activeSessionId) return
    setInput('')
    await send(text)
  }

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部任务标题栏（WorkBuddy 式：标题 + 工作目录 + 结果区开关）；固定 h-12 与右侧结果区顶栏等高 */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
          <h1 className="truncate text-sm font-semibold text-ink">
            {activeSession ? activeSession.title : 'BlueBuddy'}
          </h1>
          {activeSession && (
            <>
              {/* 打开入口：资源管理器 / 在 IDE 打开（常驻于工作目录左侧） */}
              <div className="ml-auto shrink-0">
                <TaskOpenMenu workDir={activeSession.workDir} variant="header" />
              </div>
              <span className="truncate font-mono text-xs text-ink-3" title={activeSession.workDir}>
                {activeSession.workDir}
              </span>
            </>
          )}
          <button
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? '收起结果区' : '展开结果区（产物 / 文件）'}
            className={
              (activeSession ? '' : 'ml-auto ') +
              'rounded-md p-1.5 ' +
              (panelOpen ? 'bg-black/10 text-ink' : 'text-ink-3 hover:bg-black/5 hover:text-ink')
            }
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
              <rect
                x="2"
                y="3"
                width="12"
                height="10"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path d="M10 3v10" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>

        {/* 消息流：居中阅读宽度（WorkBuddy 式） */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {!activeSession && (
              <p className="text-sm text-ink-3">
                还没有任务。点击左上角「新建任务」，选一个工作目录，让 Agent 在授权范围内替你干活。
              </p>
            )}

            {turns.map((t) => (
              <div key={t.key} className="space-y-3">
                {t.userText !== null && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bubble px-4 py-2.5 text-sm text-ink">
                      {t.userText}
                    </div>
                  </div>
                )}
                {(t.process.length > 0 || t.live) && (
                  <ProcessGroup
                    items={t.process}
                    live={t.live}
                    elapsedSec={elapsedSec}
                    durationSec={t.durationSec}
                  />
                )}
                {t.answer && (
                  <div className={t.live ? 'md-stream' : undefined}>
                    <Markdown>{t.answer}</Markdown>
                  </div>
                )}
              </div>
            ))}

            {/* 批准面板：独立于 busy 渲染。只要有挂起批准就必须可见可点，
              否则（如 reload 后 activeTurnId 丢失）主进程会永挂在等待批准上无法解锁 */}
            <ApprovalPanel />

            {lastError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                <span className="flex-1">{lastError}</span>
                <button className="text-xs text-red-500 underline" onClick={clearError}>
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 输入区：复用统一 Composer（模型只读展示，会话创建时已定） */}
        <div className="px-6 pt-2 pb-5">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={submit}
              busy={busy}
              onCancel={() => void cancel()}
              providers={providers}
              providerId={activeSession?.providerId}
              placeholder={
                activeSession
                  ? '描述你要 Agent 做的事，Enter 发送 / Shift+Enter 换行'
                  : '请先新建一个任务'
              }
            />
          </div>
        </div>
      </div>

      {/* 右侧结果区（U4）：key 按会话重置内部树/预览状态 */}
      {panelOpen && activeSessionId && (
        <ResultPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * 一轮任务的「过程组」：深度思考、工具/技能步骤、中间叙述折叠在同一块里。
 * 执行中默认展开（看活过程），turn 结束自动收起，只留「已完成」头部 + 组外最终答案；
 * 用户可随时展开回看。open 纯派生：userToggled=null 时跟随 live。
 */
function ProcessGroup({
  items,
  live,
  elapsedSec,
  durationSec
}: {
  items: ProcessItem[]
  live: boolean
  elapsedSec: number
  durationSec: number | null
}): React.JSX.Element {
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled === null ? live : userToggled
  return (
    <div>
      <button
        className="flex items-center gap-1.5 text-sm text-ink-3 transition hover:text-ink-2"
        onClick={() => setUserToggled(!open)}
      >
        {live ? (
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin">
            <circle
              cx="10"
              cy="10"
              r="7"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <path
              d="M17 10a7 7 0 0 0-7-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="m7 10.2 2.1 2.1L13 8.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span>
          {live
            ? `执行中 · ${elapsedSec}s`
            : durationSec !== null
              ? `已完成 · ${fmtDuration(durationSec)}`
              : '已完成'}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={'h-3.5 w-3.5 transition-transform ' + (open ? 'rotate-90' : '')}
        >
          <path
            d="m8 5 5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((it, i) => {
            if (it.kind === 'reasoning') {
              return (
                <ReasoningBlock
                  key={`r${i}`}
                  text={it.text}
                  streaming={live && i === items.length - 1}
                />
              )
            }
            if (it.kind === 'tools') {
              return (
                <div key={`t${i}`} className="space-y-2">
                  {it.calls.map((c) => (
                    <ToolCallCard key={c.call.id} state={c} />
                  ))}
                </div>
              )
            }
            return (
              <div key={`x${i}`} className="text-ink-2">
                <Markdown>{it.text}</Markdown>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 「深度思考」折叠块：流式接收中默认展开，后续块到来（streaming=false）自动收起，
 * 用户可随时手动展开/收起。正文灰左边线引文体，对齐 WorkBuddy 的思考块观感。
 * open 纯派生：userToggled=null 时跟随 streaming，否则以用户手动选择为准，
 * 避免在 effect 里 setState 触发级联渲染。
 */
function ReasoningBlock({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled === null ? streaming : userToggled
  // 流式接收中内层滚动容器跟到底部，保证始终可见最新思考内容
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [text, streaming])
  return (
    <div>
      <button
        className="flex items-center gap-1.5 text-sm text-ink-3 transition hover:text-ink-2"
        onClick={() => setUserToggled(!open)}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path
            d="M10 3a4 4 0 0 1 4 4c0 1.2-.5 2-1 2.8-.4.6-.6 1.2-.7 1.9H7.7c-.1-.7-.3-1.3-.7-1.9-.5-.8-1-1.6-1-2.8a4 4 0 0 1 4-4Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M8 14.5h4M8.8 16.8h2.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        深度思考
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={'h-3.5 w-3.5 transition-transform ' + (open ? 'rotate-90' : '')}
        >
          <path
            d="m8 5 5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-2"
        >
          {text}
        </div>
      )}
    </div>
  )
}
