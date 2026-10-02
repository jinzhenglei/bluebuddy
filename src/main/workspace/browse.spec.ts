import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listDir, MAX_PREVIEW_BYTES, readFilePreview } from './browse'

/** 建一个临时工作区：根下 a.txt/b.md、sub/ 子目录、.git 与 node_modules 噪声目录 */
function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-browse-'))
  fs.writeFileSync(path.join(root, 'b.md'), '# hi')
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'inner.txt'), 'x')
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.writeFileSync(path.join(root, 'node_modules', 'junk.js'), 'x')
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, '.git', 'config'), 'x')
  return root
}

describe('listDir', () => {
  it('根目录：目录在前文件在后、按名排序，带正确 relPath 与 size', () => {
    const root = makeWorkspace()
    const entries = listDir(root, '')
    expect(entries.map((e) => [e.name, e.isDir])).toEqual([
      ['sub', true],
      ['a.txt', false],
      ['b.md', false]
    ])
    expect(entries[1]).toMatchObject({ relPath: 'a.txt', size: 5 })
    expect(entries[0]).toMatchObject({ relPath: 'sub', size: 0 })
  })

  it('排除 .git 与 node_modules', () => {
    const root = makeWorkspace()
    const names = listDir(root, '').map((e) => e.name)
    expect(names).not.toContain('.git')
    expect(names).not.toContain('node_modules')
  })

  it('子目录用 / 拼接 relPath，反斜杠入参也接受', () => {
    const root = makeWorkspace()
    expect(listDir(root, 'sub').map((e) => e.relPath)).toEqual(['sub/inner.txt'])
    expect(listDir(root, 'sub\\').map((e) => e.relPath)).toEqual(['sub/inner.txt'])
  })

  it('.. 穿越与绝对路径逃逸都抛错', () => {
    const root = makeWorkspace()
    expect(() => listDir(root, '../../Windows')).toThrow(/工作区/)
    expect(() => listDir(root, path.resolve(root, '..'))).toThrow(/工作区/)
  })

  it('不存在的目录抛错（IPC 层转成 ok:false）', () => {
    const root = makeWorkspace()
    expect(() => listDir(root, 'nope')).toThrow()
  })
})

describe('readFilePreview', () => {
  it('文本文件返回内容与大小', () => {
    const root = makeWorkspace()
    const r = readFilePreview(root, 'a.txt')
    expect(r).toMatchObject({ ok: true, content: 'hello', size: 5, truncated: false })
  })

  it('超 256KB 截断并标记 truncated', () => {
    const root = makeWorkspace()
    fs.writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(MAX_PREVIEW_BYTES + 10))
    const r = readFilePreview(root, 'big.txt')
    expect(r.ok).toBe(true)
    expect(r.truncated).toBe(true)
    expect(r.content?.length).toBe(MAX_PREVIEW_BYTES)
  })

  it('含 \\0 的二进制文件只回标记不给内容', () => {
    const root = makeWorkspace()
    fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42]))
    const r = readFilePreview(root, 'bin.dat')
    expect(r).toMatchObject({ ok: true, binary: true, size: 3 })
    expect(r.content).toBeUndefined()
  })

  it('目录回 ok:false；越界抛错', () => {
    const root = makeWorkspace()
    expect(readFilePreview(root, 'sub')).toMatchObject({ ok: false })
    expect(() => readFilePreview(root, '../secret.txt')).toThrow(/工作区/)
  })
})
