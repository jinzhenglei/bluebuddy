/** 注入提示词的产出条数上限（超出只给「另有 N 项未列出」，控 token） */
export const PROJECT_ARTIFACT_LIMIT = 30

/** 项目空间基本信息（结构上与 DbStore.Project 兼容，这里只声明用到的字段） */
export interface ProjectPromptInput {
  name: string
  workDir: string
  instructions?: string | null
  providerId?: string | null
}

/**
 * 参与注入的产出条目：任务产物与其他途径文件同地位（由 collectProjectAssets 合成，
 * link 类与缺 relPath 的在那一层已被排除）。这里只取展示需要的三个字段，
 * 类型上就没有 url 与内容，避免把带 token 的链接或文件正文喂给模型。
 */
export interface ProjectPromptAsset {
  name: string
  relPath?: string | null
  sessionTitle?: string
}

/**
 * 拼出要追加到 systemPrompt 末尾的项目空间段。
 *
 * 两段：空间身份（名称 / 工作目录 / 项目指令原文）＋ 已有产出清单（只列文件名与
 * 相对路径，绝不带产物内容）。指令与产出都为空时返回空串，调用方据此不产生多余空行。
 */
export function buildProjectPromptSection(
  project: ProjectPromptInput,
  assets: ProjectPromptAsset[],
  opts?: { limit?: number }
): string {
  const instructions = (project.instructions ?? '').trim()
  const limit = opts?.limit ?? PROJECT_ARTIFACT_LIMIT
  // 防御性再挡一道：没有相对路径的条目对模型无引用价值（也不该把绝对路径猜错）
  const files = assets.filter((a) => !!a.relPath)

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
