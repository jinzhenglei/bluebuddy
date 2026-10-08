## 这个 PR 改了什么

<!-- 一句话说明动机与结果。若关联 Issue，写 `Closes #编号`。 -->

## 影响面

- [ ] 引擎调度（`src/main/agent/`）
- [ ] 工具 / 权限 / 沙箱（`src/main/tools`、`permissions`、`workspace`）
- [ ] 数据库结构（`src/main/db/store.ts`，必须新增迁移版本）
- [ ] IPC 契约（`src/shared/ipc.ts`、`src/preload/index.ts`）
- [ ] 渲染层 UI（`src/renderer/`）
- [ ] 仅文档 / 注释

## 自查清单（合并前必须全绿）

```
pnpm format
pnpm typecheck
pnpm lint
pnpm test
```

- [ ] 三条门禁命令都单独跑过，不是合并成一行糊过去的
- [ ] 新增或改动的行为有对应测试；测试断言的是行为，不是实现细节
- [ ] 引擎代码没有 `import electron`，副作用仍通过 `RunAgentTurnOptions` 注入
- [ ] 工具里没有绕开 `WorkspaceProvider` 直接用 `node:fs` / `child_process`
- [ ] 新增高危工具已标 `requiresApproval: true`，并验证过拒绝一次不会污染后续授权
- [ ] IPC 新增订阅 API 返回了取消函数，并在示例里演示 useEffect 清理
- [ ] 涉及密钥的代码只留在主进程，未把 Key 传给渲染层
- [ ] UI 改动附截图或录屏；滚动条等浮层遵守悬浮式显形机制（JS 判定，不用已证伪的 CSS `:hover` 技巧）
- [ ] 没有把 `.kb/`、`docs/wiki/`、`plugins/repo-wiki/`、`out/`、`release/` 提交进来

## 兼容性说明

<!-- 数据库迁移、IPC 通道改名、技能包 frontmatter 变更等，说明老用户升级后会发生什么。 -->

## 我知道的遗留问题

<!-- 没做完的部分、临时绕法，写在这里比藏在代码里好。 -->
