import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { LoadedSkill, SkillMeta } from './types'

/**
 * 技能加载器。分两层：
 * - parseSkillMarkdown：纯函数，把 SKILL.md 文本拆成 frontmatter 元数据 + 指令正文，无 IO，便于单测；
 * - loadSkillFromDir / discoverSkills：读磁盘，对缺文件容错（返回 null / 跳过），坏的 SKILL.md 不拖垮整体。
 *
 * frontmatter 只支持扁平的 `key: value`（够用且可预测），不引入 YAML 依赖。
 */

/** 解析结果：元数据 + frontmatter 之后的正文 */
export interface ParsedSkill {
  meta: SkillMeta
  body: string
}

/** 极简 frontmatter 解析：起始 --- 到下一个 --- 之间的 key:value 作为元数据，其余为正文 */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  const text = raw.replace(/\r\n/g, '\n').replace(/^/, '')
  const lines = text.split('\n')

  if (lines[0]?.trim() !== '---') {
    throw new Error('SKILL.md 缺少起始 frontmatter 分隔符 ---')
  }
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (closeIdx === -1) {
    throw new Error('SKILL.md frontmatter 未正确闭合（缺少结束 ---）')
  }

  const meta: SkillMeta = { name: '', description: '' }
  for (const line of lines.slice(1, closeIdx)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const value = trimmed.slice(colon + 1).trim()
    switch (key) {
      case 'name':
        meta.name = value
        break
      case 'description':
        meta.description = value
        break
      case 'allowed-tools': {
        const list = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length > 0) meta.allowedTools = list
        break
      }
      case 'requires-approval':
        if (value.toLowerCase() === 'true') meta.requiresApproval = true
        else if (value.toLowerCase() === 'false') meta.requiresApproval = false
        break
      // 其余未知键忽略，向前兼容
    }
  }

  if (!meta.name) throw new Error('SKILL.md frontmatter 缺少必填字段 name')
  if (!meta.description) throw new Error('SKILL.md frontmatter 缺少必填字段 description')

  const body = lines.slice(closeIdx + 1).join('\n')
  return { meta, body }
}

/** 读单个技能目录下的 SKILL.md；文件不存在返回 null（交由上层跳过） */
export async function loadSkillFromDir(dir: string): Promise<LoadedSkill | null> {
  const entryPath = path.join(dir, 'SKILL.md')
  let raw: string
  try {
    raw = await fs.readFile(entryPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const { meta, body } = parseSkillMarkdown(raw)
  return { ...meta, dir, entryPath, body }
}

/** 扫描根目录下所有子目录，收集合法技能；缺 SKILL.md 或解析失败的目录被跳过 */
export async function discoverSkills(rootDir: string): Promise<LoadedSkill[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true })
  } catch (err) {
    // 技能根目录还不存在是正常情况（首次运行）
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const skills: LoadedSkill[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const loaded = await loadSkillFromDir(path.join(rootDir, e.name)).catch(() => null)
    if (loaded) skills.push(loaded)
  }
  return skills
}
