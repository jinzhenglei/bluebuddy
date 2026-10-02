import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installScrollbarReveal } from './components/scrollbar-reveal'

// 全局行为：悬停才浮现滚动条（与 main.css 里的 .sb-hot 规则配套）
installScrollbarReveal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
