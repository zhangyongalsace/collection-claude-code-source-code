import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CHARACTER_TOOL_NAME } from './constants.js'
import { buildMarkdownContent, readNovelFile, writeNovelFile, deleteNovelFile, listNovelFiles, updateNovelContext, appendToContextLog } from './novelUtils.js'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['create', 'update', 'read', 'delete', 'list', 'search', 'personality', 'dialogue_sample'])
      .describe('操作类型：create 创建, update 更新, read 读取, delete 删除, list 列表, search 搜索, personality 生成性格深度分析, dialogue_sample 生成对话示例'),
    name: z
      .string()
      .optional()
      .describe('角色名称'),
    fields: z
      .record(z.string())
      .optional()
      .describe('角色属性。创建时建议包含以下核心维度'),
    keyword: z
      .string()
      .optional()
      .describe('搜索关键词（用于 search 操作）'),
    scene_context: z
      .string()
      .optional()
      .describe('对话场景描述（用于 dialogue_sample，如"在酒馆被陌生人挑衅时"）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
    characters: z.array(z.string()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const CharacterTool = buildTool({
  name: CHARACTER_TOOL_NAME,
  searchHint: 'create and manage novel characters with vivid personalities',
  alwaysLoad: true,
  maxResultSizeChars: 100_000,
  async description() {
    return '管理小说角色，支持性格深度塑造、对话风格生成、角色一致性检查'
  },
  async prompt() {
    return `管理小说角色系统——塑造鲜明的人物性格。

## 基本操作
- action=create: 创建新角色，需要提供 name 和 fields
- action=update: 更新角色信息
- action=read: 读取角色完整信息
- action=delete: 删除角色
- action=list: 列出所有角色
- action=search: 按关键词搜索角色
- action=personality: 生成角色的深度性格分析（基于已有信息）
- action=dialogue_sample: 生成角色的对话风格示例（需要 scene_context）

## 创建角色时的推荐字段

创建角色时，建议在 fields 中包含以下**核心维度**来塑造立体人格：

**基础层（必填）：**
- 性格核心：用3-5个形容词概括（如"偏执、敏感、极度自律"）
- 表面人格：他人眼中的样子（如"温和有礼的邻家大哥"）
- 真实内核：面具下的真实自我（如"控制欲极强的偏执狂"）

**冲突层（必填）：**
- 内心矛盾：角色最核心的内心冲突（如"渴望被爱 vs 害怕亲近"）
- 致命弱点：会导致角色犯错的性格缺陷
- 底线：角色绝不会做的事（反过来也是——什么情况下会打破底线）

**行为层（推荐）：**
- 说话风格：语气、用词习惯、句式特点（如"短句为主，不喜寒暄，冷幽默"）
- 标志性动作：紧张/愤怒/开心时的下意识动作
- 口头禅：角色的代表性台词或常用语

**关系层（推荐）：**
- 对上级/长辈的态度
- 对下属/晚辈的态度
- 对朋友的态度
- 对敌人的态度
- 恋爱观

**成长层（推荐）：**
- 童年创伤/关键经历
- 最大的恐惧
- 最深的渴望
- 人物弧线方向（角色会如何变化）

## personality 操作
对已有角色生成深度性格分析，会自动补充以下内容：
- MBTI/九型人格参考（仅作辅助参考）
- 性格形成原因分析
- 压力反应模式
- 与其他角色的化学反应预测

## dialogue_sample 操作
为角色生成特定场景下的对话示例，帮助确立说话风格。需要提供 scene_context。
示例：scene_context="得知最好的朋友背叛了自己时"

角色信息保存到 novel/characters/ 目录。写章节时务必参考相关角色档案以保持性格一致。`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return '角色管理'
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
  async call({ action, name, fields, keyword, scene_context }) {
    if (action === 'list') {
      const characters = listNovelFiles('characters')
      return {
        data: {
          success: true,
          message: `共 ${characters.length} 个角色`,
          characters,
        },
      }
    }

    if (action === 'search') {
      const characters = listNovelFiles('characters')
      const results: string[] = []
      const term = keyword ?? ''
      for (const file of characters) {
        const content = await readNovelFile(`characters/${file}`)
        if (content && content.includes(term)) {
          results.push(file.replace('.md', ''))
        }
      }
      return {
        data: {
          success: true,
          message: `找到 ${results.length} 个匹配的角色`,
          characters: results,
        },
      }
    }

    if (!name) {
      return { data: { success: false, message: '需要提供角色名称 (name)' } }
    }

    const filename = `characters/${name}.md`

    if (action === 'read') {
      const content = await readNovelFile(filename)
      if (!content) {
        return { data: { success: false, message: `角色 "${name}" 不存在` } }
      }
      return { data: { success: true, message: `已读取角色 "${name}"`, content } }
    }

    if (action === 'delete') {
      const deleted = deleteNovelFile(filename)
      if (!deleted) {
        return { data: { success: false, message: `角色 "${name}" 不存在` } }
      }
      await appendToContextLog(`删除角色: ${name}`)
      return { data: { success: true, message: `角色 "${name}" 已删除` } }
    }

    if (action === 'personality') {
      const existing = await readNovelFile(filename)
      if (!existing) {
        return { data: { success: false, message: `角色 "${name}" 不存在，请先创建` } }
      }
      const personalitySection = `

## 性格深度分析（自动生成）

### 性格形成原因
（根据角色的背景经历，分析其性格形成的深层原因）

### 压力反应模式
- 轻度压力：角色的第一反应
- 中度压力：行为模式变化
- 极端压力：崩溃或爆发的方式

### 社交面具 vs 真实自我
（角色的社交策略与内心真实想法的差异）

### 情感触发点
- 什么会让角色瞬间失控
- 什么会让角色展露脆弱
- 什么会让角色做出反常举动

### 与典型角色的化学反应
（基于现有角色列表，预测互动模式）

---
⚠️ 以上为框架提示，请在创作中根据角色具体信息填充内容。
`
      const updated = existing + personalitySection
      await writeNovelFile(filename, updated)
      await appendToContextLog(`生成角色性格分析: ${name}`)
      return { data: { success: true, message: `已为 "${name}" 生成性格深度分析框架`, content: updated } }
    }

    if (action === 'dialogue_sample') {
      const existing = await readNovelFile(filename)
      if (!existing) {
        return { data: { success: false, message: `角色 "${name}" 不存在，请先创建` } }
      }
      const ctx = scene_context || '日常闲聊'
      const dialogueSection = `

## 对话风格示例

**场景：${ctx}**

> （请根据角色的说话风格、口癖、性格核心，在此场景下写出3-5句代表性对话）
>
> 示例格式：
> "${name}：……"
> 旁人："……"
> "${name}：……"

---
⚠️ 以上为对话风格引导，请在创作中根据角色档案生成具体对话。
`
      const updated = existing + dialogueSection
      await writeNovelFile(filename, updated)
      await appendToContextLog(`生成角色对话示例: ${name}（场景：${ctx}）`)
      return { data: { success: true, message: `已为 "${name}" 在场景"${ctx}"下生成对话风格引导`, content: updated } }
    }

    if (action === 'create') {
      if (!fields) {
        return { data: { success: false, message: '创建角色需要提供 fields 属性。建议包含：性格核心、表面人格、真实内核、内心矛盾、致命弱点等维度' } }
      }
      const content = buildMarkdownContent(`角色：${name}`, fields)
      await writeNovelFile(filename, content)
      await appendToContextLog(`创建角色: ${name}（${fields['性格核心'] ?? fields['性格'] ?? '未标注性格'}）`)
      return { data: { success: true, message: `角色 "${name}" 已创建`, content } }
    }

    if (action === 'update') {
      const existing = (await readNovelFile(filename)) ?? ''
      const merged = fields
        ? existing + '\n\n' + buildMarkdownContent('更新', fields)
        : existing
      await writeNovelFile(filename, merged)
      await appendToContextLog(`更新角色信息: ${name}`)
      return { data: { success: true, message: `角色 "${name}" 已更新`, content: merged } }
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
