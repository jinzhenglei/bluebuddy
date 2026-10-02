# BlueBuddy 项目全景总结

> 截至 2026-10-02 · 提交 `4055f98` · 版本 0.1.0
> 本文是三份材料的合流：**做了什么**（交付清单）、**为什么这样做**（架构与设计思考）、**接下来做什么**（功能规划）。
> 事实全部来自代码与提交历史，未写入未经核实的设想。数字口径：非测试源码 57 文件 / 10619 行，自动化测试 **282 例全绿**。

---

## 一、产品定位与双重目标

**一句话**：私有化部署的桌面级通用智能体平台——自然语言下达任务，授权一个本地工作目录，Agent 自主规划、调用工具执行，交付可打开的成果物。

对标腾讯 WorkBuddy 的形态，借鉴 Cherry Studio / OpenClaw 的思路，**完全自研、不抄代码**。

项目从一开始就是**双目标**：

1. 做出真能日常用的工具（不是 demo）；
2. 让作者完整掌握"用 vibe coding 开发严肃软件"的方法——每阶段结束应能独立讲出该阶段代码"为什么这样写"。

因此代码里大量注释写的是**动机与坑**而不是复述语法，测试覆盖的是**行为契约**而不是实现细节。这两件事共同保证了"学得住"。

**产品形态的关键判断（v2 修订）**：不做"用户先选一个预设智能体再对话"，而是 **一个通用 Agent 运行时 + 可安装技能库 + 运行时按任务自动选技能**。"具名智能体"降级为二期可选的"预设"。这个判断把复杂度从"编排一堆人设"转移到"给一个 Agent 扩充能力单元"，与 Claude Skills / WorkBuddy 的实践一致，也让数据模型至今不需要 `agent_id`。

---

## 二、交付总览

### 2.1 计划阶段（0–7 全部交付）

| 阶段 | 内容                                                                    | 验收要点                                         | 状态 |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------ | ---- |
| 0    | 工具链 + Electron 骨架 + 质量门禁                                       | `pnpm dev` 出窗口，能口述三进程                  | ✅   |
| 1    | 设置页 + LLM 网关流式对话                                               | 云端 API 与本地 Ollama 均流式通                  | ✅   |
| 2    | Agent 循环 + 内置工具 + 权限批准 + 会话持久化 + 工具卡片                | "列目录并总结"→卡片→批准→回填→答复               | ✅   |
| 3    | 技能运行时（L1）：SKILL.md loader + registry + 渐进式披露 + `use_skill` | 任务匹配时模型自动选技能→批准执行其脚本→结果回填 | ✅   |
| 4    | 技能管理（L2）：`skills` 表 + 管理页 + 本地/ZIP 导入 + IPC              | 导入并启用即生效，停用后从索引消失               | ✅   |
| 5    | MCP 客户端：`mcp_servers` 表 + stdio/HTTP/SSE + 管理页 + 工具并入       | 接入 filesystem server 可被模型调用              | ✅   |
| 6    | NSIS 打包 + 首启向导 + 二期架构预留检查表                               | 安装包在他机可装可跑，数据不出本机               | ✅   |
| 7    | 自动更新（electron-updater + 检查/下载/重启安装 UI）                    | 低版本测试包能发现新版→下载有进度→重启完成升级   | ✅   |

### 2.2 计划之外长出来的增强（阶段 5 之后）

产品"能不能给人用"往往取决于这些：

- **UI 全面重构（U1–U4）**：浅色主题 token、三栏工作台、侧边栏任务列表与搜索、首页（大标题 + 模式胶囊 + 场景卡片）、统一 Composer、Markdown 正文渲染、**过程组折叠**（把思考/工具/中间步骤收进一组，最终答复外露）+ turn 耗时显示、右侧**结果区**（产物 + 懒加载文件树 + 文本预览）、全局细滚动条。
- **应用偏好体系**：默认模型 / 默认工作目录 / 批准策略（ask·auto）/ 首启完成标记 / 默认 IDE；关于页与"清空本地数据"（两步确认）。
- **市场接入**：SkillHub 技能市场（搜索/分类/精选轮播/一键安装）+ 魔搭 ModelScope MCP 市场（实时搜索、Hosted 专属地址、README 与工具清单快照落库、`mcp.json` 批量导入）。
- **外部应用（IDE）集成**：本机 IDE 探测 + 真实图标 + 分体按钮"打开"入口（点图标直开、点箭头展开下拉）+ 任务行 `⋯` 菜单 + 设置页维护分组。
- **工程化补齐**：LF 统一、headless 架构回归用例、prettier/eslint/typecheck/vitest 全链路门禁。

### 2.3 当前质量基线

| 指标               | 数值                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| 非测试源码         | 57 文件 / 10,619 行                                                                            |
| 主进程             | 49 文件 / 7,832 行（含 20 个 spec）                                                            |
| 渲染层             | 29 文件 / 6,167 行（含 5 个 spec）                                                             |
| 共享类型 + preload | 4 文件 / 744 行                                                                                |
| 单测               | **282 passed**（`vitest run` exit 0）                                                          |
| 门禁               | typecheck(node/web) ✅ · eslint 零告警 ✅ · prettier ✅                                        |
| 运行环境           | Electron 39.8.10 / React 19.2 / TS 5.9 / Tailwind 4.3 / Vite 7.2 / better-sqlite3 13 / zod 4.6 |

---

## 三、整体架构

### 3.1 三进程模型与信任边界

```
┌─ 主进程（Node 全权，敏感能力唯一落点）──────────────────────────┐
│  index.ts   启动装配：SettingsStore / DbStore / PermissionGate   │
│             / ToolRegistry / SkillManager / McpManager → IPC     │
│  agent/     runAgentTurn —— 纯逻辑 ReAct 循环（零 Electron 依赖）│
│  llm/       gateway（OpenAI 兼容流式）+ sse（增量解析）          │
│  tools/     registry（zod 校验）+ builtin（fs/终端/web/use_skill）│
│  workspace/ WorkspaceProvider 抽象 + LocalWorkspace（沙箱）      │
│  skills/    loader / registry / manager / hub（SkillHub 市场）   │
│  mcp/       manager（连接池 + 工具映射）/ hub（魔搭）/ token     │
│  permissions/ PermissionGate（批准桥）                           │
│  db/        store（better-sqlite3 + user_version 迁移）          │
│  ipc.ts     通道注册、事件转发、并发控制、产物落库               │
│  apps.ts    IDE 探测与"打开文件夹"  updater.ts  自动更新         │
└──────────── preload：contextBridge 白名单（唯一渡船）────────────┘
                              ↕ invoke / send
┌─ 渲染进程（Chromium，无 Node 权限）─────────────────────────────┐
│ React 19 + Vite + Tailwind 4 + zustand                          │
│ pages: Home / Chat / Skills / Mcp / Settings                    │
│ components: Composer · ToolCallCard · ApprovalPanel · ResultPanel│
│             TaskOpenMenu · Onboarding · UpdateDialog · Markdown  │
│             scrollbar-reveal（全局滚动条显隐）                   │
│ stores: agent（turn 状态机）· settings · skills                  │
└─────────────────────────────────────────────────────────────────┘
```

**边界纪律**：`grep -R "from 'electron'" src/main` 只应出现 4 个壳层文件（`index.ts` / `ipc.ts` / `settings.ts` / `updater.ts`）。这条不是风格洁癖，它是二期服务端化的**唯一硬保证**——业务内核必须能被普通 Node 进程 import。

`nodeIntegration` 关闭、`contextIsolation` 开启，渲染层能碰到的能力**只有** `preload/index.ts` 里显式列出的那些方法；没列出的（直接读文件、执行命令、访问网络原始 socket）UI 层根本够不着。

### 3.2 两条命门（设计的地基）

计划阶段 2 就定下、至今逐条核对通过的两条抽象边界：

**命门①：Agent 引擎是纯逻辑库。**
`runAgentTurn(opts)` 只吃四个注入依赖——`llmCall`（LLM 调用）、`registry` + `toolCtx`（工具执行）、`requestApproval`（批准回调），只吐一个 `AsyncGenerator<AgentEvent>`。它不知道 Electron、不知道 SQLite、不知道 UI 存在。
**验证方式不是"我觉得解耦了"，而是 `engine-headless.spec.ts`**：在普通 Node 进程里断言 `process.versions.electron === undefined`，用脚本化假 LLM 驱动真实 `write_file` 落盘并产出 artifact。这个用例已进 test 门禁，防回归。

**命门②：一切文件/终端操作走 `WorkspaceProvider`。**
内置工具只经 `ctx.workspace`，不碰 `node:fs` / `child_process`。二期新增 `RemoteWorkspace` 时工具代码零改动。技能脚本执行同样落在这条抽象上——**技能不是特权通道**。

### 3.3 依赖方向（单向，无环）

```
renderer ──(IPC 类型契约)──> preload ──> ipc.ts（壳层）
                                           │ 只做装配/转发/落库
                                           ▼
                          engine ──> registry ──> builtin tools
                             │                        │
                             │                        ▼
                             │                 WorkspaceProvider
                             ▼                       （Local / 未来 Remote）
                        LlmCallFn <── gateway ── sse
                             ▲
                   PermissionGate（批准策略在上层，引擎只问 bool）
   共享：src/shared/types.ts + ipc.ts  ← 两侧 tsconfig 都 include，类型即契约
```

关键取舍：**引擎不 import 网关、不 import DB、不 import UI 事件名**。`"approval-required"` 这类带 `requestId` 的事件由 IPC 层拼装，因为 requestId 属于传输细节，放进引擎就会污染其纯净性（这一点写在 `engine.ts` 顶部注释里）。

### 3.4 一次对话的完整数据流

```
用户输入 ─▶ api.agent.send(sessionId, text)
          │
          ├─ ipc: 校验 session/provider；activeTurns 查重（同会话同时只允许 1 个 turn）
          ├─ ipc: 立即返回 { turnId }，turn 在后台异步跑（不阻塞 handler）
          ▼
   runAgentTurn 循环（≤ maxIterations=6）
     ├─ 拼喂给 LLM 的消息副本：剥 reasoning/createdAt + 前置 systemPrompt
     │    systemPrompt = 平台人设 + 技能轻量索引（name/description），现拼不入库
     ├─ gateway.streamChat → SSE 增量：delta / reasoning / tool-call-delta(按 index 聚合)
     ├─ 产出 text-delta · reasoning-delta ─────────────▶ ipc forward ─▶ renderer 流式渲染
     ├─ 无 tool_calls → turn-end 'stop' ✔
     └─ 有 tool_calls：逐个执行
          ├─ requiresApproval？→ PermissionGate.request（挂 Promise 等 UI）
          │     · autoApprove 或本会话"始终允许"命中 → 直接放行、不打扰用户
          │     · UI 回 PermissionReply(requestId, approved, alwaysAllow)
          │     · 拒绝 → 回填 "User rejected this tool call." 交给模型继续
          ├─ registry.call → zod 校验 → execute（经 LocalWorkspace 沙箱）
          ├─ 回填 role:'tool' 消息 + 产出 tool-result / artifact 事件
          └─ 进入下一轮，把新 messages 再喂模型
   每 yield 一次 → flushNewMessages() 增量落库（引擎原地 push，IPC 层记账补写）
   迭代用尽 → 收尾 pass（不带工具 + WRAP_UP_DIRECTIVE）保证总有一句结论
```

**为什么 handler 立即返回 turnId**：早期让 handler `await` 整个 turn，结果渲染层 busy 状态不生效，用户连点两次就把第二个请求拒成"another turn is in flight"。改成"发起即返回 + 事件流推进度"后，UI 状态与后端真实状态才同步。

---

## 四、模块清单

| 模块     | 关键文件                                               | 职责                                                                      | 设计要点                                                                                             |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 引擎     | `agent/engine.ts`                                      | 单层 ReAct 循环、tool-call delta 聚合、批准挂钩、收尾兜底                 | 全依赖注入；`maxIterations` 是参数不是常量硬编码在调用方                                             |
| LLM 网关 | `llm/gateway.ts` `llm/sse.ts`                          | OpenAI 兼容流式请求、SSE 帧解析、abort                                    | 一份代码同时吃云端 API 与 Ollama；`reasoning_content` 单独成事件                                     |
| 工具注册 | `tools/registry.ts` `tools/types.ts`                   | zod 参数校验、OpenAI spec 生成、统一错误转文本结果                        | `arguments` 是 JSON 字符串（协议地道约定）→ parse 后再校验；MCP 工具带 `parametersJsonSchema` 直透传 |
| 内置工具 | `tools/builtin/{filesystem,terminal,web,use_skill}.ts` | `read_file` `write_file` `list_dir` `run_command` `fetch_url` `use_skill` | `write_file` 产出 artifact；`run_command` 高危需批准；`use_skill` 无副作用不批准                     |
| 工作区   | `workspace/provider.ts` `local.ts` `browse.ts`         | 沙箱读写、exec、右侧只读浏览                                              | 写严格锁 root；读额外允许 `readRoots`（技能目录只读可信根）；exec 不拼命令串                         |
| 技能     | `skills/{loader,registry,manager,hub}.ts`              | SKILL.md 解析、轻量索引、磁盘×DB 生命周期、市场下载                       | "渐进式披露"两级；技能脚本无独立执行通道；`display_name` 与 slug 分离                                |
| MCP      | `mcp/{manager,hub,token}.ts`                           | stdio/HTTP/SSE 连接池、远端工具映射、魔搭市场、令牌加密                   | 远端工具一律 `requiresApproval=true`（服务器进程不受沙箱约束，故用批准补偿）                         |
| 权限     | `permissions/gate.ts`                                  | 把同步"要不要批准"桥接成可等待 UI 的异步流程                              | pending Map + sessionGrants + autoApprove；会话销毁/reload 必须清 pending                            |
| 存储     | `db/store.ts`                                          | 7 张表 + `PRAGMA user_version` 顺序迁移                                   | WAL + 外键 CASCADE；引擎与 UI 只见函数不见 SQL                                                       |
| 配置     | `settings.ts` `src/shared/types.ts(AppPrefs)`          | 模型接入配置（apiKey 加密）+ 应用偏好（settings_kv）                      | 渲染层拿到的 Key 永远是掩码；保存时识别掩码占位不回写                                                |
| IPC      | `ipc.ts` + `preload/index.ts` + `shared/ipc.ts`        | 通道注册、事件转发、并发表、产物与消息落库                                | 通道名集中在常量表，preload 是唯一能力白名单                                                         |
| 外部应用 | `apps.ts`                                              | IDE 探测、图标提取、打开文件夹、OpenCode 特殊处置                         | 探测扫安装目录 exe（不依赖 PATH）；`shellLaunch` 与 `projectStateDb` 两个扩展位                      |
| 更新     | `updater.ts`                                           | 检查/下载/安装，事件流化                                                  | `autoDownload=false`，用户确认才下载                                                                 |
| 渲染层   | `pages/*` `components/*` `stores/*`                    | 5 页 + 全局组件 + turn 状态机                                             | `turn-reducer.ts` 把事件流折叠成 UI 状态（纯函数、可单测）                                           |

---

## 五、核心设计决策与论证

选型不是"哪个流行"，而是"哪个能让我们把原理写明白、把二期路留对"。

| 决策点       | 结论                                                   | 理由 / 放弃项与代价                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面框架     | **Electron**                                           | Node 主进程天然拥有文件与进程能力，生态成熟。**放弃 Tauri**：Rust 门槛让"学会原理"这个目标失焦；**放弃纯 Web**：拿不到本地文件。代价：包体大、内存高、要自己管进程安全                                                                                        |
| Agent 循环   | **自研约 200 行核心循环**                              | 学习价值最高的一层；OpenAI `tool_calls` 是事实标准。**放弃 LangChain 类重框架**：会变成"调库但不懂原理"，且版本漂移会把调试时间吃掉。代价：要自己处理 delta 聚合、超时、中止                                                                                  |
| 技能选择机制 | **function calling + 渐进式披露 + `use_skill` 元工具** | 复用已验证的引擎，零新增路由基础设施；技能以 `{name, description}` 轻量索引进提示词，命中才加载正文，省 token。**放弃 MVP 就上 embedding 路由器**：多一套向量库与索引运维，收益在技能数上百前不可证。代价：技能描述写不好就选不中（靠 UI 引导作者写"何时用"） |
| 模型接入     | **OpenAI 兼容协议统一封装**                            | 云端 API 与本地 Ollama 都兼容，一套代码通吃。**放弃多 SDK 适配层**：每家的私有参数留成"以后再说"。代价：非标能力（如某些家的工具并行度控制）拿不到                                                                                                            |
| 存储         | **better-sqlite3**                                     | 会话/消息/技能/MCP 都是结构化查询，零运维、天然私有化、同步 API 简单。**放弃** JSON 文件（并发写与查询能力不足）与 Postgres（单机应用引入服务依赖）。代价：原生模块要 node-gyp，Windows 安装环境踩过坑                                                        |
| 权限模型     | **工作目录沙箱 + 高危批准 + 会话级"始终允许"**         | 对齐 WorkBuddy"高危指令拦截"，同时避免每次弹框的疲劳。全局 `autoApprove` 存在但必须由用户在设置页显式开启并持久化——**危险要留痕**                                                                                                                             |
| UI           | **React + TS + Tailwind**                              | 生态最大、AI 生成质量最稳。代价：布局纪律要靠约定维持（见 §6.13）                                                                                                                                                                                             |
| 数据不出机   | **无遥测依赖**（依赖清单可核）                         | 私有化定位的底线；更新源是唯一的对外请求（可关）                                                                                                                                                                                                              |
| 代码签名     | **不做**（个人分发接受 SmartScreen 提示）              | 证书成本与流程收益不匹配，商用阶段再评估                                                                                                                                                                                                                      |
| 打包 asar    | **关闭**                                               | 开 asar 时打包版"双击秒退"，better-sqlite3 的原生 dll 解包路径是关键因素；关包换可靠。代价：文件可见、体积略大                                                                                                                                                |

### 有意识的"不做"（边界比功能更能说明架构成熟度）

- 不做多用户/账号体系/云端运行（二期）；
- 不做具名智能体（降级为二期可选预设）；
- 不在引擎外面再套 loop（**本轮明确决定：先不加**，见 §11.1）；
- 不做 embedding 技能路由（技能量上百后作为优化引入）；
- 首期不做产物公司级集中管理。

---

## 六、关键机制详解（设计思考的落点）

### 6.1 Agent 引擎：单层 ReAct，四个出口

`for (iter = 0; iter < maxIterations; iter++)` 一次迭代 = 一次流式调用 + 顺序执行其 `tool_calls` + 结果回填。出口：`stop`（模型不再要工具）/ `aborted` / `error` / `max-iterations`。

三处非显然的设计：

1. **tool-call delta 按 `index` 聚合**（`agg.byIndex`）：流式下 `id`/`name` 只在首帧出现，`arguments` 分片累加；不按下标建槽位就无法还原并行工具调用。
2. **收尾 pass**：迭代耗尽而最后一条仍是工具结果时，追加一次**不给工具**的调用 + 一句"停止请求工具，直接给结论"的指令。否则会出现"技能调了、活干了，但没有结果输出"。这条指令只进喂给模型的副本，不入库。
3. **喂给模型的永远是副本**：`stripForLlm` 剥掉 `reasoning`（可回看但不回喂，省 token 且不干扰模型）与 `createdAt`；`systemPrompt` 现拼不持久化（技能索引会变，入库就逐轮重复）。

### 6.2 LLM 网关与 SSE

`sse.ts` 负责帧切分与 `[DONE]` 判定，`gateway.ts` 负责 `streamChat`（事件流）与 `chatOnce`（一次性，用于连通性测试与标题生成）。事件：`delta` / `reasoning` / `tool-call-delta` / `finish` / `done` / `error`。

要点：**思考内容与正文分离**——`reasoning_content` 透传给 UI 展示 + 落库可回看，但**不混进正文 content**。UI 因此能做"深度思考"折叠块，DB 迁移 v2 就是为它加的列。

### 6.3 工具系统

`ToolRegistry` 承担三件事：注册去重、把 zod schema 转成 OpenAI 的 `parameters` JSON Schema、把执行异常收敛成 `ok:false` 的文本结果（**绝不让工具抛异常打断整个 turn**）。

MCP 远端工具由 `McpManager` 包装成 `mcp_<server>_<tool>` 的本地工具，携带 `parametersJsonSchema` 直透传（参数校验交给 MCP 服务端），且**一律要求批准**——因为 MCP 服务器进程跑在用户全权下、不受 Workspace 沙箱约束，批准是唯一的补偿手段。

### 6.4 技能与渐进式披露

- `loader.ts` 解析 `SKILL.md` frontmatter（`name`/`description`/`requires-approval` 等）+ 正文 + 目录路径；
- `registry.ts` 只持有**轻量索引**（name + description），拼进系统提示词；
- `use_skill(name)` 是"第二级披露"：命中才把完整正文与技能目录交给模型，之后模型用 `read_file`/`run_command` 使用其脚本资源；
- `manager.ts` 协调"磁盘存在 × DB enabled"，只把可用技能放进 registry，并据此**上架/下架 `use_skill` 工具本身**（一个技能都没启用时，模型看不到这个工具）。

配套沙箱改动：技能目录注册为 **只读可信根**（`readRoots`），否则技能自带脚本会被沙箱拦掉（提交 `2725729`）。写入仍然严格锁在工作目录。

市场显示名与 frontmatter slug 分离存储（DB v4 的 `display_name`），中文真名进列表、slug 名留作 hover。

### 6.5 权限模型

`PermissionGate` 是**同步决策 → 异步等待**的桥：`request()` 返回一个只有 `reply()` 后才 settle 的 Promise。三层放行策略：`autoApprove`（全局）> `sessionGrants`（本会话该工具"始终允许"）> 弹批准卡。

生命周期清理是这里最容易出事的地方，四条规则都写成了代码与测试：

- `reply` 只在 `approved && alwaysAllow` 时才写 grants——**拒绝一次不等于永久拒绝**，下次仍应弹框；
- turn 取消 / 渲染进程 reload 或销毁 → `rejectPendingForSession`，否则循环永挂在批准上；
- 会话删除 → `clearSession`；
- "清空本地数据" → `clearAll`。

引擎侧还有一层兜底：`requestApproval` 未提供时**默认视为拒绝**（安全兜底方向永远是"不动"）。`approvalReason` 拿到的是 zod 校验前的原始 JSON，必须做类型容错——否则一个 `"a.join is not a function"` 会沿生成器冒泡，表现为"莫名错误 + 卡在执行中"。

### 6.6 工作区沙箱与防挂死

`LocalWorkspace` 的安全与稳健细节都来自真实故障：

- `isInside()` 用 `base + path.sep` 前缀比较，防"兄弟目录同名前缀"混淆（`/work/foo` 不该通过 `/work/foobar` 的检查）；
- `resolve()` 写路径严格锁 root，越界抛 `PathTraversalError`；`resolveForRead()` 才允许 `readRoots`；
- `exec` 用 `spawn(command, args, { cwd: root, shell: false })`，**绝不拼接命令字符串**（无 shell 注入面）；
- **立即 `child.stdin.end()`**：不关的话交互式命令（如 Windows 的 `date`）会死等输入而永久挂起；
- 默认 60s 超时 + `AbortSignal` 强杀（SIGKILL + `finish(-1)`），且 `settled` 标志保证 Promise 只 settle 一次、监听器成组清理。

### 6.7 会话与并发

`activeTurns: Map<sessionId, {turnId, controller}>`——**同一会话同时只允许一个 turn，不同会话可并行**（这就是"多任务"的全部实现，代价极小）。

三处防御：删除会话时先 abort 再清 gate；`event.sender.once('destroyed')` 时 abort + 撤 pending（否则 reload 之后所有发送都被拒为"in flight"）；`finally` 里删表项并摘监听。

落盘用 `flushNewMessages()` 记账式增量写：引擎原地 push 数组，IPC 层每次 yield 后把 `[dbCount, length)` 补写进库——避免让引擎承担持久化职责。

### 6.8 持久化与迁移

`PRAGMA user_version` + 顺序 upgrade 分支，**永不改老迁移脚本**：

| 版本 | 内容                                                                               |
| ---- | ---------------------------------------------------------------------------------- |
| v1   | `sessions` / `messages` / `artifacts`（+ 索引、FK CASCADE、WAL）                   |
| v2   | `messages.reasoning` 列（思考过程可回看）                                          |
| v3   | `skills` 表（name PK / dir / enabled / created_at）                                |
| v4   | `skills.display_name`                                                              |
| v5   | `mcp_servers` 表                                                                   |
| v6   | MCP 市场字段（display_name / hub_id）+ `settings_kv` 通用 KV                       |
| v7   | MCP 市场元数据快照（description / category / source_url / readme / tools_doc / …） |

迁移有专门测试（DB 迁移版本升级 / 兼容性用例），因为"老用户升级后库打不开"是唯一致命的线上事故。

### 6.9 敏感信息

模型 `apiKey` 与魔搭令牌都经 Electron `safeStorage`（OS 钥匙串级）加密后落文件/`settings_kv`；**渲染进程拿到的永远是掩码**（`sk-****abcd`）。保存时还要识别"用户没改 Key 输入框、只是把掩码回传"的情况，不能把掩码当真 Key 写进去。

### 6.10 市场接入的两条不同策略

- **SkillHub（技能）**：搜索 + ZIP 下载（magic number 与体积双闸）+ 解压时防 zip-slip、条目/体积上限、支持根目录或嵌套一层 `SKILL.md`；本地文件夹导入与 ZIP 导入**共用同一条安装链**。
- **魔搭 MCP（连接器）**：搜索**实时拉取不落库**（避免陈旧目录），安装时才把详情、README、工具清单**快照进库**（详情页离线可用）；Hosted 专属地址需要登录令牌，故单独加密存储。契约实测：列表/搜索是 `PUT /api/v1/dolphin/mcpServers`（不是 GET），字段名 `McpServer.TotalCount/McpServers[]`；分类筛选项未公开、实测无效，因此 UI 上只作展示。

### 6.11 外部应用（IDE）集成

探测：**扫描各 IDE 安装目录下的 exe**，而不是查 PATH——因为存在带空格的路径与"exe 名 ≠ 产品名"的异名情况，PATH 方案检不到（提交 `849d2cb`）。图标用 `app.getFileIcon` 提真实 exe 图标转 dataURL（不用手绘图标冒充）。

**OpenCode 白屏**是本项目最硬的一次排错（7 个提交）。它的桌面版本身是 Electron，被我们以子进程方式 spawn 时，会继承 Electron 注入的环境变量并被视为子进程 → 嵌套 GPU 合成/遮罩导致白屏。尝试链：`cwd` 设 exe 目录（无效）→ 清环境变量（无效）→ `windowsHide:false`（无效）→ `--disable-gpu`（无效）→ 加后台启动标志（仍偶发）。**终解：不 spawn，改交给 `explorer`（ShellExecute，等价用户双击）启动**，并把这条能力做成 `IdeSpec.shellLaunch` 通用开关——不为某个应用写死。

顺带解决了"打不开指定目录"：OpenCode 不接受目录位置参数。定位过程先误判了数据源（以为在 server 库的 `project`/`project_directory`/`kv` 表，又以为"有会话的目录会自动出现在列表"，都实测证伪），最终用**备份 → 手工加一项 → diff** 的前后对照实验定位到 GUI 私有库 `%APPDATA%\ai.opencode.desktop\drafts.sqlite` 的 `state` 表（`name='opencode.global.dat' AND key='server'`）里 `projects.local` 数组——GUI 按数组顺序渲染，于是 `registerOpenCodeProject()` 做**幂等 + 大小写/分隔符归一 + 插到头部**的登记，失败也不阻断启动（best-effort）。它仍没有"带目录直接启动"的入口，所以用户仍需点一下。

> 沉淀出的通用原则：直写第三方应用私有数据库风险高（版本一变即失效），优先用官方 CLI/API；确需直写则遵循"先关进程、先读后改、幂等写入、异常静默降级"。（注：`drafts.sqlite` 被运行中的 GUI 锁着，读写前必须关 GUI——BlueBuddy 的实现在 GUI 未启动时写、启动时读，天然避开冲突。）

### 6.12 自动更新

`electron-updater`，`autoDownload=false`：发现新版 → UI 询问 → 下载（带进度事件）→ 就绪后重启安装。事件流化成一串 `phase`（checking/not-available/available/progress/downloaded/error），只推给发起检查的那个渲染进程。更新源默认 GitHub Releases，用 `BB_UPDATE_FEED_URL` 可指向本地 feed 做测试（避免为了测更新去污染真实仓库）。发布流程 = 升版本号 → `build:win` → 上传 exe + `latest.yml`。

### 6.13 UI 体系与布局纪律

- **配色**：浅色主题 token + 黑色动作色，风格对标 WorkBuddy；连接器页与技能页的同类按钮保持配色形态一致。
- **叙事纪律**：系统提示词要求"调用工具前先说一句要做什么、为什么；拿到结果先给结论再展开"，配合"过程组折叠"让长任务可读。
- **滚动纪律**：侧边栏与顶栏**禁止参与页面滚动**（各自独立滚动容器）；设置页根容器必须是 `h-full overflow-y-auto` 的唯一滚动者——否则内容撑破主区域会带动整窗滚动。
- **滚动条显隐**：最终形态是 macOS 悬浮式，但**实现方式改过一次**。原本用 `:hover::-webkit-scrollbar-thumb` 纯 CSS 技巧，暴露了缺陷：指针移出滚动容器、停在父层留白（侧栏 `px-3` 那 12px）时 Chromium 仍保持滑块显形，"该隐不隐"。改为 `scrollbar-reveal.ts` 自己做几何判定：`elementFromPoint` 向上找"该方向确实溢出"的最近容器 + `getBoundingClientRect` 命中判定 → 加/摘 `.sb-hot` 类驱动显形；边界含滚动条带本身（保证抓得住滑块）、拖动期间不摘类、指针离开窗口立刻收、滚动停止 700ms 自动收起。判定函数（`isScrollerLike` / `inBox`）抽成无 DOM 依赖，可在 node 环境单测。

> 一次**重要的排错教训**：滚动条改动"看起来没生效"，真因是当时运行的是 **10-01 上午的旧安装包**（其打包 CSS 里 `-webkit-scrollbar` 命中 0 次），不是代码问题。排查手法：`Get-Process` 看进程**启动路径与时间** → 对比安装目录内产物与源码提交时间 → 必要时重跑 `electron-vite build` 验证构建管线是否吃掉了规则（结论：Tailwind v4 / Lightning CSS 不吃）。

---

## 七、IPC 契约全景

通道名集中在 `src/shared/ipc.ts`，preload 是唯一白名单实现，类型即契约。

| 组         | 方法                                                  | 说明                                    |
| ---------- | ----------------------------------------------------- | --------------------------------------- |
| settings   | list / upsert / remove / test                         | apiKey 只回掩码                         |
| llm        | start / cancel / onEvent                              | 阶段 1 的纯对话流（仍保留）             |
| sessions   | list / create / rename / delete                       | delete 会先 abort 活跃 turn             |
| messages   | list                                                  | 含 reasoning，供回看                    |
| artifacts  | list / delete                                         | file 类带 `absPath`                     |
| workspace  | listDir / readFile                                    | 右侧结果区只读浏览，限本会话 workDir    |
| agent      | send / cancel / onEvent                               | send 立即回 turnId；事件流承载 6 类事件 |
| permission | reply(requestId, approved, alwaysAllow)               | 批准回传                                |
| skills     | list / setEnabled / remove / import                   | import 按路径自动分派文件夹/ZIP         |
| hub        | search / install                                      | SkillHub 市场                           |
| mcp        | list / add / setEnabled / remove / reconnect          | list 带运行时状态与已注册工具名         |
| mcpHub     | search / install / getToken / setToken                | 魔搭市场 + 令牌                         |
| prefs      | get / set / appInfo / wipe                            | wipe 需渲染层两步确认                   |
| updater    | check / download / install / onEvent                  | 见 §6.12                                |
| system     | pickDirectory / pickZipFile / openPath / openExternal | openExternal 主进程侧限 http/https      |
| apps       | list / addCustom / remove / setEnabled / openFolder   | list 带 `enabled/removable/icon`        |

**外链安全**：`setWindowOpenHandler` 一律转系统浏览器并 deny；`will-navigate` 拦截非应用来源的 http(s) 链接——否则 Markdown 正文里的普通链接会把应用窗口整个导航走。

---

## 八、质量工程

**三门禁全绿才允许提交**（顺序固定）：

```
prettier --write .                                  # 格式化（改到的文件回读确认）
tsc --noEmit -p tsconfig.node.json --composite false
tsc --noEmit -p tsconfig.web.json  --composite false
eslint --cache .                                    # 警告也必须清零
vitest run                                          # 282 passed, exit 0
```

**提交纪律**：Conventional Commits（中文正文写清动机与取舍）；**按路径选择性 `git add`**（绝不 `git add .`，避免把共享工作区里别人的改动或生成目录一起卷进来）；`.kb/`、`docs/wiki/`、`plugins/repo-wiki/` 这类生成物不纳入跟踪。

**测试策略**（`vitest.config.ts` 环境是 `node`，无 jsdom）：

- **架构回归**：`engine-headless.spec.ts` 断言无 Electron 环境也能跑通一次任务——命门①的自动化守卫；
- **纯逻辑优先**：引擎 15+ 例（含批准、异常、abort、收尾）；`turn-reducer` / `mcp-detail` / `mcp-import` / `tool-display` / `scrollbar-reveal` 等渲染层逻辑一律把**纯函数抽出来测**，绕开 DOM；
- **数据层**：DB 迁移与级联行为、`apps.spec.ts`（含 `registerOpenCodeProject` 的幂等/归一/缺库不抛）；
- **就近放置**：spec 与源文件同目录，改名/删除时不会漏。

**协作节奏（vibe coding 工作法）**：先讲再写 → 小步提交 → 每阶段验收 + 抽查代码解释 → 重要选型写 ADR → 审查 AI 代码三板斧（看 diff、跑起来、追问"输入是 XX 会怎样"）。

---

## 九、已知边界与踩坑清单

### 9.1 功能边界（现状就是如此，不是 bug）

| 项              | 现状                                                                               | 影响                                                                                      |
| --------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Agent 循环层数  | **只有一层 ReAct，外面没有 loop**；无 planner/reflector、无"未达成就重跑整轮"      | 复杂任务一旦超出 6 轮就靠收尾 pass 强给结论，深度受限（已决定**先不加**外循环，见 §10.1） |
| `maxIterations` | 引擎默认 **6**，IPC 调用处未传，**UI 无设置项**                                    | 撞上限的真实体感是"做到一半就下结论"                                                      |
| 技能自动选择    | 完全依赖模型 function calling + description 质量                                   | 描述写得差就选不中；无兜底路由器                                                          |
| 模型能力        | OpenAI 兼容文本 + 工具调用；无图像输入/输出、无音频                                | "多模态办公任务"目前只做文档/表格/代码类                                                  |
| 上下文管理      | 全量 messages 回喂（仅剥 reasoning/createdAt），无摘要压缩                         | 长会话 token 线性增长，可能超窗口                                                         |
| 工作区          | 仅 LocalWorkspace；无远程/容器工作区                                               | 二期增量                                                                                  |
| OpenCode 集成   | 目录只能登记进其项目列表**头部**，仍需用户点一下；GUI 运行中时可能被内存旧状态覆盖 | 该应用做不到"一键带目录打开"，其他 IDE 可以                                               |
| 代码签名        | 无                                                                                 | 首次下载有 SmartScreen 提示                                                               |
| 平台            | Windows 为主（mac/linux 脚本留着未验）                                             | —                                                                                         |
| 可观测性        | 无应用日志文件、无崩溃收集（刻意不做，隐私优先）                                   | 现场排错要靠 DevTools                                                                     |

### 9.2 踩过的坑（按类别留档，避免二次掉坑）

**Electron / 进程**

- `windowsHide` 默认值导致 GUI 子应用白屏；清环境变量、`--disable-gpu`、改 cwd 都**没治好**，终解是 ShellExecute（`explorer`）启动；
- 判定"是不是陈旧编译产物"要看产物内容命中数，不能只看时间戳；
- asar 开启 → 打包版双击秒退；
- IPC 里主进程 `await` 渲染进程回应 → 死锁/永挂（批准流程必须可被 cancel/destroy 解开）；
- `preload` 的 `onEvent` 必须返回取消订阅函数，组件卸载时调用，否则监听器累积、事件重复处理。

**工具执行**

- 不关 stdin → 交互式命令（Windows `date`）永久挂起；
- `approvalReason` 收到的是校验前的原始 JSON，不做类型容错会让异常冒泡打断整个 turn；
- 工具抛异常必须收敛成 `ok:false` 文本，否则生成器中断、UI 卡在"执行中"。

**前端**

- 纯 CSS `:hover::-webkit-scrollbar-thumb` 命中范围不可控 → 改 JS 几何判定；
- 侧边栏/设置页滚动容器写错 → 带动整窗滚动；flex 行垂直错位多是 `align-items` 退化而非字号问题；
- zustand selector 返回新对象引用 → 无限重渲染；`useEffect` 里同步 `setState` 造成回环；
- 喂回 LLM 前不剥 `reasoning`/`createdAt` → 白烧 token 且干扰模型。

**环境与工具链**

- pnpm `--ignore-scripts` 会让 `dev` 的 `electron.exe` 二进制丢失；better-sqlite3 需 VS 构建环境，`postinstall` 必须跑 `electron-builder install-app-deps`；
- Windows 中文路径 + Defender 会造成假性失败与慢启动；CRLF/LF 混用靠 `.gitattributes` 统一 LF；
- PowerShell 里 `&&` 不可用（用 `;`）；`curl` 是别名要用 `curl.exe`；调 CLI 传 JSON 会被引号解析吃掉（用文件或 `--param k=v`）；
- vitest 结果经管道时 ExitCode 有假象，要重定向后读 `$LASTEXITCODE`。

**第三方集成方法论**

- 直写别人私有库前，先用**备份 → 手工操作一次 → diff** 定位真源；本项目四次证伪（server 库 project/project_directory/kv 表、`POST /api/session` 建会话、Chromium Local Storage/leveldb、deep link 与位置参数）才找到 `drafts.sqlite`；
- 找不到官方写接口时，宁可在 UI 上少一步自动化，也不要伪造状态；
- 优先官方 CLI 的稳定接口（如 `opencode-cli api session.remove --param sessionID=...`，还能避开引号问题）。

---

## 十、功能规划

优先级判据：**用户每天碰得到的 > 深度能力 > 锦上添花**。规模控制在"一次能看完"，超了就拆。

### 10.1 近期（P0–P1，桌面形态内做深）

| 优先级 | 项                                        | 动机                                               | 做法（含接缝）                                                                                                                                                  | 验收                                                        |
| ------ | ----------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P0     | **迭代上限可配置**                        | 6 轮对"读代码→改→跑→修"偏紧，撞上限只能靠收尾 pass | `AppPrefs.maxIterations`（默认仍 6，上限如 20）→ `ipc.AgentSend` 传入引擎；设置页"权限与安全"组加滑条                                                           | 改完即生效、重启保持；单测覆盖"传 1 时确实只跑 1 轮 + 收尾" |
| P0     | **上下文用量可见 + 裁剪策略**             | 长会话 token 线性涨，撞窗口后行为不可预期          | 先做"可见"（估算字符/轮数显示在 Composer 状态区），再做"裁剪"：保留 system + 最近 N 轮 + 更早摘要为一条 system 注记                                             | 长会话不崩、可复现的截断行为；纯函数单测                    |
| P1     | **外循环 + 预算护栏**（**当前明确暂缓**） | 复杂任务需要"目标未达成自动续跑"                   | 不无脑重跑 turn：先在 `turn-end` 处判定"是否有未完成事项"（模型自评 + 待办清单工具），续跑要有**三重预算**——累计轮数 / token / 墙钟时间，任一触顶即停并交代现状 | 判停单测 + 人工长任务实测                                   |
| P1     | **技能选择质量**                          | description 差则选不中                             | 技能页加"试跑"（给定任务看模型会不会选它、命中了什么）；索引拼装加去重与长度上限                                                                                | 一次可见的诊断输出                                          |
| P1     | **失败可恢复**                            | 网络抖动/429 目前直接 `turn-end=error`             | 网关侧指数退避重试（仅幂等请求）；UI 保留"重试本轮"入口（重放同一 userText）                                                                                    | 断网注入用例：重试成功 / 超限后退化为错误提示               |
| P2     | 结构化待办工具（`todo` 内置工具）         | 外循环与过程可视化的共同前置                       | 产出 `todos` 表 + 工具，Chat 侧渲染进度条                                                                                                                       | 与 P1 外循环配套验收                                        |
| P2     | 结果区增强                                | 交付体验                                           | 预览支持 HTML/PDF/图片；产物一键"复制到新任务"                                                                                                                  | 手工验收                                                    |
| P2     | 国际化 / 无障碍 / 键盘全操作              | 分发面扩大后再做                                   | i18n 资源抽层（文案量大，需专门一轮）                                                                                                                           | —                                                           |
| P2     | 代码签名证书评估                          | 消除 SmartScreen                                   | 商用阶段决定                                                                                                                                                    | —                                                           |

### 10.2 二期：服务端化与团队协作（预留已核对，见检查表）

架构预留结论（`docs/二期服务端化架构预留检查表.md`）：**12 项 ✅ / 0 项 ⚠️ / 3 项 ❌**，两条命门与六条依赖注入接缝全部到位。二期主要工作是"换实现 + 加表列"，不动引擎内核与工具代码。

| 目标                                              | 落地路径                                                                                              | 已具备 / 增量                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| 远程工作区                                        | 新增 `RemoteWorkspace implements WorkspaceProvider`                                                   | ✅ 已预留；工具代码零改动         |
| 服务端跑 Agent                                    | Node 服务直接 `import { runAgentTurn }`（headless 用例已证明可行）                                    | ✅ 已预留                         |
| 产物两级管理（本机 + 云端）                       | `artifacts` 加 `remote_uri` 列                                                                        | ❌ 走 `user_version` 迁移，低风险 |
| 任务队列 / 本地+云端多任务                        | 新增 `tasks` 表/视图，以现有 sessions/messages 为本地任务基座                                         | ❌ 二期增量                       |
| 多用户 / 账号 / 模型网关                          | 独立服务侧                                                                                            | ❌ 计划内"首期不做"，非遗漏       |
| 私有 registry 分发（技能包 / MCP / 预设模板下发） | 复用现有 hub client 抽象，把 URL 指向私有源                                                           | ⚠️ 客户端已有，缺服务端与签名校验 |
| 具名智能体（降级为预设）                          | 在通用 Agent 之上加"system prompt + 预置启用技能集"的薄层，**不引入 `agent_id` 外键**（改用会话快照） | ⚠️ 数据模型刻意为此留了空间       |
| embedding 技能路由                                | 技能数上百后引入向量索引 + 召回，替换"全量轻量索引进提示词"                                           | ⚠️ 当前方案的显式替代点           |

### 10.3 明确不做 / 已决定暂缓

- **不在引擎外加 loop**（本轮结论：先只考虑把上限做成可配置，等真出现"经常干一半就停"再上外循环）；
- 不做插件沙箱化运行（技能 = 指令 + 脚本，脚本走批准，不另造扩展机制）；
- 不做崩溃遥测（与"数据不出本机"直接冲突）；
- 不做 Web 版（本地文件能力是产品前提）。

### 10.4 交付节奏建议

1. 先做 **P0 两项**（上限可配 + 上下文可见）：改动小、体感强，且为后续一切"深度能力"提供度量底座；
2. 接着做 **P1 失败可恢复 + 技能试跑**：先把"能用"变稳，再谈"更强"；
3. **外循环 + todo 工具**捆绑成一个阶段做，因为二者互为前提，单独上任一个都没有可验收的效果；
4. 二期服务端化另立计划，桌面版每加一能力就同步更新检查表（`grep -R "from 'electron'" src/main` + headless 用例是它的回归网）。

---

## 十一、附录

### 11.1 命令速查

```powershell
pnpm install                 # postinstall 会跑 electron-builder install-app-deps（原生模块必需）
pnpm dev                     # electron-vite dev（渲染层热更新即时生效；主进程改动需重启）
pnpm build                   # typecheck + electron-vite build
pnpm build:win               # 打 NSIS 安装包（当前关闭 asar）
pnpm start                   # 预览构建产物
pnpm test                    # vitest run（三门禁之一）
pnpm typecheck ; pnpm lint   # 另两个门禁（lint 要求零告警）
pnpm format                  # prettier --write
```

更新测试：`$env:BB_UPDATE_FEED_URL` 指向本地 feed 目录，避免用真实 Release 试更新。

### 11.2 目录树（源码侧）

```
src/
  main/
    agent/        engine.ts + engine.spec.ts + engine-headless.spec.ts
    llm/          gateway.ts / sse.ts（+ spec）
    tools/        registry.ts types.ts index.ts builtin/{filesystem,terminal,web,use_skill}.ts
    workspace/    provider.ts local.ts browse.ts（+ spec）
    skills/       loader.ts registry.ts manager.ts hub.ts zip.ts types.ts（+ spec）
    mcp/          manager.ts hub.ts token.ts（+ spec）
    permissions/  gate.ts（+ spec）
    db/           store.ts（+ spec）
    apps.ts       IDE 探测/打开（+ spec）
    settings.ts   模型配置与加密（+ spec）
    ipc.ts        通道注册与事件转发
    updater.ts    自动更新
    index.ts      启动装配
  preload/        index.ts（能力白名单）+ index.d.ts
  shared/         types.ts（数据模型）+ ipc.ts（通道常量）
  renderer/src/
    pages/        Home / Chat / Skills / Mcp / Settings
    components/   Composer ToolCallCard ApprovalPanel ResultPanel TaskOpenMenu
                  Onboarding UpdateDialog Markdown scrollbar-reveal mcp-detail tool-display
    stores/       agent.ts（内含 turn-reducer） settings.ts skills.ts
    assets/       main.css（设计 token + 全局样式含滚动条）
docs/
  adr/ADR-0001-技术选型与架构命门.md
  二期服务端化架构预留检查表.md
  BlueBuddy-项目总结.md（本文）
```

### 11.3 术语表

| 术语                | 含义                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| turn                | 一条用户消息引发的完整 Agent 过程（可能含多轮工具调用）              |
| 迭代（iter）        | turn 内的一次"LLM 调用 + 工具执行"，上限 `maxIterations`             |
| 渐进式披露          | 技能先以轻量索引进提示词，命中后才加载完整正文                       |
| 可信根（readRoots） | 允许读取但不允许写入的额外目录（技能目录）                           |
| 产物（artifact）    | 工具产出的可交付物：本地文件或链接，落 `artifacts` 表                |
| 过程组              | UI 把一轮内的思考/工具/中间说明折叠成一块，最终答复外露              |
| 命门                | 项目里"一旦破坏就不可逆"的两条架构约束（引擎纯逻辑、Workspace 抽象） |

---

> 维护提示：本文与代码同步更新。新增阶段或改变架构约束时，至少改 §2（交付）、§5（决策）、§9（边界）、§10（规划）四处；`docs/二期服务端化架构预留检查表.md` 负责逐项核对预留接缝是否仍在。
