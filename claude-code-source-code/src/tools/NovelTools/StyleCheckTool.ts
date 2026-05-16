import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { STYLE_CHECK_TOOL_NAME } from './constants.js'
import { readNovelFile, listNovelFiles } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['check_character', 'check_timeline', 'check_style', 'full_report'])
      .describe('检查类型：check_character 角色一致性, check_timeline 时间线一致性, check_style 文风检查, full_report 完整报告'),
    chapter: z
      .number()
      .optional()
      .describe('要检查的章节号（不提供则检查全部）'),
    character_name: z
      .string()
      .optional()
      .describe('要检查一致性的角色名（check_character 模式使用）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    report: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const StyleCheckTool = buildTool({
  name: STYLE_CHECK_TOOL_NAME,
  searchHint: 'check novel consistency and style',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '检查小说的一致性和风格，包括角色描写、时间线逻辑、文风统一性'
  },
  async prompt() {
    return `检查小说的一致性和风格。

用法：
- action=check_character: 检查指定角色在所有章节中的描写是否一致
- action=check_timeline: 检查时间线是否有逻辑矛盾
- action=check_style: 检查文风是否统一（叙述风格、用词习惯等）
- action=full_report: 生成完整的检查报告

这个工具会收集相关文件的内容作为检查报告返回给 AI，由 AI 进行分析和判断。

建议在以下时机使用：
- 每写完5章做一次角色一致性检查
- 涉及时间跳跃时检查时间线
- 全书写完后做一次 full_report`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '一致性检查'
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.character_name ?? ''}`
  },
  async checkPermissions() {
    return { behavior: 'allow' }
  },
  renderToolUseMessage() {
    return null
  },
  async call({ action, chapter, character_name }) {
    const chapters = listNovelFiles('chapters')
    if (chapters.length === 0) {
      return { data: { success: false, message: '还没有写任何章节，无法检查' } }
    }

    if (action === 'check_character') {
      const charName = character_name ?? '未知'
      const charFile = await readNovelFile(`characters/${charName}.md`)
      if (!charFile) {
        return { data: { success: false, message: `角色 "${charName}" 的设定文件不存在` } }
      }

      let report = `# 角色一致性检查：${charName}\n\n## 角色设定\n\n${charFile}\n\n## 各章节中出现的内容\n\n`
      for (const file of chapters) {
        const content = (await readNovelFile(`chapters/${file}`)) ?? ''
        const lines = content.split('\n').filter(l => l.includes(charName))
        if (lines.length > 0) {
          report += `### ${file}\n${lines.join('\n')}\n\n`
        }
      }
      report += `\n请根据以上信息，检查 "${charName}" 在各章节中的描写是否与设定一致，是否有前后矛盾之处。`
      return { data: { success: true, message: `角色一致性检查报告已生成`, report } }
    }

    if (action === 'check_timeline') {
      const timeline = (await readNovelFile('timeline.md')) ?? '时间线为空'
      let report = `# 时间线一致性检查\n\n## 已记录的时间线\n\n${timeline}\n\n## 各章节摘要\n\n`
      for (const file of chapters) {
        const content = (await readNovelFile(`chapters/${file}`)) ?? ''
        const first5Lines = content.split('\n').slice(0, 5).join('\n')
        report += `### ${file}\n${first5Lines}\n...\n\n`
      }
      report += `\n请检查各章节的事件顺序是否与时间线记录一致，是否有时间矛盾。`
      return { data: { success: true, message: '时间线检查报告已生成', report } }
    }

    if (action === 'check_style') {
      const targetFiles = chapter
        ? chapters.filter(f => f.startsWith(`第${chapter}章`))
        : chapters
      let report = `# 文风一致性检查\n\n`
      for (const file of targetFiles) {
        const content = (await readNovelFile(`chapters/${file}`)) ?? ''
        report += `## ${file}\n${content.substring(0, 500)}...\n\n`
      }
      report += `\n请检查以上章节的文风是否统一，包括：叙述人称、用词习惯、描写风格、对话风格。`
      return { data: { success: true, message: '文风检查报告已生成', report } }
    }

    if (action === 'full_report') {
      const worlds = listNovelFiles('world')
      const characters = listNovelFiles('characters')
      const plots = listNovelFiles('plots')
      const outlines = listNovelFiles('outlines')
      const timeline = (await readNovelFile('timeline.md')) ?? '无'

      let report = `# 小说完整检查报告\n\n`
      report += `## 统计\n- 世界观设定: ${worlds.length} 个\n- 角色: ${characters.length} 个\n- 情节线: ${plots.length} 条\n- 章节大纲: ${outlines.length} 个\n- 已写章节: ${chapters.length} 章\n- 时间线: ${timeline !== '无' ? '已建立' : '未建立'}\n\n`
      report += `## 已写章节概览\n\n`
      for (const file of chapters) {
        const content = (await readNovelFile(`chapters/${file}`)) ?? ''
        report += `### ${file} (${content.length} 字)\n${content.substring(0, 200)}...\n\n`
      }
      report += `\n请给出整体评价和改进建议。`
      return { data: { success: true, message: '完整检查报告已生成', report } }
    }

    return { data: { success: false, message: `未知操作: ${action}` } }
  },
  mapToolResultToToolResultBlockParam({ success, message, report }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: success && report
        ? `${message}\n\n${report}`
        : message,
    }
  },
} satisfies ToolDef<InputSchema, OutputSchema>)
