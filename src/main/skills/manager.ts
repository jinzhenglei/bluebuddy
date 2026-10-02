import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import type { SkillInfo } from '@shared/types'
import type { DbStore } from '../db/store'
import { discoverSkills, loadSkillFromDir } from './loader'
import { SkillRegistry } from './registry'
import type { ToolRegistry } from '../tools/registry'
import { createUseSkillTool } from '../tools/builtin/use_skill'
import { detectSkillDir, extractZipSafely } from './zip'

/**
 * 技能管理器（Stage 4 L2）：磁盘技能目录 × DB 启用状态 的协调层。
 *
 * 模型：技能正文永远在磁盘（userData/skills/<dir>/SKILL.md），DB skills 表只记
 * name/dir/enabled/created_at。每次 init/启停/导入/删除后 reload()：
 * 只把「磁盘存在 且 enabled」的技能放进 SkillRegistry，并据此上架/下架 use_skill
 * 元工具——停用后下一轮对话的模型工具索引里就不再出现它。
 */
export class SkillManager {
  constructor(
    private opts: {
      rootDir: string
      db: DbStore
      skillRegistry: SkillRegistry
      toolRegistry: ToolRegistry
    }
  ) {}

  /** 启动时调用：重扫磁盘，为新发现的技能补登记行（保留既有 enabled），再 reload */
  async init(): Promise<void> {
    const discovered = await discoverSkills(this.opts.rootDir)
    const rows = new Map(this.opts.db.listSkillRows().map((r) => [r.name, r]))
    for (const s of discovered) {
      const existing = rows.get(s.name)
      this.opts.db.upsertSkillRow({
        name: s.name,
        dir: s.dir,
        enabled: existing ? existing.enabled : true,
        createdAt: existing ? existing.createdAt : Date.now()
      })
    }
    await this.reload()
  }

  /** 按「磁盘 ∩ enabled」重建 SkillRegistry，并同步 use_skill 元工具的上架 */
  async reload(): Promise<void> {
    const discovered = await discoverSkills(this.opts.rootDir)
    const enabled = new Set(
      this.opts.db
        .listSkillRows()
        .filter((r) => r.enabled)
        .map((r) => r.name)
    )
    this.opts.skillRegistry.setAll(discovered.filter((s) => enabled.has(s.name)))
    if (this.opts.skillRegistry.size > 0) {
      if (!this.opts.toolRegistry.get('use_skill')) {
        this.opts.toolRegistry.register(createUseSkillTool(this.opts.skillRegistry))
      }
    } else {
      this.opts.toolRegistry.unregister('use_skill')
    }
  }

  /** 管理页列表：磁盘技能 + 库内启用状态，按名排序 */
  async list(): Promise<SkillInfo[]> {
    const discovered = await discoverSkills(this.opts.rootDir)
    const rows = new Map(this.opts.db.listSkillRows().map((r) => [r.name, r]))
    return discovered
      .map((s) => {
        const row = rows.get(s.name)
        return {
          name: s.name,
          description: s.description,
          dir: s.dir,
          enabled: row ? row.enabled : true,
          createdAt: row ? row.createdAt : 0,
          displayName: row ? row.displayName : null
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    this.opts.db.setSkillEnabled(name, enabled)
    await this.reload()
  }

  /**
   * 统一导入入口：文件夹或 .zip 技能包（行业标准分发格式）按路径自动分派。
   */
  async importFrom(source: string): Promise<SkillInfo> {
    const st = await fs.stat(source)
    if (st.isDirectory()) return this.importFromDir(source)
    if (source.toLowerCase().endsWith('.zip')) return this.importFromZip(source)
    throw new Error('不支持的导入源：仅支持文件夹或 .zip 技能包')
  }

  /**
   * 从本地文件夹导入：校验源目录是合法技能 → 拷入 rootDir/<目录名> → 登记启用 → reload。
   * 同名技能或目标目录已存在都报错，不静默覆盖。
   */
  async importFromDir(srcDir: string): Promise<SkillInfo> {
    return this.installFromSkillDir(srcDir, path.basename(srcDir))
  }

  /**
   * 从 zip 技能包导入：解压到临时目录（zip-slip 把关）→ 定位 SKILL.md
   * （包根或一级子目录）→ 走与文件夹导入同一安装路径；临时目录用完即删。
   * displayName 可选：市场安装时传入中文真名落库，展示优先用它。
   */
  async importFromZip(zipPath: string, displayName?: string): Promise<SkillInfo> {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillzip-'))
    try {
      extractZipSafely(zipPath, tmp)
      const skillDir = detectSkillDir(tmp)
      if (!skillDir) throw new Error('zip 包里没找到 SKILL.md')
      // 包根即技能时目录名用 frontmatter 的 name；否则用包内一级目录名
      const destName =
        skillDir === tmp
          ? ((await loadSkillFromDir(tmp))?.name ?? 'skill')
          : path.basename(skillDir)
      return await this.installFromSkillDir(skillDir, destName, displayName)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }

  /** 安装公共路径：校验 → 拷入 rootDir/<destName> → 登记启用 → reload */
  private async installFromSkillDir(
    skillDir: string,
    destName: string,
    displayName?: string
  ): Promise<SkillInfo> {
    const loaded = await loadSkillFromDir(skillDir)
    if (!loaded) throw new Error('源目录里没有合法的 SKILL.md')
    if (this.opts.db.listSkillRows().some((r) => r.name === loaded.name)) {
      throw new Error(`同名技能已存在：${loaded.name}`)
    }
    const dest = path.join(this.opts.rootDir, destName)
    try {
      await fs.access(dest)
      throw new Error(`目标目录已存在：${destName}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await fs.mkdir(this.opts.rootDir, { recursive: true })
    await fs.cp(skillDir, dest, { recursive: true })
    this.opts.db.upsertSkillRow({
      name: loaded.name,
      dir: dest,
      enabled: true,
      createdAt: Date.now(),
      displayName: displayName ?? null
    })
    await this.reload()
    return {
      name: loaded.name,
      description: loaded.description,
      dir: dest,
      enabled: true,
      createdAt: Date.now(),
      displayName: displayName ?? null
    }
  }

  /** 删除技能：仅当目录在 rootDir 沙箱内才连目录一起删；否则只删登记行 */
  async remove(name: string): Promise<void> {
    const row = this.opts.db.listSkillRows().find((r) => r.name === name)
    if (row) {
      const root = path.resolve(this.opts.rootDir)
      const dir = path.resolve(row.dir)
      if (dir.startsWith(root + path.sep)) {
        await fs.rm(dir, { recursive: true, force: true })
      }
      this.opts.db.deleteSkillRow(name)
    }
    await this.reload()
  }
}
