import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import type { IdeApp } from '@shared/types'

/**
 * 外部应用（IDE）集成：探测本机已安装的 IDE，并用它打开某个文件夹。
 *
 * 设计约束：
 * - 只在主进程（壳层）使用；引擎保持零 Electron 依赖不受影响。
 * - detectIdes 是纯函数，接收注入探针（env / exists / readDir / which），
 *   以便在无 Electron、无真实安装环境下做单测。
 * - 启动只接受"绝对路径的 exe + 绝对路径的文件夹"，绝不拼 shell 命令字符串。
 */

/** 注入探针，令探测逻辑可脱离真实环境单测 */
export interface DetectProbes {
  env: Record<string, string | undefined>
  exists: (p: string) => boolean
  /** 列目录名（目录不存在时返回空数组） */
  readDir: (p: string) => string[]
  /** 在 PATH 里解析命令，返回可执行文件绝对路径或 null */
  which: (cmd: string) => string | null
}

/** 单个已知 IDE 的探测规格（Windows） */
interface IdeSpec {
  id: string
  name: string
  /** 候选安装目录：扫描其根目录下的 *.exe（排除卸载器），基名匹配 exeMatch 即命中 */
  dirs: string[]
  /** 主程序 exe 基名匹配（对去掉 .exe 后的名字做测试，不区分大小写）；仅 dirs 非空时需要 */
  exeMatch?: RegExp
  /** JetBrains 形态：扫描这些父目录下匹配名字的子目录，再进入其 bin\ 找可执行文件 */
  scan?: { dirs: string[]; match: RegExp; bins: string[] }
  /** PATH 上的 CLI 兜底（只认 .exe，避免 .cmd 无法直接 spawn） */
  clis: string[]
  /** 启动时附加参数（排在目录参数前）；如 opencode 需 --disable-gpu */
  launchArgs?: string[]
  /** true 时交给 explorer（ShellExecute）启动而非直接 spawn；用于被当子进程拉起会白屏的应用 */
  shellLaunch?: boolean
  /** 该应用存放"项目列表"的状态库路径模板；打开前把工作目录登记进去，使其出现在应用自己的项目列表里 */
  projectStateDb?: string
}

/** 卸载器/安装器/辅助程序基名特征，扫描安装目录时排除，避免误命中 */
const EXE_EXCLUDE = /^(unins|uninstall|setup|installer|crashpad|updater|elevation)/i

/** 已知 IDE 清单：主流 AI/代码编辑器 + JetBrains 系列 */
const CATALOG: IdeSpec[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    dirs: [
      '%ProgramFiles%\\Microsoft VS Code',
      '%ProgramFiles(x86)%\\Microsoft VS Code',
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code'
    ],
    exeMatch: /^code$/i,
    clis: ['code']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    dirs: ['%LOCALAPPDATA%\\Programs\\cursor', '%ProgramFiles%\\Cursor', '%ProgramFiles%\\cursor'],
    exeMatch: /^cursor$/i,
    clis: ['cursor']
  },
  {
    id: 'qoder',
    name: 'Qoder IDE',
    dirs: ['%ProgramFiles%\\Qoder IDE', '%ProgramFiles%\\Qoder', '%LOCALAPPDATA%\\Programs\\Qoder'],
    // 实际主程序常命名为 "Qoder IDE.exe"（带空格），也兼容 "Qoder.exe"
    exeMatch: /^qoder(\s+ide)?$/i,
    clis: ['qoder']
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    dirs: ['%LOCALAPPDATA%\\Programs\\@opencode-aidesktop'],
    exeMatch: /^opencode$/i,
    clis: ['opencode'],
    // 作为本应用子进程 spawn 时窗口不绘制（白屏），双击（ShellExecute）却正常；
    // 故交给 explorer 以 ShellExecute 启动，等价双击。此时不传目录参数。
    shellLaunch: true,
    // 它的项目选择页读自己 GUI 的状态库（不在 server 库里），打开前先把工作目录登记进去
    projectStateDb: '%APPDATA%\\ai.opencode.desktop\\drafts.sqlite'
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    dirs: ['%LOCALAPPDATA%\\Programs\\Windsurf', '%ProgramFiles%\\Windsurf'],
    exeMatch: /^windsurf$/i,
    clis: ['windsurf']
  },
  {
    id: 'trae',
    name: 'Trae',
    dirs: ['%LOCALAPPDATA%\\Programs\\Trae', '%ProgramFiles%\\Trae'],
    exeMatch: /^trae$/i,
    clis: ['trae']
  },
  {
    id: 'idea',
    name: 'IntelliJ IDEA',
    dirs: [],
    scan: {
      dirs: ['%ProgramFiles%\\JetBrains', '%ProgramFiles(x86)%\\JetBrains'],
      match: /^IntelliJ IDEA/i,
      bins: ['idea64.exe', 'idea.exe']
    },
    clis: ['idea', 'idea64']
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    dirs: [],
    scan: {
      dirs: ['%ProgramFiles%\\JetBrains', '%ProgramFiles(x86)%\\JetBrains'],
      match: /^PyCharm/i,
      bins: ['pycharm64.exe', 'pycharm.exe']
    },
    clis: ['pycharm']
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    dirs: [],
    scan: {
      dirs: ['%ProgramFiles%\\JetBrains', '%ProgramFiles(x86)%\\JetBrains'],
      match: /^WebStorm/i,
      bins: ['webstorm64.exe', 'webstorm.exe']
    },
    clis: ['webstorm']
  }
]

/** 展开 %VAR% 占位；环境变量名大小写不敏感（Windows 语义）。有未解析的变量则返回 null */
export function expandEnv(
  template: string,
  env: Record<string, string | undefined>
): string | null {
  let missing = false
  const out = template.replace(/%([^%]+)%/g, (_m, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
    const val = key ? env[key] : undefined
    if (!val) {
      missing = true
      return ''
    }
    return val
  })
  return missing ? null : out
}

/** 解析单个规格：扫描安装目录主 exe → JetBrains bin → CLI 兜底；返回首个命中的 exe 绝对路径 */
function resolveSpec(spec: IdeSpec, probes: DetectProbes): string | null {
  // 1. 扫描候选安装目录根下的主程序 exe（readDir 返回即视为存在）
  for (const dirTemplate of spec.dirs) {
    const dir = expandEnv(dirTemplate, probes.env)
    if (!dir) continue
    for (const entry of probes.readDir(dir)) {
      if (!/\.exe$/i.test(entry)) continue
      const base = entry.replace(/\.exe$/i, '')
      if (EXE_EXCLUDE.test(base)) continue
      if (!spec.exeMatch?.test(base)) continue
      return path.join(dir, entry)
    }
  }
  // 2. JetBrains 形态：父目录匹配子目录名，再进入其 bin\ 找可执行文件
  if (spec.scan) {
    for (const dirTemplate of spec.scan.dirs) {
      const base = expandEnv(dirTemplate, probes.env)
      if (!base) continue
      for (const name of probes.readDir(base)) {
        if (!spec.scan.match.test(name)) continue
        for (const bin of spec.scan.bins) {
          const cand = path.join(base, name, 'bin', bin)
          if (probes.exists(cand)) return cand
        }
      }
    }
  }
  // 3. PATH 上的 CLI 兜底
  for (const cli of spec.clis) {
    const w = probes.which(cli)
    if (w) return w
  }
  return null
}

/** 探测本机已安装的已知 IDE（纯函数，探针注入） */
export function detectIdes(probes: DetectProbes): IdeApp[] {
  const found: IdeApp[] = []
  for (const spec of CATALOG) {
    const exe = resolveSpec(spec, probes)
    if (exe)
      found.push({
        id: spec.id,
        name: spec.name,
        path: exe,
        source: 'auto',
        launchArgs: spec.launchArgs,
        shellLaunch: spec.shellLaunch,
        projectStateDb: spec.projectStateDb
          ? (expandEnv(spec.projectStateDb, probes.env) ?? undefined)
          : undefined
      })
  }
  return found
}

export interface OpenResult {
  ok: boolean
  error?: string
}

/** OpenCode GUI 状态库里 projects.local 的一项 */
interface OpenCodeProject {
  worktree: string
  expanded?: boolean
}

/** 统一目录写法：分隔符归一为反斜杠、去尾部分隔符（与 OpenCode 存量条目一致） */
function toWorktree(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '')
}

/**
 * 把工作目录登记进 OpenCode 桌面版的项目列表（其 GUI 状态库 drafts.sqlite 的 state 表）。
 *
 * 该列表是 GUI 私有状态，server 库（opencode.db）里的 project 表与它无关；GUI 按数组顺序渲染，
 * 故 unshift 到头部。幂等：已存在（容忍分隔符/大小写差异）则不动。
 * 全程 best-effort：库不存在、行缺失、JSON 变化、被 GUI 占用（SQLITE_BUSY）都吞下返回 false，
 * 不影响“打开应用”本身。注意：GUI 运行中时它可能用内存里的旧状态覆盖本行，此时登记不保证立即可见。
 */
export function registerOpenCodeProject(dbPath: string, folder: string): boolean {
  const STATE_NAME = 'opencode.global.dat'
  const STATE_KEY = 'server'
  try {
    const worktree = toWorktree(folder)
    // 必须已存在：Database 默认会创建空库，给未装 OpenCode 的机器凭空生文件
    if (!worktree || !existsSync(dbPath)) return false
    const db = new Database(dbPath)
    try {
      db.pragma('busy_timeout = 1500')
      const row = db
        .prepare('SELECT value FROM state WHERE name=? AND key=?')
        .get(STATE_NAME, STATE_KEY) as { value: string } | undefined
      if (!row) return false
      const state = JSON.parse(row.value) as { projects?: { local?: OpenCodeProject[] } }
      const list = state.projects?.local
      if (!Array.isArray(list)) return false
      const seen = (a: string, b: string): boolean =>
        toWorktree(a).toLowerCase() === toWorktree(b).toLowerCase()
      if (list.some((p) => typeof p?.worktree === 'string' && seen(p.worktree, worktree)))
        return false
      list.unshift({ worktree, expanded: true })
      db.prepare('UPDATE state SET value=?, updated_at=? WHERE name=? AND key=?').run(
        JSON.stringify(state),
        Date.now(),
        STATE_NAME,
        STATE_KEY
      )
      return true
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * 用指定 exe 打开文件夹：spawn(exe, [...launchArgs, folder], {detached, cwd=exe 所在目录}) 后即脱离。
 * 严格校验：exe 与 folder 都必须绝对路径，exe 必须真实存在；不拼 shell 字符串。
 * cwd 设为 exe 目录，等价于"从它自己文件夹里双击启动"。
 * opts.shellLaunch：不直接 spawn exe，改交 explorer（ShellExecute，等价双击）启动，用于被当子进程拉起会白屏的应用；此时不传目录参数。
 * opts.projectStateDb：配合 shellLaunch，启动前先把目录登记到该应用自己的项目列表（目前仅 OpenCode 配置）。
 */
export function openFolderInIde(
  exePath: string,
  folder: string,
  opts?: { launchArgs?: string[]; shellLaunch?: boolean; projectStateDb?: string }
): OpenResult {
  if (!path.isAbsolute(exePath)) return { ok: false, error: '可执行文件路径必须为绝对路径' }
  if (!existsSync(exePath)) return { ok: false, error: `找不到可执行文件：${exePath}` }
  if (!path.isAbsolute(folder)) return { ok: false, error: '文件夹路径必须为绝对路径' }
  try {
    // 清理父进程（本应用也是 Electron/Chromium）注入的环境变量，避免被子 Electron 应用继承：
    // CHROME_CRASHPAD_PIPE_NAME 会让子应用的崩溃处理指向本进程的 crashpad pipe；
    // ELECTRON_RUN_AS_NODE / NODE_OPTIONS / NODE_PATH 等也会干扰子应用启动。
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of [
      'CHROME_CRASHPAD_PIPE_NAME',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_ENABLE_LOGGING',
      'ELECTRON_ENABLE_STACK_DUMPING',
      'NODE_OPTIONS',
      'NODE_PATH'
    ])
      delete env[k]

    if (opts?.shellLaunch) {
      // 这类应用不接收目录参数，只能先登记进它自己的项目列表，用户点开即达（失败不阻断启动）
      if (opts.projectStateDb) registerOpenCodeProject(opts.projectStateDb, folder)
      // 交给 explorer 以 ShellExecute 启动（等价双击），避免作为本应用子进程时窗口不绘制；不传目录参数
      const child = spawn('explorer.exe', [exePath], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
        env
      })
      child.on('error', () => {
        /* 启动即忘 */
      })
      child.unref()
      return { ok: true }
    }

    // 附加参数（如 --disable-gpu）在前，目录作为位置参数在最后
    const child = spawn(exePath, [...(opts?.launchArgs ?? []), folder], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      cwd: path.dirname(exePath),
      // 关键：windowsHide 默认 true 会给子进程 STARTUPINFO 传 SW_HIDE，GUI 类应用（如 OpenCode）
      // 遵循后主窗口不显示/不绘制→白屏；置 false 让其正常显示窗口（等价于双击启动的 SW_SHOWNORMAL）。
      windowsHide: false,
      env
    })
    // detached + unref：启动失败（异步 error 事件）不影响主进程，这里吞掉避免未捕获异常
    child.on('error', () => {
      /* 启动即忘；上层已用 existsSync 预校验路径存在 */
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 真实环境探针：Windows 下在 PATH 里只解析 .exe（.cmd/.bat 无法直接 spawn） */
function whichExeOnPath(cmd: string, env: Record<string, string | undefined>): string | null {
  const pathVar = env.PATH ?? env.Path ?? env.path
  if (!pathVar) return null
  const alreadyExe = /\.exe$/i.test(cmd)
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue
    const candidates = alreadyExe ? [cmd] : [`${cmd}.exe`]
    for (const name of candidates) {
      const full = path.join(dir, name)
      try {
        if (existsSync(full)) return full
      } catch {
        /* 忽略非法路径 */
      }
    }
  }
  return null
}

/** 生产用探针集合（读真实 env 与文件系统） */
export function defaultProbes(): DetectProbes {
  return {
    env: process.env,
    exists: (p) => {
      try {
        return existsSync(p)
      } catch {
        return false
      }
    },
    readDir: (p) => {
      try {
        return readdirSync(p)
      } catch {
        return []
      }
    },
    which: (cmd) => whichExeOnPath(cmd, process.env)
  }
}
