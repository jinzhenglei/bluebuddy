import { useEffect, useMemo, useState } from 'react'
import { HomePage } from '@renderer/pages/Home'
import { ChatPage } from '@renderer/pages/Chat'
import { SkillsPage } from '@renderer/pages/Skills'
import { McpPage } from '@renderer/pages/Mcp'
import { SettingsPage } from '@renderer/pages/Settings'
import { Onboarding } from '@renderer/components/Onboarding'
import { UpdateDialog } from '@renderer/components/UpdateDialog'
import { TaskOpenMenu } from '@renderer/components/TaskOpenMenu'
import { useAgentStore } from '@renderer/stores/agent'
import { useSettingsStore } from '@renderer/stores/settings'
import { useSkillsStore } from '@renderer/stores/skills'

type View = 'home' | 'chat' | 'skills' | 'mcp' | 'settings'

/** 与 package.json version 同步维护 */
const APP_VERSION = '0.1.0'

/** 任务时间显示：当天显示 HH:mm，昨天显示「昨天」，更早显示 M-D */
function fmtRelTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (ts >= startOfToday - 86_400_000) return '昨天'
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

function IconPlusCircle(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 6.8v6.4M6.8 10h6.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconTrash(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M4 6h12M8 6V4.5h4V6m-6.5 0 .5 9.5h8l.5-9.5M8.5 9v4M11.5 9v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 技能导航图标：四格拼图块 */
function IconPuzzle(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 4h5v5H4V4Zm7 0h5v5h-5V4ZM4 11h5v5H4v-5Zm7 0h5v5h-5v-5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 连接器导航图标：插头两脚 */
function IconPlug(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M7.2 3v4M12.8 3v4M5.5 7h9v2.5a4.5 4.5 0 0 1-9 0V7Zm4.5 9.5V13"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconGear(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 左下角菜单图标：外观调色板 */
function IconPalette(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 3a7 7 0 1 0 0 14c1 0 1.7-.7 1.7-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h1.4A3.9 3.9 0 0 0 17.7 8C17.4 5.1 14 3 10 3Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="6.2" cy="9.2" r="0.9" fill="currentColor" />
      <circle cx="9" cy="5.8" r="0.9" fill="currentColor" />
      <circle cx="13.2" cy="6.4" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** 左下角菜单图标：帮助问号 */
function IconHelp(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8.2 7.8a1.9 1.9 0 1 1 2.6 1.8c-.7.3-.9.8-.9 1.5v.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="9.9" cy="14.3" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** 左下角菜单图标：检查更新（圆内上箭头） */
function IconUpdate(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 13.5v-7m0 0-2.5 2.5M10 6.5l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 侧边栏导航行的统一样式（WorkBuddy 式：纯行 + 选中浅灰底） */
function navRowClass(active: boolean): string {
  return (
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ' +
    (active ? 'bg-black/5 font-medium text-ink' : 'text-ink-2 hover:bg-black/5 hover:text-ink')
  )
}

/** 左下角弹出菜单的一行 */
function menuRowClass(): string {
  return 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-black/5 hover:text-ink'
}

function App(): React.JSX.Element {
  // 默认落在新建任务页（WorkBuddy 首屏）；点侧边栏任务才进对话视图
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  // 左下角用户菜单与关于/更新弹窗
  const [userMenu, setUserMenu] = useState(false)
  const [dialog, setDialog] = useState<'' | 'about' | 'update'>('')
  // 首次启动向导：prefs.onboarded=false 时弹出（挂载时读一次）
  const [showOnboard, setShowOnboard] = useState(false)

  const sessions = useAgentStore((s) => s.sessions)
  const activeSessionId = useAgentStore((s) => s.activeSessionId)
  const selectSession = useAgentStore((s) => s.selectSession)
  const deleteSession = useAgentStore((s) => s.deleteSession)
  const loadSessions = useAgentStore((s) => s.loadSessions)
  const sessionTurns = useAgentStore((s) => s.sessionTurns)
  const loadProviders = useSettingsStore((s) => s.load)
  const loadSkills = useSkillsStore((s) => s.load)

  // 全局只订阅一次 Agent 事件流，统一转发给 store.handleEvent；
  // 返回的 cleanup 在卸载时取消订阅，避免监听器累积导致同一事件被处理多次。
  useEffect(() => {
    const unsubscribe = window.api.agent.onEvent((e) => useAgentStore.getState().handleEvent(e))
    return unsubscribe
  }, [])

  // 会话列表与模型配置在壳层加载一次，供侧边栏 / 新建任务页 / 对话页共享
  useEffect(() => {
    void loadProviders()
    void loadSessions()
    void loadSkills()
    // 首启检测：未完成向导则弹出（数据未落库前默认不弹，避免闪烁）
    void window.api.prefs.get().then((p) => setShowOnboard(!p.onboarded))
  }, [loadProviders, loadSessions, loadSkills])

  // Ctrl+, 打开设置（WorkBuddy 同款快捷键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setView('settings')
        setUserMenu(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.workDir.toLowerCase().includes(q)
    )
  }, [sessions, query])

  return (
    <div className="flex h-full bg-surface text-ink">
      {/* 左侧边栏：品牌区 + 导航行 + 任务列表（WorkBuddy 式纯文本行） */}
      <aside className="flex w-64 shrink-0 flex-col bg-canvas">
        <div className="flex items-center gap-2 px-5 pt-5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
            B
          </span>
          <span className="text-base font-bold text-ink">BlueBuddy</span>
        </div>
        <div className="px-5 pt-0.5 text-xs text-ink-3">v{APP_VERSION}</div>

        <nav className="space-y-0.5 px-3 pt-4">
          <button className={navRowClass(view === 'home')} onClick={() => setView('home')}>
            <IconPlusCircle /> 新建任务
          </button>
          <button className={navRowClass(view === 'skills')} onClick={() => setView('skills')}>
            <IconPuzzle /> 技能
          </button>
          <button className={navRowClass(view === 'mcp')} onClick={() => setView('mcp')}>
            <IconPlug /> 连接器
          </button>
        </nav>

        <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
          <div className="px-2 pb-1.5 text-[13px] text-ink-3">任务 ({sessions.length})</div>
          <input
            className="mb-1.5 w-full rounded-lg px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-black/5 focus:bg-black/5"
            value={query}
            placeholder="搜索任务"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex-1 overflow-y-auto pb-3">
            {filtered.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-ink-3">
                {query.trim() ? '没有匹配的任务' : '暂无任务'}
              </p>
            )}
            {filtered.map((s) => {
              const active = s.id === activeSessionId && view === 'chat'
              const running = !!sessionTurns[s.id]?.activeTurnId
              return (
                <div
                  key={s.id}
                  className={
                    'group relative rounded-lg ' + (active ? 'bg-black/5' : 'hover:bg-black/5')
                  }
                >
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                    onClick={() => {
                      setView('chat')
                      void selectSession(s.id)
                    }}
                  >
                    {running ? (
                      <span
                        title="执行中"
                        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent"
                      />
                    ) : null}
                    <span
                      className={
                        'min-w-0 flex-1 truncate text-[13px] ' +
                        (active ? 'font-semibold text-ink' : 'text-ink')
                      }
                    >
                      {s.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3 tabular-nums transition-opacity group-hover:opacity-0">
                      {fmtRelTime(s.createdAt)}
                    </span>
                  </button>
                  <button
                    title="删除任务"
                    className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 items-center justify-center rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-500 group-hover:flex"
                    onClick={() => {
                      if (window.confirm(`删除任务「${s.title}」及其全部记录？`))
                        void deleteSession(s.id)
                    }}
                  >
                    <IconTrash />
                  </button>
                  <TaskOpenMenu workDir={s.workDir} />
                </div>
              )
            })}
          </div>
        </div>

        {/* 左下角用户区（WorkBuddy 式）：点头像向上弹出菜单 */}
        <div className="relative shrink-0 border-t border-black/5 px-3 py-2.5">
          {userMenu && (
            <>
              {/* 点菜单外任意处关闭（Skills 页添加菜单同款模式） */}
              <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
              <div className="absolute bottom-full left-3 z-20 mb-1 w-60 overflow-hidden rounded-xl border border-black/8 bg-white p-1.5 shadow-lg">
                <button
                  className={menuRowClass()}
                  onClick={() => {
                    setUserMenu(false)
                    setView('settings')
                  }}
                >
                  <IconGear /> 设置
                  <span className="ml-auto text-xs text-ink-3">Ctrl+,</span>
                </button>
                <button className={menuRowClass()} onClick={() => setUserMenu(false)}>
                  <IconPalette /> 外观
                  <span className="ml-auto text-xs text-ink-3">浅色</span>
                </button>
                <div className="my-1 h-px bg-black/5" />
                <button
                  className={menuRowClass()}
                  onClick={() => {
                    setUserMenu(false)
                    setDialog('about')
                  }}
                >
                  <IconHelp /> 帮助与反馈
                </button>
                <button
                  className={menuRowClass()}
                  onClick={() => {
                    setUserMenu(false)
                    setDialog('update')
                  }}
                >
                  <IconUpdate /> 检查更新
                  <span className="ml-auto text-xs text-ink-3">v{APP_VERSION}</span>
                </button>
              </div>
            </>
          )}
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-black/5"
            onClick={() => setUserMenu((v) => !v)}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
              B
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink">
              BlueBuddy
            </span>
          </button>
        </div>
      </aside>

      {/* 中间主区域：新建任务 / 对话 / 技能 / 设置 */}
      <main className="min-w-0 flex-1 bg-surface">
        {view === 'home' && <HomePage onCreated={() => setView('chat')} />}
        {view === 'chat' && <ChatPage />}
        {view === 'skills' && <SkillsPage />}
        {view === 'mcp' && <McpPage />}
        {view === 'settings' && <SettingsPage />}
      </main>

      {/* 帮助与反馈弹窗（关于信息；真实数据目录随 U2 实装） */}
      {dialog === 'about' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setDialog('')}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
                B
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">BlueBuddy</div>
                <div className="text-xs text-ink-3">版本 v{APP_VERSION}</div>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">
              私有化桌面智能体平台。所有数据仅保存在本机；问题反馈请联系部署管理员。
            </p>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-lg bg-ink px-4 py-1.5 text-sm text-white hover:opacity-90"
                onClick={() => setDialog('')}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 检查更新：阶段 7 接 electron-updater（仅打包安装态生效） */}
      {dialog === 'update' && <UpdateDialog version={APP_VERSION} onClose={() => setDialog('')} />}

      {/* 首次启动向导：覆盖整窗，完成/跳过后写入 onboarded 不再弹出 */}
      {showOnboard && <Onboarding onDone={() => setShowOnboard(false)} />}
    </div>
  )
}

export default App
