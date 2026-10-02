# BlueBuddy

**本地优先的开源桌面智能体平台。** 用自然语言下达任务，授权一个工作目录，Agent 自主规划并执行——读写文件、运行命令、检索网络、加载技能、调用 MCP 工具——最终把可打开的成果交给你。

模型可接任意 OpenAI 兼容端点（云端 API / 企业内网网关 / 本地 Ollama），会话、消息、产物全部存在本机。

- 产品形态参考了 WorkBuddy 一类桌面工作台，**实现完全自研，不含任何第三方源码**
- 无遥测、无埋点，依赖清单可核（`package.json`）

---

## 它能做什么

| 能力            | 说明                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| 通用 Agent 对话 | 单层 ReAct 循环：流式正文 + 思考过程 + 工具调用卡片，过程可折叠回看                                         |
| 工作目录沙箱    | 写入严格锁在授权目录内；读取额外允许技能目录（只读可信根）；命令执行不拼 shell 字符串                       |
| 高危操作批准    | `run_command` 与全部 MCP 工具执行前申请批准；支持"本会话始终允许"与全局自动允许（需在设置页显式开启）       |
| 技能（Skills）  | `SKILL.md` 能力包：轻量索引进提示词，命中才加载正文（渐进式披露）；支持本地文件夹 / ZIP / SkillHub 市场安装 |
| MCP 连接器      | stdio / Streamable HTTP / SSE 三种传输；支持手动添加、`mcp.json` 批量导入、魔搭 ModelScope 市场安装         |
| 结果区          | 产物列表 + 工作区文件树懒加载浏览 + 文本预览                                                                |
| 外部应用集成    | 探测本机 IDE，一键"用 XX 打开当前工作目录"（含图标、可手动添加、可停用）                                    |
| 会话与任务      | 多会话并行（同一会话同时只跑一个 turn），历史与产物持久化，可重命名/删除                                    |
| 应用偏好        | 默认模型、默认工作目录、批准策略、默认 IDE、首启向导                                                        |
| 自动更新        | GitHub Releases 源，发现新版 → 用户确认 → 下载（带进度）→ 重启安装                                          |

## 安装

**安装包**：到 Releases 下载最新的 Windows NSIS 安装包（`bluebuddy-setup-x.y.z.exe`）。未做代码签名，首次运行会有 SmartScreen 提示，选择"仍要运行"即可。

**从源码运行**：

```bash
# 环境要求：Node.js LTS、pnpm、Windows 上编译 better-sqlite3 需要 VS Build Tools
pnpm install          # postinstall 会执行 electron-builder install-app-deps
pnpm dev              # 开发模式，弹出应用窗口（渲染层热更新；主进程改动需重启）

pnpm build:win        # 打 NSIS 安装包
```

**首次使用**：应用会弹出首启向导（欢迎 → 选工作目录 → 引导接入模型）。最小配置是一个 OpenAI 兼容端点：`baseUrl` + `model` + `apiKey`（本地 Ollama 形如 `http://localhost:11434/v1`，可留空 Key）。

## 架构

三进程模型，敏感能力只存在于主进程，渲染进程能碰到的能力**只有** preload 白名单里列出的那些。

```
主进程（Node 全权）
  agent/         runAgentTurn —— 纯逻辑 ReAct 循环（禁止 import electron）
  llm/           OpenAI 兼容流式网关 + SSE 增量解析（含 reasoning 内容）
  tools/         registry（zod 校验）+ 内置工具 + MCP 工具并入
  workspace/     WorkspaceProvider 抽象 + LocalWorkspace（沙箱、防挂死）
  skills/        SKILL.md loader / registry / 生命周期管理 / 市场客户端
  mcp/           连接池 / 魔搭市场 / 令牌加密
  permissions/   PermissionGate（批准桥）
  db/            better-sqlite3 + PRAGMA user_version 顺序迁移
  ipc.ts         通道注册、事件转发、并发控制、增量落库
preload          contextBridge 白名单（唯一渡船，nodeIntegration 关闭）
渲染进程          React 19 + Vite + Tailwind + zustand
```

两条架构命门——它们决定了这个项目能不能长成服务端版本：

1. **Agent 引擎是纯逻辑库**：所有对外依赖（LLM 调用、工具执行、批准回调、事件流）都由入参注入。`src/main/agent/engine-headless.spec.ts` 在**没有 Electron 的普通 Node 进程**里断言 `process.versions.electron === undefined` 并跑通一次完整任务，该用例已纳入测试门禁。
2. **一切文件/终端操作走 `WorkspaceProvider`**：内置工具只经 `ctx.workspace`，不碰 `node:fs` / `child_process`。新增 `RemoteWorkspace` 即可支持云端执行，工具代码零改动。

复核方式：`grep -R "from 'electron'" src/main` 应只出现在 4 个壳层文件（`index.ts` / `ipc.ts` / `settings.ts` / `updater.ts`）。

## 开发

```bash
pnpm typecheck   # tsc --noEmit（node + web 两套配置）
pnpm lint        # eslint，要求零告警
pnpm test        # vitest run
pnpm format      # prettier --write
```

提交前三项必须全绿。当前 **282** 个测试用例。测试环境是 `node`（无 jsdom），因此渲染层的逻辑一律把纯函数抽出来测（如 `turn-reducer.ts`、`scrollbar-reveal.ts`、`mcp-detail.ts`）。

规格与决策文档：

- [`docs/BlueBuddy-项目总结.md`](docs/BlueBuddy-项目总结.md) — 整体架构、设计思考、功能规划（**先读这份**）
- [`docs/adr/ADR-0001-技术选型与架构命门.md`](docs/adr/ADR-0001-技术选型与架构命门.md) — 选型论证
- [`docs/二期服务端化架构预留检查表.md`](docs/二期服务端化架构预留检查表.md) — 预留接缝逐项核对

## 路线图

**近期**

- 迭代上限（`maxIterations`，当前 6）做成应用偏好项
- 上下文用量可见 + 超长会话的裁剪/摘要策略
- 网关侧失败重试与"重试本轮"
- 技能选择诊断（给定任务看模型会不会选中它）

**二期**

- `RemoteWorkspace` 与服务端 Agent 运行
- 任务队列与产物两级管理（本机 + 云端）
- 私有 registry 分发（技能包 / MCP / 预设模板）
- 具名智能体降级为"预设"薄层

完整取舍与"明确不做"的清单见总结文档 §5、§10。

## 已知限制

诚实清单，避免误用：

- 单次 turn 最多 6 轮工具调用，撞上限后靠一次"不带工具"的收尾调用强行给结论——复杂任务可能提前收尾
- 引擎外没有再套循环，没有 planner/reflector，不会自动判定"目标是否达成"
- 模型能力限于文本 + 工具调用，无图像/音频输入输出
- 技能自动命中完全依赖模型的 function calling 与技能 `description` 的写作质量
- 长会话不做上下文压缩，token 随轮数线性增长
- 单用户、单机；无账号体系与协作
- OpenCode 这类不接受目录参数的外部应用，只能把工作目录登记进它的项目列表头部，仍需用户点一下

## 参与贡献

欢迎 Issue 与 PR。请先读 [`CONTRIBUTING.md`](CONTRIBUTING.md)——里面写明了门禁要求、提交规范和"改动前先看哪条边界"。

## 许可

[Apache License 2.0](LICENSE)。第三方依赖按其各自许可证分发，`pnpm-lock.yaml` 与 `node_modules` 内各自的 `LICENSE` 文件为准。
