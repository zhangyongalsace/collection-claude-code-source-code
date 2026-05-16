import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CHAPTER_EDIT_TOOL_NAME } from './constants.js'
import { readNovelFile, writeNovelFile, listNovelFiles } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    chapter: z
      .number()
      .describe('要编辑的章节号'),
    action: z
      .enum(['replace', 'append', 'prepend', 'rewrite'])
      .describe('编辑方式：replace 替换全文, append 在末尾追加, prepend 在开头插入, rewrite 用新内容完全覆盖'),
    old_text: z
      .string()
      .optional()
      .describe('要替换的原文（replace 模式必填）'),
    new_text: z
      .string()
      .optional()
      .describe('替换后的新文本（replace 模式必填）'),
    content: z
      .string()
      .optional()
      .describe('要追加/插入/覆盖的内容（append/prepend/rewrite 模式必填）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    word_count: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ChapterEditTool = buildTool({
  name: CHAPTER_EDIT_TOOL_NAME,
  searchHint: 'edit an existing novel chapter',
  alwaysLoad: true,
  maxResultSizeChars: 200_000,
  async description() {
    return '编辑已有的章节内容，支持替换、追加、插入和重写'
  },
  async prompt() {
    return `编辑已有章节。

用法：
- action=replace: 局部替换，需要 old_text 和 new_text
- action=append: 在章节末尾追加内容
- action=prepend: 在章节开头插入内容
- action=rewrite: 用新内容完全覆盖整个章节

修改后自动保存。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '改章节'
  },
  toAutoClassifierInput(input) {
    return `编辑第${input.chapter}章 ${input.action}`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ chapter, action, old_text, new_text, content }) {
    const files = listNovelFiles('chapters')
    const match = files.find(f => f.startsWith(`第${chapter}章`))
    if (!match) {
      return { data: { success: false, message: `第${chapter}章不存在，请先用 ChapterWrite 创建` } }
    }

    const filename = `chapters/${match}`
    const existing = (await readNovelFile(filename)) ?? ''

    if (action === 'replace') {
      if (!old_text || !new_text) {
        return { data: { success: false, message: 'replace 模式需要提供 old_text 和 new_text' } }
      }
      if (!existing.includes(old_text)) {
        return { data: { success: false, message: '未找到要替换的原文' } }
      }
      const updated = existing.replaceAll(old_text, new_text)
      await writeNovelFile(filename, updated)
      return { data: { success: true, message: `第${chapter}章已修改`, word_count: updated.length } }
    }

    if (action === 'append') {
      if (!content) {
        return { data: { success: false, message: 'append 模式需要提供 content' } }
      }
      const updated = existing + '\n\n' + content
      await writeNovelFile(filename, updated)
      return { data: { success: true, message: `第${chapter}章已追加内容`, word_count: updated.length } }
    }

    if (action === 'prepend') {
      if (!content) {
        return { data: { success: false, message: 'prepend 模式需要提供 content' } }
      }
      const lines = existing.split('\n')
      const header = lines.slice(0, 2).join('\n')
      const body = lines.slice(2).join('\n')
      const updated = header + '\n\n' + content + '\n\n' + body
      await writeNovelFile(filename, updated)
      return { data: { success: true, message: `第${chapter}章已插入内容`, word_count: updated.length } }
    }

    if (action === 'rewrite') {
      if (!content) {
        return { data: { success: false, message: 'rewrite 模式需要提供 content' } }
      }
      const header = existing.split('\n').slice(0, 2).join('\n')
      const updated = header + '\n\n' + content
      await writeNovelFile(filename, updated)
      return { data: { success: true, message: `第${chapter}章已重写`, word_count: updated.length } }
    }

    return { data: { success: false, message: `未知操作: ${action}` } }
  },
  mapToolResultToToolResultBlockParam({ success, message }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: message,
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
