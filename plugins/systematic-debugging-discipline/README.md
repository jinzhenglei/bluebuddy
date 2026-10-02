# 系统化调试纪律

单个技能插件，从 [obra/superpowers](https://github.com/obra/superpowers) 的
`systematic-debugging` 技能独立提取而来。**不安装整个 Superpowers 框架**，
只引入这一项流程纪律。

## 这个插件做什么

在提出任何修复之前，强制先完成根因调查。核心铁律 ——
`NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`。按四阶段推进：
根因调查 → 模式分析 → 假设与最小验证 → 实现修复；连续 3 次修复失败时，
停下来质疑架构而不是继续猜。

## 触发方式

- **场景自动触发**：遇到任何 bug、测试失败、异常行为、性能/构建问题，在提出修复方案之前激活。
- **手动调用**：`/systematic-debugging`

## 包含内容

- `skills/systematic-debugging/SKILL.md` —— 主技能
- `skills/systematic-debugging/root-cause-tracing.md` —— 反向追踪技术（SKILL.md 引用）
- `skills/systematic-debugging/defense-in-depth.md` —— 多层校验（SKILL.md 引用）
- `skills/systematic-debugging/condition-based-waiting.md` —— 条件轮询替代超时（SKILL.md 引用）

## 来源与改动

- 来源：https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md
- 唯一改动：原文两处对 `superpowers:test-driven-development` /
  `superpowers:verification-before-completion` 的跨技能引用，去掉了 `superpowers:`
  前缀，改为按技能名引用，以适配“拆分为独立插件、不装整个框架”的场景。
  若同时安装了另外两个插件，引用即可生效。
