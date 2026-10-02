# 完成前验证纪律

单个技能插件，从 [obra/superpowers](https://github.com/obra/superpowers) 的
`verification-before-completion` 技能独立提取而来。**不安装整个 Superpowers 框架**，
只引入这一项流程纪律。

## 这个插件做什么

禁止在没有新鲜验证证据时声称“完成/修好了/通过了”。核心铁律 ——
`NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE`。任何状态声明前必须：
识别验证命令 → 完整运行 → 读全输出与退出码 → 确认 → 才作声明。证据先于结论。

## 触发方式

- **场景自动触发**：即将声称工作完成、bug 已修复、测试通过，或在 commit / 提 PR / 收尾任务之前激活。
- **手动调用**：`/verification-before-completion`

## 包含内容

- `skills/verification-before-completion/SKILL.md` —— 主技能（无额外支持文件，源目录仅此一文件）

## 来源与改动

- 来源：https://raw.githubusercontent.com/obra/superpowers/main/skills/verification-before-completion/SKILL.md
- 内容原样保留，仅打包为 Qoder 原生插件结构；未做文本改写。
