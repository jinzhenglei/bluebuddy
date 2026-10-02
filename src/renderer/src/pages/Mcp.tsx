import { useEffect, useMemo, useState } from 'react'
import type { McpHubItem, McpServerStatus, McpToolDoc, McpTransport } from '@shared/types'
import { Markdown } from '@renderer/components/Markdown'
import { genericFaq, genericNotes, parseReadme, toolParams } from '@renderer/components/mcp-detail'
import { parseMcpJson } from './mcp-import'

/**
 * 连接器页（WorkBuddy 双视图）：
 * - 发现：魔搭 MCP 市场实时搜索（不缓存），卡片可直接安装——
 *   安装计划由主进程拉详情解析（stdio 一键 / Hosted 需已配 Token），
 *   已安装的服务按 hubId 打绿勾标记。
 * - 已安装：连接池管理（状态点/工具清单/启停/重连/两步删除）+ 本地过滤。
 * 顶栏另有两个辅助入口：导入 mcp.json、配置魔搭访问令牌。
 */

const PAGE_SIZE = 24

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function hueOf(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function StatusDot({ status }: { status: McpServerStatus['status'] }): React.JSX.Element {
  const color =
    status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-gray-300'
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />
}

const STATUS_TEXT: Record<McpServerStatus['status'], string> = {
  connected: '已连接',
  error: '连接失败',
  disabled: '已停用'
}

function Toggle({
  on,
  disabled,
  onChange
}: {
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ' +
        (on ? 'bg-emerald-500' : 'bg-gray-300')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ' +
          (on ? 'left-4.5' : 'left-0.5')
        }
      />
    </button>
  )
}

function Spinner(): React.JSX.Element {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  )
}

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSearch(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function IconCheck(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="m4.5 10.5 3.5 3.5 7-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconRefresh(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.2h-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
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

function IconKey(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <circle cx="7.5" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m10 11 5.5 5.5M13 14l1.5-1.5M14.8 15.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconImport(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M10 3v8m0 0 3-3m-3 3-3-3M4 13v3h12v-3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 小按钮（顶栏辅助入口） */
function chipBtn(active?: boolean): string {
  return (
    'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition ' +
    (active
      ? 'border-brand/30 bg-brand/5 text-brand'
      : 'border-black/10 bg-white text-ink-2 hover:border-black/20 hover:text-ink')
  )
}

/** 弹窗骨架 */
function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className={'w-full rounded-xl bg-white p-5 shadow-xl ' + (wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-black/5">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand'
const labelClass = 'mb-1 block text-xs font-medium text-ink-2'

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function kvPairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of lines(text)) {
    const i = l.indexOf('=')
    if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  return out
}

/** 手动添加服务器表单（stdio / http 双形态） */
function AddForm({ onDone }: { onDone: (error?: string) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [url, setUrl] = useState('')
  const [sse, setSse] = useState(false)
  const [headersText, setHeadersText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return setError('请填写名称')
    if (transport === 'stdio' && !command.trim()) return setError('stdio 需要启动命令')
    if (transport === 'http') {
      try {
        const u = new URL(url.trim())
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
      } catch {
        return setError('URL 需要是 http(s) 地址')
      }
    }
    setBusy(true)
    const config =
      transport === 'stdio'
        ? {
            command: command.trim(),
            ...(lines(argsText).length > 0 ? { args: lines(argsText) } : {}),
            ...(lines(envText).length > 0 ? { env: kvPairs(envText) } : {})
          }
        : {
            url: url.trim(),
            ...(sse ? { sse: true } : {}),
            ...(lines(headersText).length > 0 ? { headers: kvPairs(headersText) } : {})
          }
    window.api.mcp
      .add({ name: trimmed, transport, config })
      .then((res) => onDone(res.ok ? undefined : (res.error ?? '添加失败')))
      .catch((e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>名称（工具名前缀，建议英文）</label>
          <input
            className={inputClass}
            value={name}
            placeholder="如 filesystem"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>传输方式</label>
          <div className="flex gap-2">
            {(['stdio', 'http'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={
                  'flex-1 rounded-lg border px-2 py-2 text-xs transition ' +
                  (transport === t
                    ? 'border-brand bg-brand/5 font-medium text-brand'
                    : 'border-black/10 bg-white text-ink-2 hover:border-black/20')
                }
              >
                {t === 'stdio' ? 'stdio（本地子进程）' : 'HTTP（远程服务）'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {transport === 'stdio' ? (
        <>
          <div>
            <label className={labelClass}>启动命令</label>
            <input
              className={inputClass}
              value={command}
              placeholder="如 node、npx 或 uvx"
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>参数（每行一个）</label>
            <textarea
              className={inputClass + ' h-16 resize-none font-mono'}
              value={argsText}
              placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\docs'}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>环境变量（可选，KEY=VALUE 每行一条）</label>
            <textarea
              className={inputClass + ' h-12 resize-none font-mono'}
              value={envText}
              placeholder="API_KEY=xxx"
              onChange={(e) => setEnvText(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelClass}>服务地址</label>
            <input
              className={inputClass}
              value={url}
              placeholder="http(s)://…/mcp 或 …/sse"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={sse}
              onChange={(e) => setSse(e.target.checked)}
              className="accent-brand"
            />
            SSE 传输（默认 Streamable HTTP；端点以 /sse 结尾时勾选）
          </label>
          <div>
            <label className={labelClass}>请求头（可选，KEY=VALUE 每行一条）</label>
            <textarea
              className={inputClass + ' h-12 resize-none font-mono'}
              value={headersText}
              placeholder="Authorization=Bearer xxx"
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onDone()}
          className="rounded-lg px-4 py-2 text-[13px] text-ink-2 hover:bg-black/5"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Spinner />} {busy ? '连接中…' : '添加并连接'}
        </button>
      </div>
    </div>
  )
}

/** 导入 mcp.json 弹窗 */
function ImportForm({
  onDone
}: {
  onDone: (msg?: string, error?: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    const parsed = parseMcpJson(text)
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    const failed: string[] = []
    for (const s of parsed.servers) {
      const res = await window.api.mcp
        .add({ name: s.name, transport: s.transport, config: s.config })
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      if (!res.ok) failed.push(`${s.name}（${res.error}）`)
    }
    const skippedNote = parsed.skipped.length ? `；跳过 ${parsed.skipped.join('、')}` : ''
    if (failed.length) {
      setBusy(false)
      setError(`部分条目失败：${failed.join('；')}${skippedNote}`)
    } else {
      onDone(`已导入 ${parsed.servers.length} 个服务器${skippedNote}`, undefined)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">
        粘贴 mcp.json 格式配置（Claude / Cursor / 魔搭详情页同构），支持一次导入多个服务器：
      </p>
      <textarea
        className={inputClass + ' h-44 resize-none font-mono text-xs'}
        value={text}
        placeholder={
          '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\\\docs"]\n    }\n  }\n}'
        }
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onDone()}
          className="rounded-lg px-4 py-2 text-[13px] text-ink-2 hover:bg-black/5"
        >
          取消
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !text.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Spinner />} {busy ? '导入中…' : '解析并导入'}
        </button>
      </div>
    </div>
  )
}

/** 魔搭访问令牌弹窗 */
function TokenForm({
  masked,
  onDone
}: {
  masked: string
  onDone: (msg?: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const save = (): void => {
    setBusy(true)
    window.api.mcpHub.setToken(value.trim()).then((res) => {
      setBusy(false)
      onDone(res.masked ? '魔搭令牌已保存（Hosted 服务可一键安装）' : '魔搭令牌已清除')
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">
        在 modelscope.cn「访问令牌」页创建（ms- 开头）。仅用于向魔搭接口领取您账号的 Hosted
        专属连接地址；本机加密存储，只发往 modelscope.cn。
      </p>
      <p className="text-xs text-ink-2">
        当前状态：{masked ? <span className="font-mono">{masked}</span> : '未配置'}
      </p>
      <input
        className={inputClass + ' font-mono'}
        value={value}
        placeholder={masked ? '输入新令牌以替换' : 'ms-xxxxxxxxxxxxxxxx'}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {masked && (
          <button
            onClick={() => {
              setValue('')
              window.api.mcpHub.setToken('').then(() => onDone('魔搭令牌已清除'))
            }}
            className="rounded-lg px-4 py-2 text-[13px] text-red-500 hover:bg-red-50"
          >
            清除
          </button>
        )}
        <button
          onClick={() => onDone()}
          className="rounded-lg px-4 py-2 text-[13px] text-ink-2 hover:bg-black/5"
        >
          取消
        </button>
        <button
          onClick={save}
          disabled={busy || !value.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          保存
        </button>
      </div>
    </div>
  )
}

/** 服务器配置摘要（已安装行副标题） */
function configSummary(s: McpServerStatus): string {
  const c = s.config as unknown as Record<string, unknown>
  if (s.transport === 'stdio') {
    const args = Array.isArray(c.args) ? (c.args as string[]).join(' ') : ''
    return `${String(c.command ?? '')} ${args}`.trim()
  }
  return String(c.url ?? '')
}

function marketUrl(item: McpHubItem): string {
  return `https://www.modelscope.cn/mcp/servers/${item.path}/${item.name}`
}

/** 详情页一行：左标签右值 */
function DetailRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-3 border-b border-black/5 py-2 text-[13px] last:border-0">
      <span className="w-16 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 break-all text-ink">{children}</span>
    </div>
  )
}

/** 外链按钮：交系统浏览器打开 */
function LinkOut({ url, label }: { url: string; label: string }): React.JSX.Element {
  return (
    <button
      onClick={() => void window.api.system.openExternal(url)}
      className="text-brand hover:underline"
    >
      {label}
    </button>
  )
}

/** 详情页分段标题 */
function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="border-t border-black/5 py-4 first:border-0 first:pt-0">
      <h3 className="mb-2.5 text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

/** 单个工具卡片：名 + 描述 + 参数表 */
function ToolCard({ t }: { t: McpToolDoc }): React.JSX.Element {
  const params = toolParams(t.inputSchema)
  return (
    <div className="rounded-lg border border-black/5 bg-canvas px-3 py-2.5">
      <div className="font-mono text-[13px] font-medium text-ink">{t.name}</div>
      {t.description && <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.description}</p>}
      {params.length > 0 && (
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1 pr-2 font-medium">参数</th>
              <th className="py-1 pr-2 font-medium">类型</th>
              <th className="py-1 pr-2 font-medium">必填</th>
              <th className="py-1 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-t border-black/5 align-top">
                <td className="py-1 pr-2 font-mono text-ink">{p.name}</td>
                <td className="py-1 pr-2 text-ink-2">{p.type}</td>
                <td className="py-1 pr-2">
                  {p.required ? (
                    <span className="text-red-500">必填</span>
                  ) : (
                    <span className="text-ink-3">可选</span>
                  )}
                </td>
                <td className="py-1 text-ink-2">
                  {p.description}
                  {p.default !== undefined && (
                    <span className="ml-1 text-ink-3">（默认 {p.default}）</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** 已安装服务器详情：概览头 + 功能特性 / 工具说明 / 使用示例 / 常见问题 / 注意事项 + 连接配置 */
function ServerDetail({ s }: { s: McpServerStatus }): React.JSX.Element {
  const c = s.config as unknown as Record<string, unknown>
  const args = Array.isArray(c.args) ? (c.args as string[]).join(' ') : ''
  const envKeys = c.env && typeof c.env === 'object' ? Object.keys(c.env as object) : []
  const headerKeys =
    c.headers && typeof c.headers === 'object' ? Object.keys(c.headers as object) : []
  const rm = parseReadme(s.readme ?? '')
  const docs = s.toolsDoc ?? []

  // 功能特性：优先 README 段，否则从工具清单派生
  const featureBullets = docs.filter((t) => t.description)
  // 使用示例兜底：启动命令 / 地址
  const launchCmd =
    s.transport === 'stdio' ? `${String(c.command ?? '')} ${args}`.trim() : String(c.url ?? '')

  return (
    <div className="max-h-[72vh] overflow-y-auto pr-1">
      {/* 概览头 */}
      <div className="mb-1 flex items-start gap-3">
        {s.iconUrl ? (
          <img
            src={s.iconUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-lg bg-canvas object-contain"
          />
        ) : (
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={s.status} />
            <span className="text-[11px] text-ink-3">{STATUS_TEXT[s.status]}</span>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] text-ink-2">
              {s.transport === 'stdio' ? '本地 stdio' : '远程 HTTP'}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            {s.description || rm.overview || '（暂无简介）'}
          </p>
        </div>
      </div>

      {/* 元数据条 */}
      <div className="my-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-3">
        {typeof s.callVolume === 'number' && <span>调用 {fmtCount(s.callVolume)}</span>}
        {typeof s.stars === 'number' && <span>收藏 {s.stars}</span>}
        {typeof s.viewCount === 'number' && <span>浏览 {fmtCount(s.viewCount)}</span>}
        {s.license && <span>许可 {s.license}</span>}
        {s.publisher && <span>发布方 {s.publisher}</span>}
        {typeof s.updatedAt === 'number' && (
          <span>更新 {new Date(s.updatedAt).toLocaleDateString()}</span>
        )}
      </div>
      {s.category && s.category.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {s.category.map((cat) => (
            <span key={cat} className="rounded bg-black/5 px-2 py-0.5 text-[11px] text-ink-2">
              {cat}
            </span>
          ))}
        </div>
      )}

      {/* 功能特性 */}
      {(rm.features || featureBullets.length > 0) && (
        <Section title="功能特性">
          {rm.features ? (
            <Markdown>{rm.features}</Markdown>
          ) : (
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
              {featureBullets.map((t) => (
                <li key={t.name} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  <span>
                    <span className="font-mono font-medium text-ink">{t.name}</span>
                    <span className="text-ink-2">：{t.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* 工具说明 */}
      <Section title="工具说明">
        {docs.length > 0 ? (
          <div className="space-y-2">
            {docs.map((t) => (
              <ToolCard key={t.name} t={t} />
            ))}
          </div>
        ) : s.status === 'connected' && s.tools.length > 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-2">
            当前已注册 {s.tools.length} 个工具：
            <span className="ml-1 font-mono text-xs">{s.tools.join('、')}</span>
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-3">
            暂无工具文档快照（手动添加或未抓取参数
            schema）。连接成功后，下方「连接配置」会列出运行时工具名。
          </p>
        )}
      </Section>

      {/* 使用示例 */}
      <Section title="使用示例">
        {rm.examples ? (
          <Markdown>{rm.examples}</Markdown>
        ) : (
          <>
            {launchCmd && (
              <pre className="mb-2 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-xs text-ink-2">
                {launchCmd}
              </pre>
            )}
            <p className="text-[13px] leading-relaxed text-ink-2">
              安装并连接后，直接在对话中描述你的需求，助手会在需要时自动调用该服务的工具（每次调用需你在批准面板确认）。
            </p>
          </>
        )}
      </Section>

      {/* 常见问题 */}
      <Section title="常见问题">
        <div className="space-y-2">
          {genericFaq().map((f) => (
            <div key={f.q} className="rounded-lg bg-canvas px-3 py-2">
              <div className="text-[13px] font-medium text-ink">{f.q}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-2">{f.a}</div>
            </div>
          ))}
          {rm.faq && <Markdown>{rm.faq}</Markdown>}
        </div>
      </Section>

      {/* 注意事项 */}
      <Section title="注意事项">
        {rm.notes && <Markdown>{rm.notes}</Markdown>}
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
          {genericNotes(s).map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* 连接配置 */}
      <Section title="连接配置">
        <div className="rounded-lg bg-canvas px-3">
          {!s.enabled && <DetailRow label="状态">已停用（不参与对话）</DetailRow>}
          {s.transport === 'stdio' ? (
            <>
              <DetailRow label="命令">
                <span className="font-mono text-xs">{launchCmd}</span>
              </DetailRow>
              {envKeys.length > 0 && (
                <DetailRow label="环境变量">
                  <span className="font-mono text-xs">{envKeys.join('、')}（值已隐藏）</span>
                </DetailRow>
              )}
            </>
          ) : (
            <>
              <DetailRow label="地址">
                <span className="font-mono text-xs">{String(c.url ?? '')}</span>
              </DetailRow>
              {headerKeys.length > 0 && (
                <DetailRow label="请求头">
                  <span className="font-mono text-xs">{headerKeys.join('、')}（值已隐藏）</span>
                </DetailRow>
              )}
            </>
          )}
          {s.status === 'error' && s.error && (
            <DetailRow label="错误">
              <span className="text-red-500">{s.error}</span>
            </DetailRow>
          )}
          <DetailRow label="内部名">
            <span className="font-mono text-xs">{s.name}</span>
          </DetailRow>
          <DetailRow label="安装于">{new Date(s.createdAt).toLocaleString()}</DetailRow>
          {s.hubId && (
            <DetailRow label="市场">
              <LinkOut
                url={`https://www.modelscope.cn/mcp/servers/${s.hubId}`}
                label="查看魔搭详情页"
              />
            </DetailRow>
          )}
          {s.sourceUrl && (
            <DetailRow label="主页">
              <LinkOut url={s.sourceUrl} label="打开项目主页" />
            </DetailRow>
          )}
        </div>
      </Section>
    </div>
  )
}

export function McpPage(): React.JSX.Element {
  const [view, setView] = useState<'discover' | 'installed'>('discover')

  // 已安装（实时状态由主进程连接池给出）
  const [installed, setInstalled] = useState<McpServerStatus[] | null>(null)
  const [installedNonce, setInstalledNonce] = useState(0)
  const [localQuery, setLocalQuery] = useState('')

  // 市场搜索（实时，不缓存）
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<McpHubItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hubError, setHubError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)

  const [installing, setInstalling] = useState<Record<string, boolean>>({})
  const [banner, setBanner] = useState('')
  const [modal, setModal] = useState<'' | 'add' | 'import' | 'token'>('')
  const [tokenMasked, setTokenMasked] = useState('')

  // 已安装行的运行时操作
  const [busyId, setBusyId] = useState('')
  const [confirmId, setConfirmId] = useState('')
  // 详情弹窗：按 id 引用已安装列表，重连/开关后弹窗内容保持实时
  const [detailId, setDetailId] = useState('')

  // 输入 350ms 后落到防抖关键词（setState 在 timeout 回调，合规）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword.trim()), 350)
    return () => clearTimeout(t)
  }, [keyword])

  // 已安装列表：每次需要刷新时经 nonce 触发
  useEffect(() => {
    let cancelled = false
    window.api.mcp
      .list()
      .then((list) => {
        if (!cancelled) setInstalled(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setBanner(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [installedNonce])

  // 令牌掩码：进页面拉一次
  useEffect(() => {
    window.api.mcpHub
      .getToken()
      .then(setTokenMasked)
      .catch(() => undefined)
  }, [])

  // 市场搜索：关键词/页码/重试触发；setState 全部在 promise 回调里
  useEffect(() => {
    let cancelled = false
    window.api.mcpHub
      .search({ keyword: debouncedKeyword, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.result) {
          const r = res.result
          setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]))
          setTotal(r.total)
          setHubError('')
        } else {
          setHubError(res.error ?? '魔搭接口暂不可用')
        }
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setHubError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword, page, retryNonce])

  const installedHubIds = useMemo(
    () => new Set((installed ?? []).map((s) => s.hubId).filter(Boolean) as string[]),
    [installed]
  )

  const filteredInstalled = useMemo(() => {
    const q = localQuery.trim().toLowerCase()
    if (!installed) return []
    if (!q) return installed
    return installed.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.displayName ?? '').toLowerCase().includes(q) ||
        configSummary(s).toLowerCase().includes(q)
    )
  }, [installed, localQuery])

  const onModalDone = (msg?: string, error?: string): void => {
    setModal('')
    if (msg) setBanner(msg)
    if (error) setBanner(error)
    setInstalledNonce((n) => n + 1)
  }

  const install = (item: McpHubItem): void => {
    setInstalling((prev) => ({ ...prev, [item.hubId]: true }))
    window.api.mcpHub
      .install({ path: item.path, name: item.name })
      .then((res) => {
        setInstalling((prev) => {
          const next = { ...prev }
          delete next[item.hubId]
          return next
        })
        if (res.ok) {
          setBanner(
            `已安装 ${(item.chineseName || item.name).slice(0, 24)}，去「已安装」查看连接状态`
          )
          setInstalledNonce((n) => n + 1)
        } else {
          setBanner(res.error ?? '安装失败')
        }
      })
      .catch((e: unknown) => {
        setInstalling((prev) => {
          const next = { ...prev }
          delete next[item.hubId]
          return next
        })
        setBanner(e instanceof Error ? e.message : String(e))
      })
  }

  const run = (id: string, fn: () => Promise<unknown>): void => {
    setBusyId(id)
    fn()
      .then((res) => {
        const r = res as { ok?: boolean; error?: string }
        if (r && r.ok === false) setBanner(r.error ?? '操作失败')
      })
      .catch((e: unknown) => setBanner(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusyId('')
        setInstalledNonce((n) => n + 1)
      })
  }

  const searchBox = (
    <div className="relative min-w-0 flex-1 max-w-md">
      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">
        <IconSearch />
      </span>
      <input
        className="w-full rounded-lg border border-black/10 bg-white py-2 pr-3 pl-9 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        value={view === 'discover' ? keyword : localQuery}
        placeholder={view === 'discover' ? '搜索魔搭 MCP 服务…' : '搜索已安装的服务器'}
        onChange={(e) => {
          if (view === 'discover') {
            setKeyword(e.target.value)
            setPage(1)
            setLoading(true)
          } else {
            setLocalQuery(e.target.value)
          }
        }}
      />
    </div>
  )

  const auxiliaryButtons = (
    <div className="flex shrink-0 items-center gap-2">
      <button className={chipBtn(tokenMasked !== '')} onClick={() => setModal('token')}>
        <IconKey /> {tokenMasked ? '魔搭 Token ✓' : '魔搭 Token'}
      </button>
      <button className={chipBtn()} onClick={() => setModal('import')}>
        <IconImport /> 导入配置
      </button>
    </div>
  )

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden px-8 py-6">
      {/* 顶栏：发现 = 标题+市场搜索；已安装 = 返回箭头+本地搜索 */}
      <div className="mb-4 flex items-center gap-3">
        {view === 'installed' ? (
          <button
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-2 transition hover:bg-black/5 hover:text-ink"
            onClick={() => setView('discover')}
          >
            <IconChevronLeft /> 全部服务器
          </button>
        ) : (
          <div className="shrink-0">
            <h1 className="text-xl font-bold text-ink">MCP 连接器</h1>
          </div>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          {searchBox}
          {auxiliaryButtons}
          {view === 'installed' ? (
            <button
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-white transition hover:opacity-90"
              onClick={() => setModal('add')}
            >
              <IconPlus /> 手动添加
            </button>
          ) : (
            <button className={chipBtn()} onClick={() => setView('installed')}>
              我安装的
              <span className="inline-flex items-center rounded-md bg-black/5 px-1.5 leading-none text-ink-3">
                {installed?.length ?? 0}
              </span>
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="min-w-0 truncate">{banner}</span>
          <button onClick={() => setBanner('')} className="ml-3 shrink-0 hover:text-amber-900">
            知道了
          </button>
        </div>
      )}

      {/* ---------- 发现（魔搭市场，实时）---------- */}
      {view === 'discover' && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
            <span>
              来自 ModelScope 魔搭 MCP 广场 · 实时获取 · 共 {total.toLocaleString()} 个服务
            </span>
            <a
              href="https://www.modelscope.cn/mcp"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              打开魔搭广场 ↗
            </a>
          </div>

          {hubError && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-500">
              <span>{hubError}</span>
              <button
                onClick={() => {
                  setLoading(true)
                  setHubError('')
                  setRetryNonce((n) => n + 1)
                }}
                className="ml-3 shrink-0 rounded px-2 py-0.5 font-medium hover:bg-red-100"
              >
                重试
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const isInstalled = installedHubIds.has(item.hubId)
              const busy = installing[item.hubId] === true
              const label = item.chineseName || item.name
              return (
                <div
                  key={item.hubId}
                  className="group flex cursor-pointer flex-col rounded-xl border border-black/8 bg-white p-4 shadow-sm transition hover:shadow"
                  onClick={() => window.open(marketUrl(item), '_blank')}
                  title={item.hubId}
                >
                  <div className="mb-1.5 flex items-start gap-2.5">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                      style={{ background: `hsl(${hueOf(item.hubId)} 62% 48%)` }}
                    >
                      {label.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold text-ink">
                          {label}
                        </span>
                        {item.hosted && (
                          <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">
                            托管
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-3">{item.hubId}</div>
                    </div>
                  </div>
                  <p className="mb-2 line-clamp-2 flex-1 text-xs leading-relaxed text-ink-2">
                    {item.description || '（暂无简介）'}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                    <span title="调用量">↓ {fmtCount(item.callVolume)}</span>
                    <span title="收藏">★ {item.stars}</span>
                    {item.category[0] && (
                      <span className="truncate rounded bg-black/5 px-1.5 py-0.5">
                        {item.category[0]}
                      </span>
                    )}
                    <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isInstalled ? (
                        <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
                          <IconCheck /> 已安装
                        </span>
                      ) : (
                        <button
                          onClick={() => install(item)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                        >
                          {busy ? <Spinner /> : <IconPlus />} {busy ? '安装中' : '安装'}
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {loading && items.length === 0 && (
            <p className="py-14 text-center text-sm text-ink-3">正在从魔搭获取…</p>
          )}
          {!loading && !hubError && items.length === 0 && (
            <p className="py-14 text-center text-sm text-ink-3">没有找到相关服务</p>
          )}

          {items.length < total && (
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setLoading(true)
                  setPage((p) => p + 1)
                }}
                disabled={loading}
                className="rounded-lg border border-black/10 bg-white px-5 py-2 text-xs text-ink-2 transition hover:border-black/25 hover:text-ink disabled:opacity-50"
              >
                {loading ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------- 已安装 ---------- */}
      {view === 'installed' && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {installed === null && <p className="py-10 text-center text-sm text-ink-3">加载中…</p>}
          {installed?.length === 0 && (
            <div className="rounded-xl border border-dashed border-black/15 py-16 text-center">
              <p className="text-sm text-ink-2">还没有接入任何 MCP 服务器</p>
              <p className="mt-1 text-xs text-ink-3">
                去发现页一键安装，或「导入配置」粘贴 mcp.json
              </p>
            </div>
          )}
          <div className="space-y-2">
            {filteredInstalled.map((s) => {
              const busy = busyId === s.id
              const confirming = confirmId === s.id
              return (
                <div
                  key={s.id}
                  className="group rounded-xl border border-black/8 bg-white px-4 py-3 shadow-sm transition hover:shadow"
                >
                  <div className="flex items-center gap-3">
                    <StatusDot status={s.status} />
                    <span className="text-sm font-semibold text-ink" title={s.name}>
                      {s.displayName || s.name}
                    </span>
                    {s.hubId && (
                      <span className="rounded bg-brand/8 px-1.5 py-0.5 text-[10px] text-brand">
                        魔搭
                      </span>
                    )}
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] text-ink-3">
                      {s.transport}
                      {s.transport === 'http' && (s.config as { sse?: boolean }).sse
                        ? ' · sse'
                        : ''}
                    </span>
                    <span className="text-xs text-ink-3">{STATUS_TEXT[s.status]}</span>
                    {s.status === 'connected' && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">
                        {s.tools.length} 个工具
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-ink-3">
                      {configSummary(s)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        title="查看详情"
                        onClick={() => setDetailId(s.id)}
                        className="rounded px-2 py-1 text-xs text-ink-3 hover:bg-black/5 hover:text-ink"
                      >
                        详情
                      </button>
                      <button
                        title="重连"
                        disabled={busy || !s.enabled}
                        onClick={() => run(s.id, () => window.api.mcp.reconnect(s.id))}
                        className="rounded p-1.5 text-ink-3 hover:bg-black/5 hover:text-ink disabled:opacity-30"
                      >
                        <IconRefresh />
                      </button>
                      <button
                        title={confirming ? '再次点击确认删除' : '删除'}
                        disabled={busy}
                        onClick={() => {
                          if (confirming) {
                            setConfirmId('')
                            run(s.id, () => window.api.mcp.remove(s.id))
                          } else {
                            setBanner('')
                            setConfirmId(s.id)
                          }
                        }}
                        className={
                          'rounded p-1.5 hover:bg-red-50 hover:text-red-500 ' +
                          (confirming
                            ? 'text-red-500'
                            : 'text-ink-3 opacity-0 group-hover:opacity-100')
                        }
                      >
                        <IconTrash />
                      </button>
                      <Toggle
                        on={s.enabled}
                        disabled={busy}
                        onChange={(v) => run(s.id, () => window.api.mcp.setEnabled(s.id, v))}
                      />
                    </div>
                  </div>
                  {confirming && (
                    <p className="mt-1.5 pl-5 text-xs text-red-500">
                      再点一次垃圾桶确认删除「{s.displayName || s.name}」（其工具将立即下架）
                    </p>
                  )}
                  {s.status === 'error' && s.error && (
                    <p className="mt-1.5 truncate pl-5 text-xs text-red-400" title={s.error}>
                      {s.error}
                    </p>
                  )}
                  {s.status === 'connected' && s.tools.length > 0 && (
                    <p
                      className="mt-1.5 truncate pl-5 font-mono text-[11px] text-ink-3"
                      title={s.tools.join('\n')}
                    >
                      {s.tools.join('、')}
                    </p>
                  )}
                </div>
              )
            })}
            {installed !== null && installed.length > 0 && filteredInstalled.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-3">没有匹配的已安装服务器</p>
            )}
          </div>
        </div>
      )}

      {/* ---------- 弹窗 ---------- */}
      {modal === 'add' && (
        <Modal title="手动添加 MCP 服务器" onClose={() => setModal('')}>
          <AddForm onDone={(error) => onModalDone(error ? undefined : '已添加服务器', error)} />
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="导入 mcp.json 配置" onClose={() => setModal('')}>
          <ImportForm onDone={(msg, error) => onModalDone(msg, error)} />
        </Modal>
      )}
      {modal === 'token' && (
        <Modal title="魔搭访问令牌" onClose={() => setModal('')}>
          <TokenForm
            masked={tokenMasked}
            onDone={(msg) => {
              setModal('')
              if (msg) setBanner(msg)
              window.api.mcpHub
                .getToken()
                .then(setTokenMasked)
                .catch(() => undefined)
            }}
          />
        </Modal>
      )}
      {detailId &&
        (() => {
          const s = (installed ?? []).find((x) => x.id === detailId)
          if (!s) return null
          return (
            <Modal title={s.displayName || s.name} onClose={() => setDetailId('')} wide>
              <ServerDetail s={s} />
            </Modal>
          )
        })()}
    </div>
  )
}
