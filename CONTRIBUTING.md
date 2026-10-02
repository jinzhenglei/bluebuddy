# 参与贡献

感谢有兴趣参与 BlueBuddy。这个项目对**边界纪律**要求较高——两条架构命门一旦被破坏，二期服务端化就要重写内核，所以请先读完本页再动手。

## 环境准备

- Node.js LTS + pnpm
- Windows 上编译 `better-sqlite3` 需要 Visual Studio Build Tools（C++ 工作负载）
- `pnpm install`（`postinstall` 会执行 `electron-builder install-app-deps`，跳过它会导致 dev 的 `electron.exe` 缺失或原生模块 ABI 不匹配）

```bash
pnpm dev         # 开发模式（渲染层热更新即时生效；主进程改动需重启）
pnpm typecheck   # tsc --noEmit，node + web 两套配置
pnpm lint        # eslint --cache，警告也算不合格
pnpm test        # vitest run
pnpm format      # prettier --write
```

## 门禁：提交前三项必须全绿

```
pnpm format → pnpm typecheck → pnpm lint → pnpm test
```

- **不要把三条命令合成一条**，任何一条失败都要停下来处理，而不是"先提交再修"。
- 测试环境是 `node`（没有 jsdom）。渲染层逻辑请**把纯函数抽出来单独测**（参考 `stores/turn-reducer.ts`、`components/scrollbar-reveal.ts`、`components/mcp-detail.ts`），不要为了测试引入 DOM 依赖。
- 新增测试文件与源文件**同目录就近放置**，命名 `*.spec.ts`。

## 提交规范

- Conventional Commits：`feat:` / `fix:` / `docs:` / `style:` / `refactor:` / `test:` / `chore:`，作用域写在括号里（如 `fix(apps):`、`feat(skills-ui):`）。
- **标题说做了什么，正文说为什么**：改动动机、取舍、被证伪的方案、边界影响。中文书写。
- 一个 commit 只做一件事；一次改动控制在"一次能看完"的规模，超了就拆。
- 只 `git add` 你这次改动的路径，**不要 `git add .`**（工作区里可能有别人的改动或生成目录）。生成物不入库：`node_modules/`、`out/`、`dist/`、`.kb/`、`docs/wiki/`。

## 动手前先看这四条边界

1. **Agent 引擎必须是纯逻辑库**
   `src/main/agent/` 下禁止 `import 'electron'`。新能力若需要外部副作用，通过 `RunAgentTurnOptions` 注入回调，别直接在引擎里调 API。守卫用例：`engine-headless.spec.ts`（在无 Electron 的普通 Node 里跑通一次任务）。

2. **文件与命令只能走 `WorkspaceProvider`**
   工具代码里不要出现 `node:fs` / `child_process`。写入严格锁在工作目录内，读取才允许额外可信根。命令执行必须 `spawn(command, args)` 传数组，**不拼 shell 字符串**。

3. **能力暴露必须过 preload 白名单**
   新增主进程能力 = 同时改 `src/shared/ipc.ts`（通道常量）、`src/main/ipc.ts`（handler）、`src/preload/index.ts`（白名单封装）。渲染进程不允许任何绕过 `window.api` 的通道。订阅型 API 必须返回取消订阅函数，并在卸载时调用。

4. **数据库迁移只追加、不改历史**
   加表/加列就在 `db/store.ts` 里追加 `if (current < N)` 分支并递增 `SCHEMA_VERSION`；**绝不修改已有的迁移分支**（老用户库里已经跑过）。同时补一条"旧版本库升级后仍可用"的测试。

另外两条纪律：**高危操作一律 `requiresApproval: true`**（远端 MCP 工具不受沙箱约束，批准是唯一的补偿手段）；**API Key / 令牌只能留在主进程**，下发给渲染层的永远是掩码，且要能识别"掩码被原样回传"而不覆盖真实值。

## PR 流程

1. 从 `main` 开分支：`feat/xxx`、`fix/xxx`。
2. 先开 Issue 说明动机与方案，尤其是涉及架构边界的改动——**方向不对的实现再漂亮也要重来**。
3. 本地过全部门禁，`pnpm dev` 实测跑通你描述的场景（不要只看类型通过就交）。
4. PR 描述写清：问题、方案、影响面、如何验证、是否需要数据迁移。
5. 审查关注点：是否破坏四条边界、是否有隐藏挂死（子进程 stdin 未关、Promise 永不 settle）、异常是否会打断整个 turn、路径是否可穿越。

## Issue 反馈

请尽量给出：版本（关于页可见）、系统、复现步骤、期望与实际行为、报错信息或截图。涉及 Agent 行为时请附上那一轮的**过程组内容**（展开折叠块即可看到工具调用与结果）；涉及崩溃/挂死时可用 DevTools 控制台（开发模式 F12）。

## 贡献技能包

`examples/skills/word-count/` 是一个带脚本的最小技能示例。技能 = `SKILL.md`（frontmatter 写 `name` / `description`（**何时用**，这是模型能否自动命中的关键）+ 正文指令）+ 可选 `scripts/`、`resources/`。技能脚本没有独立执行通道：它通过 `read_file` / `run_command` 走同一套沙箱与批准。

## 许可

提交即表示你同意你的贡献以 [Apache License 2.0](LICENSE) 分发，并确认你有权贡献这些代码。
