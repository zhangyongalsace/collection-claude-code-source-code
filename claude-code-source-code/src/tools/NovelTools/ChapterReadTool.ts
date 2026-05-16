import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CHAPTER_READ_TOOL_NAME } from './constants.js'
import { readNovelFile, listNovelFiles } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    chapter: z
      .number()
      .optional()
      .describe('要读取的章节号。不提供则列出所有章节'),
    tail: z
      .number()
      .optional()
      .describe('只读取章节最后N个字符（用于衔接上下文，节省token）。不提供则读取完整章节'),
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

export const ChapterReadTool = buildTool({
  name: CHAPTER_READ_TOOL_NAME,
  searchHint: 'read a novel chapter',
  alwaysLoad: true,
  maxResultSizeChars: 200_000,
  async description() {
    return '读取已写好的章节内容，或列出所有章节'
  },
  async prompt() {
    return `读取小说章节。

用法：
- 提供 chapter（章节号）读取指定章节
- 不提供 chapter 则列出所有已写章节
- 提供 tail=N 只读取章节最后N个字符（推荐用于衔接上下文，节省token）

写新章节前：读上一章的 tail=800 即可确保语气和节奏衔接，不需要读完整章节。
章节从 novel/chapters/ 目录读取。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '读章节'
  },
  toAutoClassifierInput(input) {
    return `第${input.chapter ?? '?'}章`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ chapter, tail }) {
    if (chapter === undefined) {
      const chapters = listNovelFiles('chapters')
      return {
        data: {
          success: true,
          message: `共 ${chapters.length} 章`,
          chapters,
        },
      }
    }

    const files = listNovelFiles('chapters')
    const match = files.find(f => f.startsWith(`第${chapter}章`))
    if (!match) {
      return { data: { success: false, message: `第${chapter}章不存在` } }
    }

    const full = await readNovelFile(`chapters/${match}`)
    if (!full) {
      return { data: { success: false, message: `第${chapter}章内容为空` } }
    }

    if (tail && tail > 0 && full.length > tail) {
      const content = full.slice(-tail)
      return { data: { success: true, message: `已读取第${chapter}章（最后${tail}字）`, content } }
    }

    return { data: { success: true, message: `已读取第${chapter}章`, content: full } }
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
