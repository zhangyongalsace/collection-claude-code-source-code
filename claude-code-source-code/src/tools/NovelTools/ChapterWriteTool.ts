import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CHAPTER_WRITE_TOOL_NAME } from './constants.js'
import { readNovelFile, writeNovelFile, updateNovelContext, appendToContextLog } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    chapter: z
      .number()
      .describe('章节号'),
    title: z
      .string()
      .optional()
      .describe('章节标题'),
    content: z
      .string()
      .describe('章节正文内容'),
    word_count_target: z
      .number()
      .optional()
      .describe('目标字数（用于提示，不强制截断）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    path: z.string().optional(),
    word_count: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ChapterWriteTool = buildTool({
  name: CHAPTER_WRITE_TOOL_NAME,
  searchHint: 'write a new novel chapter',
  alwaysLoad: true,
  maxResultSizeChars: 200_000,
  async description() {
    return '写一个新章节，将正文内容保存到文件中'
  },
  async prompt() {
    return `写小说章节。

用法：提供章节号和正文内容即可。

写章节前，你应该：
1. 用 ChapterReadTool 或 OutlineTool 查看该章节的大纲
2. 用 CharacterTool 查看涉及角色的信息
3. 用 TimelineTool 确认当前时间节点
4. 用 ChapterReadTool 查看上一章内容（确保衔接）

写作要求：
- 每章 2000-4000 字为宜
- 章节结尾设置悬念或钩子
- 角色对话要有辨识度
- 场景描写和动作描写交替
- 注意与前面章节的衔接

章节保存到 novel/chapters/第N章.md`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '写章节'
  },
  toAutoClassifierInput(input) {
    return `第${input.chapter}章 ${input.title ?? ''}`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ chapter, title, content, word_count_target }) {
    const filename = `chapters/第${chapter}章${title ? `：${title}` : ''}.md`
    const existing = await readNovelFile(filename)
    if (existing) {
      return { data: { success: false, message: `第${chapter}章已存在，请使用 ChapterEdit 修改` } }
    }

    const header = `# 第${chapter}章${title ? `：${title}` : ''}\n\n`
    const fullContent = header + content
    const path = await writeNovelFile(filename, fullContent)
    const wordCount = content.length

    // Auto-update novel context
    const summaryText = content.length > 500 ? content.slice(0, 500) + '...' : content
    await updateNovelContext('progress', `已完成: 第${chapter}章${title ? `《${title}》` : ''}（${wordCount}字）`)
    await appendToContextLog(`写完第${chapter}章${title ? `《${title}》` : ''}，${wordCount}字`)

    const targetNote = word_count_target
      ? `\n目标字数: ${word_count_target}，实际字数: ${wordCount}`
      : `\n实际字数: ${wordCount}`

    return {
      data: {
        success: true,
        message: `第${chapter}章已保存${targetNote}`,
        path,
        word_count: wordCount,
      },
    }
  },
  mapToolResultToToolResultBlockParam({ success, message }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: message,
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
