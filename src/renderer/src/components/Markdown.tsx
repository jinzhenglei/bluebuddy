import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * assistant 正文的 Markdown 渲染器。
 *
 * 安全：react-markdown 默认不把原文里的裸 HTML 当标签注入（未启用 rehype-raw），
 * 模型输出 <script> 之类也只作纯文本展示，无 XSS 面——这对渲染进程很重要。
 * 能力：remark-gfm 补齐表格 / 删除线 / 任务列表等 GitHub 风味语法。
 * 排版：统一由 main.css 的 .md 类提供（浅色主题令牌），组件本身不带样式。
 */
export function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
