import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORLD_BUILD_TOOL_NAME } from './constants.js'
import { buildMarkdownContent, readNovelFile, writeNovelFile, deleteNovelFile, listNovelFiles, updateNovelContext, appendToContextLog } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['create', 'update', 'read', 'delete', 'list'])
      .describe('操作类型：create 创建新设定, update 更新设定, read 读取设定, delete 删除设定, list 列出所有设定'),
    name: z
      .string()
      .optional()
      .describe('设定名称，如"修炼体系"、"魔法系统"、"科技设定"'),
    sections: z
      .record(z.string())
      .optional()
      .describe('设定内容，key 为小标题，value 为内容。如 { "境界划分": "练气、筑基、金丹...", "核心规则": "..." }'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
    files: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const WorldBuildTool = buildTool({
  name: WORLD_BUILD_TOOL_NAME,
  searchHint: 'create and manage novel world settings',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '管理小说的世界观设定，包括修炼体系、势力分布、地理设定、核心规则等'
  },
  async prompt() {
    return `管理小说的世界观设定系统。

用法：
- action=create: 创建新的世界观设定，需要提供 name 和 sections
- action=update: 更新已有设定，需要提供 name 和 sections（会合并到已有内容）
- action=read: 读取指定设定的完整内容，需要提供 name
- action=delete: 删除指定设定，需要提供 name
- action=list: 列出所有已创建的世界观设定

在写小说之前，必须先用此工具创建世界观设定，后续写章节时会自动参考这些设定。
设定会保存到 novel/world/ 目录下。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '世界观设定'
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.name ?? ''}`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ action, name, sections }) {
    if (action === 'list') {
      const files = listNovelFiles('world')
      return {
        data: {
          success: true,
          message: `共 ${files.length} 个世界观设定`,
          files,
        },
      }
    }

    if (!name) {
      return { data: { success: false, message: '需要提供设定名称 (name)' } }
    }

    const filename = `world/${name}.md`

    if (action === 'read') {
      const content = await readNovelFile(filename)
      if (!content) {
        return { data: { success: false, message: `设定 "${name}" 不存在` } }
      }
      return { data: { success: true, message: `已读取 "${name}"`, content } }
    }

    if (action === 'delete') {
      const deleted = deleteNovelFile(filename)
      if (!deleted) {
        return { data: { success: false, message: `设定 "${name}" 不存在` } }
      }
      return { data: { success: true, message: `设定 "${name}" 已删除` } }
    }

    if (action === 'create') {
      if (!sections) {
        return { data: { success: false, message: '创建设定需要提供 sections 内容' } }
      }
      const content = buildMarkdownContent(name, sections)
      const path = await writeNovelFile(filename, content)
      await appendToContextLog(`创建世界观设定: ${name}`)
      return { data: { success: true, message: `世界观设定 "${name}" 已创建`, content, files: [path] } }
    }

    if (action === 'update') {
      const existing = (await readNovelFile(filename)) ?? ''
      const merged = sections
        ? existing + '\n\n' + buildMarkdownContent(`${name}（补充）`, sections)
        : existing
      const path = await writeNovelFile(filename, merged)
      return { data: { success: true, message: `世界观设定 "${name}" 已更新`, content: merged, files: [path] } }
    }

    return { data: { success: false, message: `未知操作: ${action}` } }
  },
  mapToolResultToToolResultBlockParam({ success, message, content }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: success && content
        ? `${message}\n\n${content}`
        : message,
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
