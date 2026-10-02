import fsSync from 'node:fs'
import * as path from 'node:path'
import AdmZip from 'adm-zip'

/**
 * zip 技能包解压与技能目录定位。
 *
 * 安全模型：手工逐条落盘以便把关 zip-slip——拒绝 .. 段、绝对路径、
 * 以及解析后逃出 destDir 的条目；条目数与解压总字节设上限防炸弹包。
 * （adm-zip 自身写入时会 sanitize 条目名，但外部工具造的恶意包不会，
 *  这道关必须自己把。）
 */

/** zip 包安全上限：条目数与解压后总字节，防炸弹包撑爆磁盘/内存 */
export const MAX_ZIP_ENTRIES = 2000
export const MAX_ZIP_BYTES = 50 * 1024 * 1024

export function extractZipSafely(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`zip 条目数超上限（${MAX_ZIP_ENTRIES}）`)
  }
  const root = path.resolve(destDir)
  let total = 0
  for (const e of entries) {
    if (e.isDirectory) continue
    total += e.header.size
    if (total > MAX_ZIP_BYTES) {
      throw new Error(`zip 解压后总大小超上限（${MAX_ZIP_BYTES / 1024 / 1024}MB）`)
    }
    const rel = e.entryName.replace(/\\/g, '/')
    if (rel.startsWith('/') || rel.split('/').includes('..')) {
      throw new Error(`zip 含非法路径：${e.entryName}`)
    }
    const target = path.resolve(root, rel)
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`zip 含非法路径：${e.entryName}`)
    }
    fsSync.mkdirSync(path.dirname(target), { recursive: true })
    fsSync.writeFileSync(target, e.getData())
  }
}

/** 在解压根里找技能目录：根直接有 SKILL.md，或第一个含 SKILL.md 的一级子目录 */
export function detectSkillDir(extractRoot: string): string | null {
  if (fsSync.existsSync(path.join(extractRoot, 'SKILL.md'))) return extractRoot
  const dirs = fsSync
    .readdirSync(extractRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
  for (const d of dirs) {
    if (fsSync.existsSync(path.join(extractRoot, d.name, 'SKILL.md'))) {
      return path.join(extractRoot, d.name)
    }
  }
  return null
}
