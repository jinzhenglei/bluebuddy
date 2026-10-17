import type { ReactNode } from 'react'
import type { AssetKind } from './asset-display'

/**
 * 资产页用到的字体图标（内联 SVG，随 currentColor 走色）。
 * 与项目其余页面同一套路：不引图标库，viewBox 统一 24，线宽统一。
 */

function Svg({
  size = 16,
  weight = 1.9,
  children
}: {
  size?: number
  weight?: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconSearch({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </Svg>
  )
}

export function IconClose({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={2.2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function IconRefresh({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={2}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </Svg>
  )
}

export function IconFolder({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={1.8}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2l1.8 2h8A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z" />
    </Svg>
  )
}

/** 来源＝任务生成：四角星，暗示"由模型产出" */
export function IconSpark({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={1.6}>
      <path d="M12 4.5l1.7 4.3 4.3 1.7-4.3 1.7L12 16.5l-1.7-4.3L6 10.5l4.3-1.7L12 4.5Z" />
    </Svg>
  )
}

/** 来源＝其他途径：落入托盘，暗示"人自己放进来的" */
export function IconTray({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={1.8}>
      <path d="M12 4v7.5m0 0 3-3m-3 3-3-3" />
      <path d="M5 15v3a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-3" />
    </Svg>
  )
}

export function IconGrid({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={1.8}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </Svg>
  )
}

export function IconRows({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size} weight={1.8}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" strokeWidth={3} />
    </Svg>
  )
}

export function IconMore({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

/** 文件轮廓：所有类型徽标共用的外框，内部再叠一枚类型标记 */
function FileOutline({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <Svg size={17}>
      <path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5L13 3.5Z" />
      <path d="M12.8 3.6v5.1H17.9" />
      {children}
    </Svg>
  )
}

/** 类型徽标里的图形：形状先说话，颜色只是加强 */
export function KindGlyph({ kind }: { kind: AssetKind }): React.JSX.Element {
  switch (kind) {
    case 'sheet':
      return (
        <FileOutline>
          <rect x="8.6" y="12.4" width="6.8" height="5.4" rx="0.6" />
          <path d="M8.6 15.1h6.8M12 12.4v5.4" />
        </FileOutline>
      )
    case 'slide':
      return (
        <FileOutline>
          <rect x="8.8" y="12.6" width="6.4" height="4.8" rx="0.8" />
        </FileOutline>
      )
    case 'web':
      return (
        <FileOutline>
          <circle cx="12" cy="14.9" r="3" />
          <path d="M9 14.9h6M12 11.9v6" />
        </FileOutline>
      )
    case 'data':
      return (
        <FileOutline>
          <path d="M10.6 12.6 8.4 15.2l2.2 2.6M13.4 12.6l2.2 2.6-2.2 2.6" />
        </FileOutline>
      )
    case 'code':
      return (
        <FileOutline>
          <path d="m10.4 13.2-1.8 1.9 1.8 1.9M13.6 13.2l1.8 1.9-1.8 1.9" />
        </FileOutline>
      )
    case 'doc':
      return (
        <FileOutline>
          <path d="M9 13.4h6M9 16.4h4" />
        </FileOutline>
      )
    default:
      return (
        <FileOutline>
          <path d="M9.4 14.6h5.2" />
        </FileOutline>
      )
  }
}
