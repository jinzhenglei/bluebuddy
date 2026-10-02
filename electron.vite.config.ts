import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias }
  },
  preload: {
    resolve: { alias: sharedAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    // pnpm 严格隔离 peer 依赖会让 @vitejs/plugin-react 与 @tailwindcss/vite
    // 各自解析出一份独立的 vite 物理副本（同版本号但模块身份不同），
    // 导致 TS 认为两个 Plugin 类型互不兼容——纯类型假阳性，运行时行为一致。
    // 单独断言到具体类型也会撞上同一个问题（找不到能同时匹配两份 vite 副本的公共类型），
    // 因此用 never（可赋值给任意类型）逐个绕开，不依赖具体哪份 vite 类型定义。
    plugins: [react() as never, tailwindcss() as never]
  }
})
