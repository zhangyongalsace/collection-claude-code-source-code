import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { TIMELINE_TOOL_NAME } from './constants.js'
import { readNovelFile, writeNovelFile } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['add_event', 'read', 'read_range'])
      .describe('操作类型：add_event 添加事件, read 读取完整时间线, read_range 读取某个时间段'),
    time_label: z
      .string()
      .optional()
      .describe('时间标签，如"第一章"、"第三天"、"修炼一年后"'),
    event: z
      .string()
      .optional()
      .describe('事件描述'),
    characters: z
      .array(z.string())
      .optional()
      .describe('涉及的角色列表'),
    note: z
      .string()
      .optional()
      .describe('备注（伏笔、需要注意的细节等）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const TimelineTool = buildTool({
  name: TIMELINE_TOOL_NAME,
  searchHint: 'manage novel timeline and events',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '管理小说的时间线，记录事件发生顺序，确保时间逻辑一致'
  },
  async prompt() {
    return `管理小说时间线系统。

用法：
- action=add_event: 添加一个时间线事件
- action=read: 读取完整时间线
- action=read_range: 读取某个时间段的事件

时间线用于：
- 确保故事时间逻辑一致（避免时间矛盾）
- 追踪并行事件（同一时间不同角色的经历）
- 管理伏笔的埋设和揭开时机

每次写新章节前，建议先查看时间线确认当前时间节点。
时间线保存到 novel/timeline.md 文件中。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '时间线管理'
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.time_label ?? ''}`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ action, time_label, event, characters, note }) {
    const filename = 'timeline.md'

    if (action === 'read') {
      const content = await readNovelFile(filename)
      if (!content) {
        return { data: { success: true, message: '时间线为空，尚未添加任何事件' } }
      }
      return { data: { success: true, message: '当前时间线', content } }
    }

    if (action === 'read_range') {
      const content = await readNovelFile(filename)
      if (!content || !time_label) {
        const result = content ?? null
        return { data: { success: true, message: content ? '当前时间线' : '时间线为空', content: result ?? undefined } }
      }
      const lines = content.split('\n')
      const matches = lines.filter(l => l.includes(time_label))
      if (matches.length === 0) {
        return { data: { success: true, message: `未找到包含"${time_label}"的时间线事件`, content } }
      }
      return { data: { success: true, message: `包含"${time_label}"的时间线事件`, content: matches.join('\n') } }
    }

    if (action === 'add_event') {
      if (!time_label || !event) {
        return { data: { success: false, message: '添加事件需要提供 time_label 和 event' } }
      }
      const existing = (await readNovelFile(filename)) ?? '# 小说时间线\n\n'
      const charStr = characters?.length ? ` | 角色: ${characters.join(', ')}` : ''
      const noteStr = note ? `\n  > 备注: ${note}` : ''
      const entry = `- **${time_label}**: ${event}${charStr}${noteStr}\n`
      await writeNovelFile(filename, existing + entry)
      return { data: { success: true, message: `已添加时间线事件: ${time_label}` } }
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
