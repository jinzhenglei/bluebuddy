import { useEffect, useRef, useState } from 'react'
import type { IdeAppView } from '@shared/types'

/**
 * 「打开」下拉菜单：
 * - 文件资源管理器（复用 system.openPath）；
 * - 各 IDE：用其真实图标（主进程 app.getFileIcon 提取），默认项右侧打 ✓。
 * variant='row'：侧栏任务行悬停浮现的 ⋯ 入口（绝对定位）；
 * variant='header'：对话页顶栏常驻的「图标 + 下拉箭头」触发（显示当前默认 IDE 图标）。
 * 挂载即拉一次列表与默认偏好（供 header 触发显示图标），打开时再刷新；关闭即回收监听。
 * 渲染端只传 workDir 与应用 id，可执行路径始终留在主进程解析。
 */
export function TaskOpenMenu({
  workDir,
  variant = 'row'
}: {
  workDir: string
  variant?: 'row' | 'header'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<IdeAppView[]>([])
  const [defaultId, setDefaultId] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  const load = (): void => {
    void Promise.all([window.api.apps.list(), window.api.prefs.get()])
      .then(([list, prefs]) => {
        setApps(list.filter((a) => a.enabled))
        setDefaultId(prefs.defaultIdeId)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

  // 挂载即拉一次，供 header 触发按钮显示默认 IDE 图标
  useEffect(() => {
    load()
  }, [])

  // 打开时：点外部关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = (): void => {
    const next = !open
    if (next) {
      setLoading(true)
      load()
    }
    setOpen(next)
  }

  const openInExplorer = (): void => {
    void window.api.system.openPath(workDir)
    setOpen(false)
  }
  const openInIde = (id: string): void => {
    void window.api.apps.openFolder(id, workDir)
    setOpen(false)
  }

  // 默认项排最前，其余按原序
  const ordered = [...apps].sort(
    (a, b) => (a.id === defaultId ? -1 : 0) - (b.id === defaultId ? -1 : 0)
  )
  const defaultApp = apps.find((a) => a.id === defaultId)

  // 分体按钮主区（图标）：有默认 IDE 直接用它打开，否则回退到资源管理器
  const primaryOpen = (): void => {
    if (defaultApp) openInIde(defaultApp.id)
    else openInExplorer()
  }

  const wrapperClass =
    variant === 'header'
      ? 'relative shrink-0'
      : 'absolute top-1/2 right-8 z-20 -translate-y-1/2 ' +
        (open ? 'block' : 'hidden group-hover:block')

  return (
    <div ref={ref} className={wrapperClass}>
      {variant === 'header' ? (
        <div className="flex items-center rounded-lg border border-line bg-surface text-ink">
          <button
            title={defaultApp ? `在 ${defaultApp.name} 打开` : '在资源管理器打开'}
            aria-label="打开目录"
            onClick={primaryOpen}
            className="flex items-center rounded-l-lg py-1 pl-2 pr-1 transition hover:bg-black/5"
          >
            <AppGlyph app={defaultApp} size={18} fallbackFolder />
          </button>
          <span className="h-4 w-px bg-line" />
          <button
            title="选择打开方式"
            aria-label="打开方式菜单"
            onClick={toggle}
            className="flex items-center rounded-r-lg py-1 pl-1 pr-1.5 text-ink-3 transition hover:bg-black/5"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
              <path
                d="m4 6 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          title="打开目录 / 在 IDE 中打开"
          aria-label="打开目录"
          onClick={toggle}
          className="flex items-center justify-center rounded p-1 text-ink-3 hover:bg-black/5 hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <circle cx="5" cy="10" r="1.4" />
            <circle cx="10" cy="10" r="1.4" />
            <circle cx="15" cy="10" r="1.4" />
          </svg>
        </button>
      )}

      {open && (
        <div className="absolute top-full right-0 z-30 mt-1.5 w-56 rounded-xl border border-line bg-white p-1 shadow-xl">
          <MenuItem icon={<FolderGlyph />} label="文件资源管理器" onClick={openInExplorer} />
          <div className="my-1 h-px bg-line" />
          {loading && <div className="px-2.5 py-1.5 text-xs text-ink-3">检测中…</div>}
          {!loading && apps.length === 0 && (
            <div className="px-2.5 py-1.5 text-xs text-ink-3">未检测到 IDE，可在设置里添加</div>
          )}
          {!loading &&
            ordered.map((a) => (
              <MenuItem
                key={a.id}
                icon={<AppGlyph app={a} size={20} />}
                label={a.name}
                checked={a.id === defaultId}
                onClick={() => openInIde(a.id)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

/** 菜单项：左图标 + 文案 + 选中标记 ✓ */
function MenuItem({
  icon,
  label,
  onClick,
  checked
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  checked?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink transition hover:bg-canvas"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && (
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-brand">
          <path
            d="m5 10.5 3.2 3.2L15 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

/** 应用图标：有真实图标用 <img>，否则回退尖括号；app 为空且 fallbackFolder 时显示文件夹 */
function AppGlyph({
  app,
  size,
  fallbackFolder
}: {
  app?: IdeAppView
  size: number
  fallbackFolder?: boolean
}): React.JSX.Element {
  if (!app) return fallbackFolder ? <FolderGlyph /> : <CodeGlyph />
  if (app.icon)
    return (
      <img
        src={app.icon}
        alt=""
        width={size}
        height={size}
        className="rounded-[4px]"
        style={{ width: size, height: size }}
      />
    )
  return <CodeGlyph />
}

/** 彩色文件夹图标（仿 Windows 资源管理器） */
function FolderGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5">
      <path
        d="M2.4 5.3c0-.7.5-1.2 1.2-1.2h3.2c.4 0 .8.2 1 .5l.9 1.1h6.7c.7 0 1.2.5 1.2 1.2v.7H2.4V5.3Z"
        fill="#E9A93A"
      />
      <path
        d="M2.1 7.9h15.8c.6 0 1 .5.9 1.1l-.8 5.3c-.1.6-.6 1-1.2 1H4.2c-.6 0-1.1-.4-1.2-1l-.8-5.3c-.1-.6.3-1.1.9-1.1Z"
        fill="#F7C863"
      />
    </svg>
  )
}

/** 代码/编辑器回退图标（尖括号） */
function CodeGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-ink-3">
      <path
        d="M7.5 7 4.5 10l3 3M12.5 7l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
