import { useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '@shared/types'

/**
 * WorkBuddy 式统一输入组件（Composer）：
 * - 大圆角白色输入卡片：上输入区 + 下工具行（+ 占位 / 模型选择 / 圆形发送钮）
 * - home 形态额外带一条灰色底带（选择工作空间 / 默认权限），与卡片拼成复合体
 * - 受控组件：value/onChange 由父级持有，便于场景 chips 等外部填字
 */
export interface ComposerProps {
  value: string
  onChange(v: string): void
  onSubmit(): void | Promise<void>
  busy?: boolean
  onCancel?(): void
  /** home 形态：更大的输入区 + 工作空间/权限灰带 */
  home?: boolean
  workDir?: string
  onPickWorkDir?(): void
  providers?: ProviderConfig[]
  providerId?: string
  /** 传入则可切换模型（home）；不传则模型只读展示（chat） */
  onProviderChange?(id: string): void
  placeholder?: string
}

function IconSend(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 16V4.5M5.5 9 10 4.5 14.5 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconStop(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4">
      <rect x="5" y="5" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  )
}

function IconPlus(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 4.5v11M4.5 10h11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconChevron(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="m6 8 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFolder(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M3 5.5h5l1.5 2H17v8H3v-10Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconShield(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 3 4.5 5v4.5c0 3.4 2.3 6 5.5 7.5 3.2-1.5 5.5-4.1 5.5-7.5V5L10 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="m7.8 9.6 1.6 1.6 2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 工作目录只显示最后一段目录名，完整路径放 title */
function shortDir(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : dir
}

/**
 * 自定义模型选择下拉：替换原生 <select>（其弹出菜单走系统默认样式，
 * 蓝色高亮与 WorkBuddy 浅色设计相冲）。菜单向上弹出，避免被底部输入区裁切；
 * 点击外部或 Esc 关闭，当前项打勾。
 */
function ModelSelect({
  providers,
  value,
  onChange
}: {
  providers: ProviderConfig[]
  value: string
  onChange(id: string): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = providers.find((p) => p.id === value)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-64 items-center gap-1 rounded-full py-1 pr-2 pl-2.5 text-sm text-ink-2 transition hover:bg-canvas"
      >
        <span className="truncate">
          {current ? `${current.name} · ${current.model}` : '选择模型'}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={'h-3 w-3 shrink-0 transition-transform ' + (open ? 'rotate-180' : '')}
        >
          <path
            d="m6 8 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 bottom-full z-20 mb-2 max-h-64 min-w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg"
        >
          {providers.map((p) => {
            const selected = p.id === value
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(p.id)
                  setOpen(false)
                }}
                className={
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap transition hover:bg-canvas ' +
                  (selected ? 'text-ink' : 'text-ink-2')
                }
              >
                <span className="flex-1 truncate">
                  {p.name} · {p.model}
                </span>
                {selected && (
                  <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0">
                    <path
                      d="m5 10.5 3.5 3.5L15 7"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const {
    value,
    onChange,
    onSubmit,
    busy,
    onCancel,
    home,
    workDir,
    onPickWorkDir,
    providers,
    providerId,
    onProviderChange,
    placeholder
  } = props

  const canSend = value.trim().length > 0 && !busy
  const provider = providers?.find((p) => p.id === providerId)

  return (
    <div className={'w-full ' + (home ? 'max-w-2xl' : '')}>
      <div
        className={
          'border border-line bg-surface shadow-sm transition focus-within:border-ink-3/50 ' +
          (home ? 'rounded-t-[22px] rounded-b-2xl' : 'rounded-2xl')
        }
      >
        <textarea
          className={
            'w-full resize-none border-none bg-transparent px-5 text-sm text-ink outline-none placeholder:text-ink-3 ' +
            (home ? 'min-h-[92px] pt-4 pb-1' : 'min-h-[44px] pt-3 pb-1')
          }
          rows={home ? 3 : 1}
          value={value}
          placeholder={placeholder ?? '描述你要 Agent 做的事，Enter 发送 / Shift+Enter 换行'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend) void onSubmit()
            }
          }}
        />
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            title="添加附件（二期）"
            disabled
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 opacity-50"
          >
            <IconPlus />
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {providers &&
              providerId !== undefined &&
              providers.length > 0 &&
              (onProviderChange ? (
                <ModelSelect providers={providers} value={providerId} onChange={onProviderChange} />
              ) : (
                <span className="rounded-full px-2.5 py-1 text-sm text-ink-3">
                  {provider ? `${provider.name} · ${provider.model}` : '未配置模型'}
                </span>
              ))}
            {busy ? (
              <button
                title="停止"
                onClick={onCancel}
                className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:bg-canvas"
              >
                {/* 执行动效：环绕旋转的进度弧，表示 Agent 正在跑 */}
                <svg
                  viewBox="0 0 36 36"
                  fill="none"
                  className="pointer-events-none absolute inset-0 h-full w-full animate-spin text-ink-3"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="16.5"
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeWidth="2"
                  />
                  <path
                    d="M18 1.5a16.5 16.5 0 0 1 16.5 16.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <IconStop />
              </button>
            ) : (
              <button
                title="发送"
                disabled={!canSend}
                onClick={() => void onSubmit()}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition hover:bg-black disabled:opacity-30"
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>

      {home && (
        <div className="flex items-center gap-6 rounded-b-[22px] border border-t-0 border-line bg-canvas px-4 py-2">
          <button
            className="flex items-center gap-1.5 text-sm text-ink-2 transition hover:text-ink"
            onClick={onPickWorkDir}
          >
            <IconFolder />
            <span className={workDir ? 'max-w-56 truncate' : 'text-ink-3'} title={workDir}>
              {workDir ? shortDir(workDir) : '选择工作空间'}
            </span>
            <IconChevron />
          </button>
          <span
            className="flex items-center gap-1.5 text-sm text-ink-3"
            title="MVP 固定默认权限：高危操作仍会逐次弹窗征求批准"
          >
            <IconShield /> 默认权限 <IconChevron />
          </span>
        </div>
      )}
    </div>
  )
}
