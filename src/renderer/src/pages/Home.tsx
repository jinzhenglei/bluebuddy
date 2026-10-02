import { useEffect, useState } from 'react'
import { Composer } from '@renderer/components/Composer'
import { useAgentStore } from '@renderer/stores/agent'
import { useSettingsStore } from '@renderer/stores/settings'
import type { AppPrefs } from '@shared/types'

/**
 * 新建任务页（WorkBuddy 首屏）：居中大标题 + 模式胶囊 + 场景入口 chips + Composer。
 * 发送即创建任务：标题取首句截断，工作空间/模型在 Composer 灰带与工具行选定。
 */
type Mode = 'office' | 'code'

interface Scenario {
  label: string
  template: string
  icon: React.JSX.Element
}

function IconCup(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4.5 6h9v5.5a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4V6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M13.5 7.5h1.6a2 2 0 0 1 0 4h-1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconCode(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="m7 6.5-3.5 3.5L7 13.5M13 6.5l3.5 3.5-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFile(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M5.5 3.5h6l3 3v10h-9v-13Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M11.5 3.5v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function IconChart(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 16V9M8.5 16V4.5M13 16v-6M17 16H3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconPen(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="m4 16 .8-3.2 8.4-8.4 2.4 2.4-8.4 8.4L4 16Z"
        stroke="currentColor"
        strokeWidth="1.4"
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

function IconBug(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="11" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 7V5.5M6.5 8.5 5 7M13.5 8.5 15 7M6 11H4M16 11h-2M6.5 13.5 5 15M13.5 13.5 15 15"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconBook(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 5.5C8.5 4 6 3.8 4 4.5v10c2-.7 4.5-.5 6 1 1.5-1.5 4-1.7 6-1v-10c-2-.7-4.5-.5-6 1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10 5.5v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconCheck(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
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

/** 场景入口：MVP 仅把模板文案填入输入框；模式胶囊只切换 chips 集合 */
const SCENARIOS: Record<Mode, Scenario[]> = {
  office: [
    {
      label: '文档处理',
      template: '帮我整理工作空间里的文档，生成一份摘要报告',
      icon: <IconFile />
    },
    {
      label: '数据分析及可视化',
      template: '帮我分析工作空间里的数据文件，给出结论与图表建议',
      icon: <IconChart />
    },
    { label: '周报生成', template: '帮我把工作空间里本周的工作记录整理成周报', icon: <IconPen /> },
    {
      label: '文件整理',
      template: '帮我把工作空间里杂乱的文件按类型分类整理',
      icon: <IconFolder />
    }
  ],
  code: [
    { label: '代码审查', template: '帮我审查工作空间里的代码，指出潜在问题', icon: <IconCode /> },
    {
      label: 'Bug 诊断',
      template: '帮我诊断工作空间里程序运行报错的原因并给出修复方案',
      icon: <IconBug />
    },
    {
      label: '项目架构解读',
      template: '帮我梳理工作空间里代码的架构，输出一份新人上手文档',
      icon: <IconBook />
    },
    { label: '补单元测试', template: '帮我为工作空间里的核心模块补充单元测试', icon: <IconCheck /> }
  ]
}

function ModePill({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick(): void
  icon: React.JSX.Element
  label: string
}): React.JSX.Element {
  return (
    <button
      className={
        'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition ' +
        (active ? 'bg-ink font-medium text-white' : 'text-ink-2 hover:text-ink')
      }
      onClick={onClick}
    >
      {icon} {label}
    </button>
  )
}

export function HomePage({ onCreated }: { onCreated(): void }): React.JSX.Element {
  const createSession = useAgentStore((s) => s.createSession)
  const send = useAgentStore((s) => s.send)
  const providers = useSettingsStore((s) => s.providers)

  const [mode, setMode] = useState<Mode>('office')
  const [input, setInput] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [providerId, setProviderId] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)

  // 挂载时拉一次应用偏好：默认工作目录/默认模型作为首选项填入（用户手改后不覆盖）
  useEffect(() => {
    let alive = true
    void window.api.prefs.get().then((p) => {
      if (!alive) return
      setPrefs(p)
      if (p.defaultWorkDir) setWorkDir((prev) => prev || p.defaultWorkDir)
    })
    return () => {
      alive = false
    }
  }, [])

  // 优先级：会话内手选 > 设置里的默认模型 > 第一个可用 Provider
  const effectiveProvider = providerId || prefs?.defaultProviderId || providers[0]?.id || ''

  const pickWorkDir = async (): Promise<void> => {
    const dir = await window.api.system.pickDirectory()
    if (dir) {
      setWorkDir(dir)
      setHint(null)
    }
  }

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    if (!workDir) {
      setHint('请先在输入框下方灰带中选择工作空间')
      return
    }
    if (!effectiveProvider) {
      setHint('还没有可用的模型服务，请先到「设置」中添加')
      return
    }
    setHint(null)
    const title = text.length > 24 ? `${text.slice(0, 24)}…` : text
    await createSession({ title, workDir, providerId: effectiveProvider })
    setInput('')
    onCreated()
    await send(text)
  }

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-8 pt-[12vh] pb-10">
      <h1 className="text-4xl font-bold tracking-tight text-ink">BlueBuddy, 我帮你</h1>

      {/* 模式胶囊：MVP 仅视觉切换场景入口，不接 system prompt */}
      <div className="mt-7 flex items-center rounded-full bg-canvas p-1">
        <ModePill
          active={mode === 'office'}
          onClick={() => setMode('office')}
          icon={<IconCup />}
          label="日常办公"
        />
        <ModePill
          active={mode === 'code'}
          onClick={() => setMode('code')}
          icon={<IconCode />}
          label="代码开发"
        />
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {SCENARIOS[mode].map((sc) => (
          <button
            key={sc.label}
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-2 shadow-sm transition hover:border-ink-3/60 hover:text-ink"
            onClick={() => setInput(sc.template)}
          >
            {sc.icon} {sc.label}
          </button>
        ))}
      </div>

      <div className="mt-10 flex w-full justify-center">
        <Composer
          home
          value={input}
          onChange={setInput}
          onSubmit={submit}
          workDir={workDir}
          onPickWorkDir={() => void pickWorkDir()}
          providers={providers}
          providerId={effectiveProvider}
          onProviderChange={setProviderId}
          placeholder="一句话给我布置任务，例如：帮我整理这个目录里的文件"
        />
      </div>
      {hint && <p className="mt-3 text-sm text-red-500">{hint}</p>}
    </div>
  )
}
