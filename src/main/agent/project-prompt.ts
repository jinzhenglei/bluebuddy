import type { ArtifactDraft } from '../tools/types'

/** 注入提示词的产出条数上限（超出只给「另有 N 项未列出」，控 token） */
export const PROJECT_ARTIFACT_LIMIT = 30

/** 项目空间基本信息（结构上与 DbStore.Project 兼容，这里只声明用到的字段） */
export interface ProjectPromptInput {
  name: string
  workDir: string
  instructions?: string | null
  providerId?: string | null
}

/** 参与注入的产物候选：只有 kind='file' 且 relPath 非空者会被列出 */
export interface ProjectPromptArtifact {
  kind: ArtifactDraft['kind'] | string
  name: string
  relPath?: string | null
  url?: string | null
  sessionTitle?: string
}

/**
 * 拼出要追加到 systemPrompt 末尾的项目空间段。
 *
 * 两段：空间身份（名称 / 工作目录 / 项目指令原文）＋ 已有产出清单（只列文件名与
 * 相对路径，绝不带产物内容，也不带 link 的 URL——链接可能含 token）。
 * 指令与产出都为空时返回空串，调用方据此不产生多余空行。
 */
export function buildProjectPromptSection(
  project: ProjectPromptInput,
  artifacts: ProjectPromptArtifact[],
  opts?: { limit?: number }
): string {
  const instructions = (project.instructions ?? '').trim()
  const limit = opts?.limit ?? PROJECT_ARTIFACT_LIMIT
  // link 类与缺 relPath 的记录没有引用价值，直接排除
  const files = artifacts.filter((a) => a.kind === 'file' && !!a.relPath)

  if (!instructions && !files.length) return ''

  const lines: string[] = [`## 项目空间：${project.name}`, `工作目录：${project.workDir}`]
  if (instructions) lines.push(`项目指令（用户设定，须遵守）：\n${instructions}`)

  if (files.length) {
    lines.push('', '### 已有产出（路径相对工作目录，可引用）')
    for (const a of files.slice(0, limit)) {
      const from = a.sessionTitle ? `｜来自「${a.sessionTitle}」` : ''
      lines.push(`- ${a.name}（${a.relPath}${from}）`)
    }
    const rest = files.length - limit
    if (rest > 0) lines.push(`（另有 ${rest} 项未列出）`)
  }

  return lines.join('\n')
}
