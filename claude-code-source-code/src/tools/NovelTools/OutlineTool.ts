import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { OUTLINE_TOOL_NAME } from './constants.js'
import { readNovelFile, writeNovelFile, deleteNovelFile, listNovelFiles } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['create', 'update', 'read', 'delete', 'list'])
      .describe('操作类型'),
    chapter: z
      .number()
      .optional()
      .describe('章节号'),
    title: z
      .string()
      .optional()
      .describe('章节标题'),
    scenes: z
      .array(z.string())
      .optional()
      .describe('章节场景列表，每个元素是一个场景描述'),
    hook: z
      .string()
      .optional()
      .describe('章节结尾的悬念/钩子'),
    pov: z
      .string()
      .optional()
      .describe('视角角色'),
    notes: z
      .string()
      .optional()
      .describe('写作注意事项'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
    chapters: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const OutlineTool = buildTool({
  name: OUTLINE_TOOL_NAME,
  searchHint: 'create and manage chapter outlines',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '管理小说章节大纲，规划每章的场景、冲突和悬念'
  },
  async prompt() {
    return `管理章节大纲系统。

用法：
- action=create: 创建章节大纲，需要提供 chapter（章节号）
- action=update: 更新已有大纲
- action=read: 读取指定章节的大纲
- action=delete: 删除指定章节的大纲
- action=list: 列出所有章节大纲

每个大纲建议包含：
- title: 章节标题
- scenes: 场景列表（按顺序排列）
- hook: 章节结尾的悬念/钩子（吸引读者继续阅读）
- pov: 本章视角角色（第一人称/第三人称）
- notes: 写作注意事项

大纲保存到 novel/outlines/ 目录下。写章节前务必先查看对应大纲。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '大纲管理'
  },
  toAutoClassifierInput(input) {
    return `${input.action} 第${input.chapter ?? '?'}章`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ action, chapter, title, scenes, hook, pov, notes }) {
    if (action === 'list') {
      const chapters = listNovelFiles('outlines')
      return {
        data: {
          success: true,
          message: `共 ${chapters.length} 个章节大纲`,
          chapters,
        },
      }
    }

    if (chapter === undefined) {
      return { data: { success: false, message: '需要提供章节号 (chapter)' } }
    }

    const filename = `outlines/第${chapter}章.md`

    if (action === 'read') {
      const content = await readNovelFile(filename)
      if (!content) {
        return { data: { success: false, message: `第${chapter}章大纲不存在` } }
      }
      return { data: { success: true, message: `已读取第${chapter}章大纲`, content } }
    }

    if (action === 'delete') {
      const deleted = deleteNovelFile(filename)
      if (!deleted) {
        return { data: { success: false, message: `第${chapter}章大纲不存在` } }
      }
      return { data: { success: true, message: `第${chapter}章大纲已删除` } }
    }

    if (action === 'create' || action === 'update') {
      let content = `# 第${chapter}章${title ? `：${title}` : ''}\n\n`

      if (pov) content += `**视角**: ${pov}\n\n`
      if (scenes && scenes.length > 0) {
        content += `## 场景\n\n`
        scenes.forEach((scene, i) => {
          content += `${i + 1}. ${scene}\n`
        })
        content += '\n'
      }
      if (hook) content += `## 章末钩子\n\n${hook}\n\n`
      if (notes) content += `## 写作备注\n\n${notes}\n\n`

      await writeNovelFile(filename, content)
      return { data: { success: true, message: `第${chapter}章大纲已${action === 'create' ? '创建' : '更新'}`, content } }
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
