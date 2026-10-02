/**
 * 悬停浮现滚动条（几何判定版）。
 *
 * 为什么不用纯 CSS `:hover::-webkit-scrollbar-thumb`：实测指针移出滚动容器、停在父层留白上时，
 * Chromium 仍让滑块保持显形（:hover 的命中范围由不得我们），滚动条"该隐不隐"。这里改为自己按矩形
 * 判定：指针落在滚动容器可视框内（含它自己的滚动条带，保证还抓得住滑块）才加 .sb-hot，移出即摘；
 * 另外滚动停止 IDLE_MS 后自动收起——鼠标不动、只滚滚轮也会消失，贴合 macOS 习惯。
 *
 * 样式侧只需为 .sb-hot::-webkit-scrollbar-thumb 上色，见 assets/main.css。
 */

const HOT = 'sb-hot'
/** 滚动停止后多久收起（ms） */
const IDLE_MS = 700
/** 装在 window 上的句柄，供热更新重复安装时先卸掉旧的 */
const HANDLE = '__bbScrollbarReveal'

/** 判定"某个方向真的能滚"所需的最小度量（抽成接口以便脱离 DOM 单测） */
export interface ScrollMetrics {
  scrollHeight: number
  clientHeight: number
  overflowY: string
  scrollWidth: number
  clientWidth: number
  overflowX: string
}

/** 横向或纵向有溢出且 overflow 为 auto/scroll 时，才算滚动容器 */
export function isScrollerLike(m: ScrollMetrics): boolean {
  const y = m.scrollHeight > m.clientHeight + 1 && /auto|scroll/.test(m.overflowY)
  const x = m.scrollWidth > m.clientWidth + 1 && /auto|scroll/.test(m.overflowX)
  return y || x
}

/** 容器可视框（CSS 像素，视口坐标系） */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 指针是否落在容器可视框内；边界算在内——右侧/下侧那条就是滚动带，需要能抓到 */
export function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

/** overflow-x/y 计算值缓存：pointermove 里逐层上溯时避免反复 getComputedStyle */
const overflowCache = new WeakMap<HTMLElement, { overflowX: string; overflowY: string }>()

function metricsOf(el: HTMLElement): ScrollMetrics {
  let ov = overflowCache.get(el)
  if (!ov) {
    const cs = getComputedStyle(el)
    ov = { overflowX: cs.overflowX, overflowY: cs.overflowY }
    overflowCache.set(el, ov)
  }
  return {
    ...ov,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }
}

/** 自命中元素向上找最近的可滚容器（elementFromPoint 已保证指针在该元素内） */
function scrollerAt(x: number, y: number): HTMLElement | null {
  for (let n: Element | null = document.elementFromPoint(x, y); n; n = n.parentElement) {
    if (
      n instanceof HTMLElement &&
      isScrollerLike(metricsOf(n)) &&
      inBox(x, y, n.getBoundingClientRect())
    )
      return n
  }
  return null
}

/** 装上揭示逻辑，返回卸载函数 */
export function createScrollbarReveal(): () => void {
  let current: HTMLElement | null = null
  let dragging = false
  let idleTimer: number | undefined
  let raf = 0
  let px = -1
  let py = -1

  const mark = (el: HTMLElement | null): void => {
    if (current === el) return
    current?.classList.remove(HOT)
    current = el
    if (el) el.classList.add(HOT)
  }

  const evaluate = (): void => {
    if (dragging || px < 0) return
    mark(scrollerAt(px, py))
  }

  const onMove = (e: PointerEvent): void => {
    px = e.clientX
    py = e.clientY
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      evaluate()
    })
  }

  // scroll 不冒泡，必须捕获
  const onScroll = (e: Event): void => {
    const t = e.target
    if (!(t instanceof HTMLElement) || !isScrollerLike(metricsOf(t))) return
    mark(t)
    window.clearTimeout(idleTimer)
    // 滚完收起；若指针仍停在容器上，下一次移动会重新点亮
    idleTimer = window.setTimeout(() => {
      if (!dragging) mark(null)
    }, IDLE_MS)
  }

  // 按住滑块拖动期间不摘类，否则拖出容器框滚动条会当场消失
  const onDown = (): void => {
    dragging = true
  }
  const onUp = (): void => {
    dragging = false
    evaluate()
  }
  // 指针离开窗口（如从滚动条上直接甩出去）时立刻收起
  const onLeave = (): void => {
    px = -1
    mark(null)
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true })
  window.addEventListener('pointerup', onUp, { passive: true })
  document.addEventListener('pointerleave', onLeave)

  return () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('scroll', onScroll, { capture: true })
    document.removeEventListener('pointerdown', onDown, { capture: true })
    window.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointerleave', onLeave)
    if (raf) cancelAnimationFrame(raf)
    window.clearTimeout(idleTimer)
    mark(null)
  }
}

/** 幂等安装：渲染层热更新会重跑入口，先卸旧的再装新的，避免监听器叠加 */
export function installScrollbarReveal(): void {
  const w = window as unknown as Record<string, (() => void) | undefined>
  w[HANDLE]?.()
  w[HANDLE] = createScrollbarReveal()
}
