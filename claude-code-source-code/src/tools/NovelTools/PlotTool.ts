import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { PLOT_TOOL_NAME } from './constants.js'
import { buildMarkdownContent, readNovelFile, writeNovelFile, deleteNovelFile, listNovelFiles } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['create', 'update', 'read', 'delete', 'list'])
      .describe('操作类型'),
    name: z
      .string()
      .optional()
      .describe('情节线名称，如"主线"、"感情线"、"复仇线"'),
    sections: z
      .record(z.string())
      .optional()
      .describe('情节内容，key 为阶段名，value 为情节描述。如 { "起因": "...", "发展": "...", "高潮": "...", "结局": "..." }'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
    plotLines: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const PlotTool = buildTool({
  name: PLOT_TOOL_NAME,
  searchHint: 'create and manage novel plot lines',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '管理小说的情节线，包括主线、支线、伏笔、转折等'
  },
  async prompt() {
    return `管理小说情节线系统。

用法：
- action=create: 创建新的情节线（主线、支线均可）
- action=update: 更新情节线进展
- action=read: 读取情节线内容
- action=delete: 删除情节线
- action=list: 列出所有情节线

每条情节线建议包含以下阶段：
- 起因：这条线的起因和背景
- 发展：关键事件和转折
- 高潮：冲突最激烈的节点
- 结局：最终走向

还可以用来管理：
- 伏笔：埋下的伏笔及计划揭开的章节
- 冲突：角色之间/势力之间的矛盾
- 伏笔追踪：确保所有伏笔最终都有交代

情节线保存到 novel/plots/ 目录下。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '情节线管理'
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
      const plotLines = listNovelFiles('plots')
      return {
        data: {
          success: true,
          message: `共 ${plotLines.length} 条情节线`,
          plotLines,
        },
      }
    }

    if (!name) {
      return { data: { success: false, message: '需要提供情节线名称 (name)' } }
    }

    const filename = `plots/${name}.md`

    if (action === 'read') {
      const content = await readNovelFile(filename)
      if (!content) {
        return { data: { success: false, message: `情节线 "${name}" 不存在` } }
      }
      return { data: { success: true, message: `已读取情节线 "${name}"`, content } }
    }

    if (action === 'delete') {
      const deleted = deleteNovelFile(filename)
      if (!deleted) {
        return { data: { success: false, message: `情节线 "${name}" 不存在` } }
      }
      return { data: { success: true, message: `情节线 "${name}" 已删除` } }
    }

    if (action === 'create') {
      if (!sections) {
        return { data: { success: false, message: '创建情节线需要提供 sections' } }
      }
      const content = buildMarkdownContent(name, sections)
      await writeNovelFile(filename, content)
      return { data: { success: true, message: `情节线 "${name}" 已创建`, content } }
    }

    if (action === 'update') {
      const existing = (await readNovelFile(filename)) ?? ''
      const merged = sections
        ? existing + '\n\n' + buildMarkdownContent('进展更新', sections)
        : existing
      await writeNovelFile(filename, merged)
      return { data: { success: true, message: `情节线 "${name}" 已更新`, content: merged } }
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
