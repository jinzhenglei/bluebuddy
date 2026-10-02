/**
 * 测试 fixture：最小 stdio MCP 服务器（echo 工具 + 必失败工具）。
 * 由 manager.spec 用 node 子进程真启动，走完整 JSON-RPC 协议链。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'echo-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: '把 msg 原样回显',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg']
      }
    },
    {
      name: 'boom',
      description: '永远失败的工具',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'boom') {
    return { content: [{ type: 'text', text: 'kaboom' }], isError: true }
  }
  const msg = req.params.arguments?.msg ?? ''
  return { content: [{ type: 'text', text: `echo:${msg}` }] }
})

await server.connect(new StdioServerTransport())
