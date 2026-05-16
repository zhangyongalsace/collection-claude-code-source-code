import { existsSync, mkdirSync, readdirSync } from 'fs'
import { unlinkSync } from 'fs'
import { readFile, writeFile, appendFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { NOVEL_BASE_DIR } from './constants.js'

export function getNovelDir(...subpaths: string[]): string {
  const base = join(getCwd(), NOVEL_BASE_DIR, ...subpaths)
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  return base
}

export async function readNovelFile(relativePath: string): Promise<string | null> {
  const fullPath = join(getCwd(), NOVEL_BASE_DIR, relativePath)
  if (!existsSync(fullPath)) return null
  return readFile(fullPath, 'utf-8')
}

export async function writeNovelFile(relativePath: string, content: string): Promise<string> {
  const fullPath = join(getCwd(), NOVEL_BASE_DIR, relativePath)
  const dir = dirname(fullPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  await writeFile(fullPath, content, 'utf-8')
  return fullPath
}

export function deleteNovelFile(relativePath: string): boolean {
  const fullPath = join(getCwd(), NOVEL_BASE_DIR, relativePath)
  if (!existsSync(fullPath)) return false
  unlinkSync(fullPath)
  return true
}

export function listNovelFiles(subdir: string): string[] {
  const dir = getNovelDir(subdir)
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
}

export function buildMarkdownContent(title: string, sections: Record<string, string>): string {
  let content = `# ${title}\n\n`
  for (const [heading, body] of Object.entries(sections)) {
    content += `## ${heading}\n\n${body}\n\n`
  }
  return content
}

// ── Novel Context Auto-Update ──

const CONTEXT_FILE = 'CONTEXT.md'

export async function readNovelContext(): Promise<string | null> {
  return readNovelFile(CONTEXT_FILE)
}

export async function updateNovelContext(
  section: 'style' | 'summary' | 'progress' | 'constraints',
  content: string,
): Promise<string> {
  const existing = await readNovelContext()
  if (!existing) {
    const initial = `# 小说上下文\n\n> 此文件由系统自动维护，记录当前创作状态\n\n## 当前文风\n\n现代文学白话文\n\n## 前文概要\n\n（尚无内容）\n\n## 创作进度\n\n（尚未开始）\n\n## 情节约束\n\n（无特殊约束）\n`
    await writeNovelFile(CONTEXT_FILE, initial)
  }

  const current = await readNovelContext() || ''
  const sectionMap: Record<string, string> = {
    style: '## 当前文风',
    summary: '## 前文概要',
    progress: '## 创作进度',
    constraints: '## 情节约束',
  }
  const marker = sectionMap[section]
  if (!marker) return current

  const nextMarker = Object.values(sectionMap)
    .filter(m => m !== marker)
    .sort()
    .find(m => current.indexOf(m) > current.indexOf(marker))

  const startIdx = current.indexOf(marker)
  if (startIdx === -1) return current

  const endIdx = nextMarker ? current.indexOf(nextMarker, startIdx + marker.length) : current.length

  const updated = current.slice(0, startIdx) + `${marker}\n\n${content}\n\n` + current.slice(endIdx)
  await writeNovelFile(CONTEXT_FILE, updated)
  return updated
}

export async function appendToContextLog(entry: string): Promise<void> {
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const line = `- [${timestamp}] ${entry}\n`
  const fullPath = join(getCwd(), NOVEL_BASE_DIR, 'CHANGELOG.md')
  const dir = dirname(fullPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(fullPath)) {
    await writeFile(fullPath, `# 创作日志\n\n${line}`, 'utf-8')
  } else {
    await appendFile(fullPath, line, 'utf-8')
  }
}
