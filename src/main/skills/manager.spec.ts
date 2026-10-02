import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { DbStore } from '../db/store'
import { ToolRegistry } from '../tools/registry'
import { SkillRegistry } from './registry'
import { SkillManager } from './manager'

const SKILL_MD = (name: string, desc: string): string =>
  `---\nname: ${name}\ndescription: ${desc}\n---\n\n# 正文\n按步骤执行。\n`

/** 建一个含合法技能的源目录 */
async function makeSkillSource(root: string, dirName: string, name: string): Promise<string> {
  const dir = path.join(root, dirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), SKILL_MD(name, `${name} 的用途`))
  return dir
}

interface Harness {
  root: string
  db: DbStore
  skillRegistry: SkillRegistry
  toolRegistry: ToolRegistry
  manager: SkillManager
}

function makeHarness(): Harness {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillmgr-'))
  const root = path.join(base, 'skills')
  const db = new DbStore(path.join(base, 'db.sqlite'))
  const skillRegistry = new SkillRegistry()
  const toolRegistry = new ToolRegistry()
  const manager = new SkillManager({ rootDir: root, db, skillRegistry, toolRegistry })
  return { root, db, skillRegistry, toolRegistry, manager }
}

describe('SkillManager 生命周期', () => {
  it('init 为磁盘技能补登记行并上架 use_skill', async () => {
    const h = makeHarness()
    const src = await makeSkillSource(path.join(os.tmpdir(), 'bb-skillsrc-'), 'alpha', 'alpha')
    await fs.mkdir(h.root, { recursive: true })
    await fs.cp(src, path.join(h.root, 'alpha'), { recursive: true })

    await h.manager.init()
    expect(h.skillRegistry.size).toBe(1)
    expect(h.toolRegistry.get('use_skill')).toBeDefined()
    expect(h.db.listSkillRows()).toMatchObject([{ name: 'alpha', enabled: true }])
    h.db.close()
  })

  it('停用后 registry 清空且 use_skill 下架；列表仍可见（enabled=false）', async () => {
    const h = makeHarness()
    await fs.mkdir(h.root, { recursive: true })
    await makeSkillSource(h.root, 'alpha', 'alpha')
    await h.manager.init()

    await h.manager.setEnabled('alpha', false)
    expect(h.skillRegistry.size).toBe(0)
    expect(h.toolRegistry.get('use_skill')).toBeUndefined()
    const list = await h.manager.list()
    expect(list).toMatchObject([{ name: 'alpha', enabled: false }])

    // 再启用恢复
    await h.manager.setEnabled('alpha', true)
    expect(h.skillRegistry.size).toBe(1)
    expect(h.toolRegistry.get('use_skill')).toBeDefined()
    h.db.close()
  })

  it('停用状态跨「重启」保留（新 manager init 不翻转用户设置）', async () => {
    const h = makeHarness()
    await fs.mkdir(h.root, { recursive: true })
    await makeSkillSource(h.root, 'alpha', 'alpha')
    await h.manager.init()
    await h.manager.setEnabled('alpha', false)

    const rebooted = new SkillManager({
      rootDir: h.root,
      db: h.db,
      skillRegistry: new SkillRegistry(),
      toolRegistry: new ToolRegistry()
    })
    await rebooted.init()
    expect(rebooted['opts'].skillRegistry.size).toBe(0)
    h.db.close()
  })

  it('importFromDir 拷贝进 rootDir 并立即生效；重复导入报错', async () => {
    const h = makeHarness()
    const srcRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillsrc-'))
    const src = await makeSkillSource(srcRoot, 'word-count', 'word-count')

    const info = await h.manager.importFromDir(src)
    expect(info).toMatchObject({ name: 'word-count', enabled: true })
    expect(info.dir).toBe(path.join(h.root, 'word-count'))
    await fs.access(path.join(h.root, 'word-count', 'SKILL.md'))
    expect(h.skillRegistry.size).toBe(1)

    await expect(h.manager.importFromDir(src)).rejects.toThrow(/同名技能已存在/)
    h.db.close()
  })

  it('importFromDir 拒绝没有 SKILL.md 的目录', async () => {
    const h = makeHarness()
    const bad = path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillsrc-')), 'empty')
    await fs.mkdir(bad, { recursive: true })
    await expect(h.manager.importFromDir(bad)).rejects.toThrow(/SKILL\.md/)
    h.db.close()
  })

  it('remove 连目录一起删（限 rootDir 沙箱内）且 registry 同步', async () => {
    const h = makeHarness()
    await fs.mkdir(h.root, { recursive: true })
    await makeSkillSource(h.root, 'alpha', 'alpha')
    await h.manager.init()

    await h.manager.remove('alpha')
    expect(h.skillRegistry.size).toBe(0)
    expect(h.db.listSkillRows()).toEqual([])
    await expect(fs.access(path.join(h.root, 'alpha'))).rejects.toThrow()
    h.db.close()
  })
})

describe('SkillManager zip 技能包导入', () => {
  /** 造一个 zip 包文件，entries 为 [包内路径, 内容] */
  function makeZip(entries: Array<[string, string]>): string {
    const zip = new AdmZip()
    for (const [name, content] of entries) zip.addFile(name, Buffer.from(content, 'utf-8'))
    const file = path.join(
      fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillzip-src-')),
      'pkg.zip'
    )
    zip.writeZip(file)
    return file
  }

  it('一级子目录布局：解压安装并以包内目录名落盘', async () => {
    const h = makeHarness()
    const zipFile = makeZip([
      ['word-count/SKILL.md', SKILL_MD('word-count', '统计字数')],
      ['word-count/scripts/count.py', 'print(1)']
    ])

    const info = await h.manager.importFrom(zipFile)
    expect(info).toMatchObject({ name: 'word-count', enabled: true })
    expect(info.dir).toBe(path.join(h.root, 'word-count'))
    await fs.access(path.join(h.root, 'word-count', 'scripts', 'count.py'))
    expect(h.skillRegistry.size).toBe(1)
    h.db.close()
  })

  it('包根即 SKILL.md：目录名回退用 frontmatter name', async () => {
    const h = makeHarness()
    const zipFile = makeZip([['SKILL.md', SKILL_MD('root-skill', '根布局')]])

    const info = await h.manager.importFromZip(zipFile)
    expect(info.dir).toBe(path.join(h.root, 'root-skill'))
    expect(h.skillRegistry.get('root-skill')).toBeDefined()
    h.db.close()
  })

  it('zip 里没 SKILL.md 报错', async () => {
    const h = makeHarness()
    const zipFile = makeZip([['readme.txt', 'not a skill']])
    await expect(h.manager.importFrom(zipFile)).rejects.toThrow(/SKILL\.md/)
    h.db.close()
  })

  it('zip-slip 条目（.. 路径）被拒绝且不留落盘文件', async () => {
    const h = makeHarness()
    // adm-zip 写入时会自己 sanitize 条目名，造不出恶意包；
    // 这里用等长二进制补丁把条目名改成 ../ 开头，模拟外部工具造的恶意 zip
    const clean = makeZip([
      ['word-count/SKILL.md', SKILL_MD('word-count', 'x')],
      ['placeholder.txt', 'boom']
    ])
    const buf = fsSync.readFileSync(clean)
    const patched = Buffer.from(
      buf.toString('latin1').split('placeholder.txt').join('../AAAAAAAA.txt'),
      'latin1'
    )
    const evil = path.join(path.dirname(clean), 'evil.zip')
    fsSync.writeFileSync(evil, patched)

    await expect(h.manager.importFrom(evil)).rejects.toThrow(/非法路径/)
    expect(h.skillRegistry.size).toBe(0)
    h.db.close()
  })

  it('市场安装传入 displayName：落库且 list 优先带出', async () => {
    const h = makeHarness()
    const zipFile = makeZip([['word-count/SKILL.md', SKILL_MD('word-count', '统计字数')]])

    const info = await h.manager.importFromZip(zipFile, '字数统计大师')
    expect(info.displayName).toBe('字数统计大师')
    const rows = await h.manager.list()
    expect(rows[0]).toMatchObject({ name: 'word-count', displayName: '字数统计大师' })
    h.db.close()
  })

  it('importFrom 拒绝既非目录也非 .zip 的源', async () => {
    const h = makeHarness()
    const txt = path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), 'bb-skillsrc-')), 'a.txt')
    await fs.writeFile(txt, 'x')
    await expect(h.manager.importFrom(txt)).rejects.toThrow(/不支持的导入源/)
    h.db.close()
  })
})
