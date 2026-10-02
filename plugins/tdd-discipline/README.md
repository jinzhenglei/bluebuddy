# 测试驱动开发纪律（TDD）

单个技能插件，从 [obra/superpowers](https://github.com/obra/superpowers) 的
`test-driven-development` 技能独立提取而来。**不安装整个 Superpowers 框架**，
只引入这一项流程纪律。

## 这个插件做什么

强制 RED-GREEN-REFACTOR 循环：写实现代码之前必须先有一个会失败的测试。
核心铁律 —— `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`（没有失败的测试就不写生产代码；先写了代码就删掉重来）。

## 触发方式

- **场景自动触发**：当你在实现新功能、修 bug、重构或改变行为、即将动手写实现代码时激活。
- **手动调用**：`/test-driven-development`

## 包含内容

- `skills/test-driven-development/SKILL.md` —— 主技能
- `skills/test-driven-development/writing-good-tests.md` —— SKILL.md 内联引用的支持文档（已一并复制）

## 来源与改动

- 来源：https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md
- 内容原样保留，仅打包为 Qoder 原生插件结构；未做文本改写。
