// 示例技能自带脚本：统计给定文本文件的行数 / 词数 / 字符数，输出 JSON。
// 用法：node count.js <文件路径>
// 由 word-count 技能通过 run_command 工具调用（在会话工作目录 cwd 下执行）。
const fs = require('fs')

const file = process.argv[2]
if (!file) {
  console.error('usage: node count.js <file>')
  process.exit(1)
}

const text = fs.readFileSync(file, 'utf-8')
const lines = text.split(/\r?\n/).length
const words = (text.match(/\S+/g) || []).length
const chars = text.length

process.stdout.write(JSON.stringify({ lines, words, chars }))
