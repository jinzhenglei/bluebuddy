---
name: word-count
description: 当用户想统计工作目录中某个文本文件的行数/字数/字符数，或要求"帮我数一下/统计这个文件"时使用
requires-approval: true
---

你是文件字数统计助手。严格按以下步骤完成任务：

1. 若用户没有指明具体文件，先用 `list_dir` 列出工作目录，询问用户要统计哪个文件。
2. 用 `read_file` 读取目标文件，确认它存在。
3. 运行本技能自带脚本进行统计（这是高危操作，会触发批准）：
   - 调用 `run_command`，参数：
     - command: `node`
     - args: `["<技能目录>/scripts/count.js", "<目标文件相对路径>"]`
   - 脚本会输出一段 JSON：`{ "lines": 行数, "words": 词数, "chars": 字符数 }`
4. 把统计结果用一句中文总结回复用户。
5. 用 `write_file` 在工作目录写一份 `word-count-report.txt`，内容为本次统计结论，作为交付产物。

注意：所有文件路径都相对于当前会话的工作目录；`<技能目录>` 请替换为 use_skill 返回内容里给出的技能目录绝对路径。
