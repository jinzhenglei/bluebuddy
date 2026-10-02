import { describe, it, expect } from 'vitest'
import { isScrollerLike, inBox, type ScrollMetrics } from './scrollbar-reveal'

/**
 * 滚动条浮现的纯判定逻辑单测（不依赖 DOM）：
 * 决定"哪个元素算滚动容器"与"指针是否真的还在它可视区内"。
 */

function metrics(over: Partial<ScrollMetrics>): ScrollMetrics {
  return {
    scrollHeight: 100,
    clientHeight: 100,
    overflowY: 'visible',
    scrollWidth: 100,
    clientWidth: 100,
    overflowX: 'visible',
    ...over
  }
}

describe('isScrollerLike', () => {
  it('纵向溢出且 overflow-y 为 auto/scroll 才算滚动容器', () => {
    expect(
      isScrollerLike(metrics({ scrollHeight: 500, clientHeight: 200, overflowY: 'auto' }))
    ).toBe(true)
    expect(
      isScrollerLike(metrics({ scrollHeight: 500, clientHeight: 200, overflowY: 'scroll' }))
    ).toBe(true)
  })

  it('不溢出、或 overflow 为 visible/hidden 时不算（不给它浮现滚动条）', () => {
    expect(
      isScrollerLike(metrics({ scrollHeight: 200, clientHeight: 200, overflowY: 'auto' }))
    ).toBe(false)
    expect(
      isScrollerLike(metrics({ scrollHeight: 500, clientHeight: 200, overflowY: 'hidden' }))
    ).toBe(false)
  })

  it('横向溢出（如代码块）同样算', () => {
    expect(isScrollerLike(metrics({ scrollWidth: 900, clientWidth: 300, overflowX: 'auto' }))).toBe(
      true
    )
  })
})

describe('inBox', () => {
  // 模拟侧栏任务列表：左 12、上 200、右 244（含 9px 滚动条带）、下 900
  const box = { left: 12, top: 200, right: 244, bottom: 900 }

  it('指针在内容区与滚动条带上都算命中（带上要能抓住滑块）', () => {
    expect(inBox(100, 400, box)).toBe(true)
    expect(inBox(240, 400, box)).toBe(true) // 滚动条带内
    expect(inBox(244, 400, box)).toBe(true) // 右边界
  })

  it('移出容器、停在父层留白（右侧 12px 内边距）时不命中——滚动条该隐', () => {
    expect(inBox(250, 400, box)).toBe(false)
    expect(inBox(100, 950, box)).toBe(false)
    expect(inBox(100, 150, box)).toBe(false)
    expect(inBox(5, 400, box)).toBe(false)
  })
})
