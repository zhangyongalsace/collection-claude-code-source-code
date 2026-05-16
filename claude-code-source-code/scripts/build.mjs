#!/usr/bin/env node
/**
 * build.mjs — Best-effort build of Claude Code v2.1.88 from source
 *
 * ⚠️  IMPORTANT: A complete rebuild requires the Bun runtime's compile-time
 *     intrinsics (feature(), MACRO, bun:bundle). This script provides a
 *     best-effort build using esbuild. See KNOWN_ISSUES.md for details.
 *
 * What this script does:
 *   1. Copy src/ → build-src/ (original untouched)
 *   2. Replace `feature('X')` → `false`  (compile-time → runtime)
 *   3. Replace `MACRO.VERSION` etc → string literals
 *   4. Replace `import from 'bun:bundle'` → stub
 *   5. Create stubs for missing feature-gated modules
 *   6. Bundle with esbuild → dist/cli.js
 *
 * Requirements: Node.js >= 18, npm
 * Usage:       node scripts/build.mjs
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '2.1.88'
const BUILD = join(ROOT, 'build-src')
const ENTRY = join(BUILD, 'entry.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules') yield* walk(p)
    else yield p
  }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

// Check if a TypeScript source exists for a .js import path (esbuild resolves .js → .ts)
async function hasTsSource(dir, mod) {
  if (mod.endsWith('.js')) {
    const base = mod.slice(0, -3)
    for (const ext of ['.ts', '.tsx']) {
      if (await exists(join(BUILD, dir, base + ext))) return true
    }
  }
  return false
}

async function ensureEsbuild() {
  try { execSync('npx esbuild --version', { stdio: 'pipe' }) }
  catch {
    console.log('📦 Installing esbuild...')
    execSync('npm install --save-dev esbuild', { cwd: ROOT, stdio: 'inherit' })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Copy source
// ══════════════════════════════════════════════════════════════════════════════

await rm(BUILD, { recursive: true, force: true })
await mkdir(BUILD, { recursive: true })
await cp(join(ROOT, 'src'), join(BUILD, 'src'), { recursive: true })
// Copy stubs/ so "../stubs/bun-bundle.js" imports resolve from build-src/src/
if (await exists(join(ROOT, 'stubs'))) {
  await cp(join(ROOT, 'stubs'), join(BUILD, 'stubs'), { recursive: true })
}
// Create tsconfig.json in build-src so esbuild resolves "src/*" paths
// relative to build-src/, not the original src/
const buildTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: false,
    skipLibCheck: true,
    resolveJsonModule: true,
    jsx: 'react-jsx',
    baseUrl: '.',
    paths: {
      'src/*': ['src/*']
    }
  },
  include: ['src/**/*', 'stubs/**/*']
}
await writeFile(join(BUILD, 'tsconfig.json'), JSON.stringify(buildTsconfig, null, 2), 'utf8')
console.log('✅ Phase 1: Copied src/ → build-src/')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Transform source
// ══════════════════════════════════════════════════════════════════════════════

let transformCount = 0

// MACRO replacements
const MACROS = {
  'MACRO.VERSION': `'${VERSION}'`,
  'MACRO.BUILD_TIME': `''`,
  'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.VERSION_CHANGELOG': `''`,
}

for await (const file of walk(join(BUILD, 'src'))) {
  if (!file.match(/\.[tj]sx?$/)) continue

  let src = await readFile(file, 'utf8')
  let changed = false

  // 2a. feature('X') → false
  if (/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/.test(src)) {
    src = src.replace(/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/g, 'false')
    changed = true
  }

  // 2b. MACRO.X → literals
  for (const [k, v] of Object.entries(MACROS)) {
    if (src.includes(k)) {
      src = src.replaceAll(k, v)
      changed = true
    }
  }

  // 2c. Remove bun:bundle import (feature() is already replaced)
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/g, '// feature() replaced with false at build time\n')
    changed = true
  }

  // 2c2. Convert bare 'src/...' imports to relative paths (tsconfig paths don't work at runtime)
  // The tsconfig alias 'src/*' resolves relative to build-src/, but files are already
  // inside build-src/src/, so we need depth relative to build-src/src/, not build-src/.
  if (src.includes("from 'src/") || src.includes('from "src/')) {
    const fullRel = dirname(file.replace(/\\/g, '/').replace(/.*build-src\//, ''))
    // fullRel is like 'src/bootstrap' — strip the 'src/' prefix to get path within src/
    const subPath = fullRel === 'src' ? '' : fullRel.startsWith('src/') ? fullRel.slice(4) : fullRel
    const depth = subPath === '' ? './' : subPath.split('/').filter(Boolean).map(() => '../').join('')
    src = src.replace(/(from\s+['"])src\//g, `$1${depth}`)
    changed = true
  }

  // 2d. Remove type-only import of global.d.ts
  if (src.includes("import '../global.d.ts'") || src.includes("import './global.d.ts'")) {
    src = src.replace(/import\s*['"][.\/]*global\.d\.ts['"];?\n?/g, '')
    changed = true
  }

  // 2e. Strip dead require() in false-ternary (feature() → false dead code)
  // Pattern: false ? (require('...') as Type).prop : null  →  null
  // Pattern: false ? require('...') : null  →  null
  if (/\bfalse\s*\?/.test(src) && /\brequire\s*\(/.test(src)) {
    // Replace: false ? <anything with require> : <fallback>
    src = src.replace(
      /\bfalse\s*\?\s*\(?\s*require\s*\([^)]*\)[^?:]*?\)?\s*:\s*/g,
      ''
    )
    changed = true
  }

  if (changed) {
    await writeFile(file, src, 'utf8')
    transformCount++
  }
}
console.log(`✅ Phase 2: Transformed ${transformCount} files`)

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2.5: Patch missing exports in source files
// ══════════════════════════════════════════════════════════════════════════════

const MISSING_EXPORTS = {
  'src/utils/settings/types.ts': ['SettingsSchema', 'HooksSchema'],
  'src/bootstrap/state.ts': ['isReplBridgeActive'],
  'src/services/mcp/types.ts': ['McpServerConfigSchema'],
  'src/tasks/InProcessTeammateTask/types.ts': ['isInProcessTeammateTask', 'appendCappedMessage'],
  'src/tasks/types.ts': ['isBackgroundTask'],
}

let patchCount = 0
for (const [relPath, names] of Object.entries(MISSING_EXPORTS)) {
  const filePath = join(BUILD, relPath)
  if (!await exists(filePath)) continue
  let content = await readFile(filePath, 'utf8')
  const toAdd = names.filter(n => !content.match(new RegExp(`\\bexport\\b[^;]*\\b${n}\\b`)))
  if (toAdd.length > 0) {
    content += '\n// Auto-added missing exports\n' + toAdd.map(n => `export const ${n} = (() => {}) as any`).join('\n') + '\n'
    await writeFile(filePath, content, 'utf8')
    patchCount += toAdd.length
  }
}
if (patchCount > 0) {
  console.log(`✅ Phase 2.5: Added ${patchCount} missing exports`)
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Create entry wrapper
// ══════════════════════════════════════════════════════════════════════════════

await writeFile(ENTRY, `// Claude Code v${VERSION} — built from source
// Copyright (c) Anthropic PBC. All rights reserved.
import './src/entrypoints/cli.tsx'
`, 'utf8')
console.log('✅ Phase 3: Created entry wrapper')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Iterative stub + bundle
// ══════════════════════════════════════════════════════════════════════════════

await ensureEsbuild()

const OUT_DIR = join(ROOT, 'dist')
await mkdir(OUT_DIR, { recursive: true })
const OUT_FILE = join(OUT_DIR, 'cli.js')

// Collect external modules across rounds (npm packages that can't be stubbed)
const externalModules = new Set()

// Run up to 5 rounds of: esbuild → collect missing → create stubs/externalize → retry
const MAX_ROUNDS = 10
let succeeded = false

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.log(`\n🔨 Phase 4 round ${round}/${MAX_ROUNDS}: Bundling...`)

  const BANNER = `#!/usr/bin/env node\n// Claude Code v${VERSION} (built from source)\n// Copyright (c) Anthropic PBC. All rights reserved.\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);\n`
  const externalFlags = [...externalModules].map(m => `--external:${m}`)
  let esbuildOutput = ''
  try {
    esbuildOutput = execSync([
      'npx esbuild',
      `"${ENTRY}"`,
      '--bundle',
      '--platform=node',
      '--target=node18',
      '--format=esm',
      `--outfile="${OUT_FILE}"`,
      '--loader:.md=text',
      '--external:bun:*',
      '--external:color-diff-napi',
      '--external:@ant/*',
      ...externalFlags,
      '--allow-overwrite',
      '--log-level=error',
      '--log-limit=0',
      '--sourcemap',
    ].join(' '), {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    }).stderr?.toString() || ''
    // Prepend banner to output file (cross-platform, avoids $'' bash syntax)
    const original = await readFile(OUT_FILE, 'utf8')
    await writeFile(OUT_FILE, BANNER + original, 'utf8')
    succeeded = true
    break
  } catch (e) {
    esbuildOutput = (e.stderr?.toString() || '') + (e.stdout?.toString() || '')
  }

  // Parse missing module names
  const missingSet = new Set()
  const missingRe = /Could not resolve "([^"]+)"/g
  let m
  while ((m = missingRe.exec(esbuildOutput)) !== null) {
    const mod = m[1]
    if (!mod.startsWith('node:') && !mod.startsWith('bun:') && !mod.startsWith('/')) {
      missingSet.add(mod)
    }
  }

  if (missingSet.size === 0) {
    // Dump raw output for debugging
    const dumpPath = join(ROOT, 'esbuild-errors.txt')
    await writeFile(dumpPath, esbuildOutput, 'utf8')

    // Check for "No matching export" errors - use non-greedy match on non-space chars
    const exportErrRe = /No matching export in (\S+) for import (\S+)/g
    const exportFixes = new Map() // file -> Set of missing exports
    let em
    while ((em = exportErrRe.exec(esbuildOutput)) !== null) {
      let [, file, name] = em
      // Strip surrounding quotes/curly quotes
      file = file.replace(/^[""“”]+|[""“”]+$/g, '')
      name = name.replace(/^[""“”]+|[""“”]+$/g, '')
      if (!exportFixes.has(file)) exportFixes.set(file, new Set())
      exportFixes.get(file).add(name)
    }

    if (exportFixes.size > 0) {
      console.log(`   Found ${exportFixes.size} files with missing exports, patching...`)
      let patchCount = 0
      for (const [file, names] of exportFixes) {
        // Resolve the file path within build-src
        let filePath = file.replace(/\\/g, '/')
        if (!filePath.includes('build-src/')) {
          filePath = join(BUILD, 'src', filePath.replace(/^src\//, ''))
        } else {
          filePath = file
        }
        // Also try with .ts extension (esbuild resolves .js → .ts)
        const candidates = [filePath, filePath.replace(/\.js$/, '.ts'), filePath.replace(/\.js$/, '.tsx')]
        let resolvedPath = null
        for (const c of candidates) {
          if (await exists(c)) { resolvedPath = c; break }
        }
        if (resolvedPath) {
          let content = await readFile(resolvedPath, 'utf8')
          const toAdd = [...names].filter(n => !content.match(new RegExp(`\\bexport\\b[^;]*\\b${n}\\b`)))
          if (toAdd.length > 0) {
            content += '\n' + toAdd.map(n => `export const ${n} = () => {}`).join('\n') + '\n'
            await writeFile(resolvedPath, content, 'utf8')
          }
          patchCount++
        }
      }
      console.log(`   Patched ${patchCount} files with missing exports`)
      continue
    }

    console.log(`   No export errors matched (raw output dumped to esbuild-errors.txt)`)
    const errLines = esbuildOutput.split('\n').filter(l => l.includes('ERROR')).slice(0, 10)
    console.log('❌ Unrecoverable errors:')
    errLines.forEach(l => console.log('   ' + l))
    break
  }

  console.log(`   Found ${missingSet.size} missing modules`)

  // If stubs didn't help in previous round, externalize remaining npm packages only
  // Don't externalize relative paths - they won't resolve at runtime from dist/
  if (round >= 2) {
    const mods = [...missingSet]
    console.log(`   Externalizing remaining npm packages... (persisting: ${mods.filter(m => m.startsWith('./') || m.startsWith('../')).join(', ')})`)
    for (const mod of missingSet) {
      const isRelative = mod.startsWith('./') || mod.startsWith('../')
      if (!isRelative && !mod.startsWith('src/')) {
        externalModules.add(mod)
      }
    }
    // For remaining relative modules, try harder to create stubs
    const importToDirs2 = new Map()
    const importRe2 = /(?:from|require|import)\s*\(?['"`](\.{1,2}[^'"`]+)['"`]/g
    for await (const file of walk(join(BUILD, 'src'))) {
      if (!file.match(/\.[tj]sx?$/)) continue
      let content
      try { content = await readFile(file, 'utf8') } catch { continue }
      const fileRel = file.replace(/\\/g, '/').replace(/.*build-src\//, '')
      const fileDir = dirname(fileRel)
      let match
      importRe2.lastIndex = 0
      while ((match = importRe2.exec(content)) !== null) {
        const imp = match[1]
        if (missingSet.has(imp)) {
          if (!importToDirs2.has(imp)) importToDirs2.set(imp, new Set())
          importToDirs2.get(imp).add(fileDir)
        }
      }
    }
    let stubCount2 = 0
    for (const mod of missingSet) {
      const isRelative = mod.startsWith('./') || mod.startsWith('../')
      if (!isRelative) continue
      const dirs = importToDirs2.get(mod) || new Set(['src'])
      for (const d of dirs) {
        const p = join(BUILD, d, mod)
        if (await exists(p)) continue
        if (await hasTsSource(d, mod)) continue
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        const content = mod.endsWith('.md') || mod.endsWith('.txt') ? '' : 'export default {}\n'
        await writeFile(p, content, 'utf8')
        stubCount2++
      }
    }
    if (stubCount2 > 0) console.log(`   Created ${stubCount2} additional stubs`)
    continue
  }

  // Build reverse import map: scan all source files to find where each module is imported
  // This is more reliable than parsing esbuild's error format
  const importToDirs = new Map() // module string -> Set of dirs (relative to BUILD)
  const importRe = /(?:from|require)\s*\(?\s*['"](\.{1,2}[^'"]+\.js)['"]/g
  for await (const file of walk(join(BUILD, 'src'))) {
    if (!file.match(/\.[tj]sx?$/)) continue
    let content
    try { content = await readFile(file, 'utf8') } catch { continue }
    // Normalize path separators for matching
    const fileRel = file.replace(/\\/g, '/').replace(/.*build-src\//, '')
    const fileDir = dirname(fileRel)
    let match
    importRe.lastIndex = 0
    while ((match = importRe.exec(content)) !== null) {
      const imp = match[1]
      if (missingSet.has(imp)) {
        if (!importToDirs.has(imp)) importToDirs.set(imp, new Set())
        importToDirs.get(imp).add(fileDir)
      }
    }
  }

  // Create stubs at correct locations and externalize npm packages
  let stubCount = 0
  for (const mod of missingSet) {
    const isRelative = mod.startsWith('./') || mod.startsWith('../')

    if (/\.(txt|md)$/.test(mod)) {
      // Text assets
      const dirs = importToDirs.get(mod) || new Set(['src'])
      for (const d of dirs) {
        const p = join(BUILD, d, mod)
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        if (!await exists(p)) {
          await writeFile(p, '', 'utf8')
          stubCount++
        }
      }
      continue
    }

    if (mod.endsWith('.json')) {
      const dirs = importToDirs.get(mod) || new Set(['src'])
      for (const d of dirs) {
        const p = join(BUILD, d, mod)
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        if (!await exists(p)) {
          await writeFile(p, '{}', 'utf8')
          stubCount++
        }
      }
      continue
    }

    if (isRelative) {
      const dirs = importToDirs.get(mod) || new Set()
      if (dirs.size === 0) {
        // Fallback: try common locations
        dirs.add('src')
      }
      for (const d of dirs) {
        const p = join(BUILD, d, mod)
        if (await exists(p)) continue
        // Skip creating .js stub if a .ts/.tsx source exists (esbuild resolves .js → .ts)
        if (await hasTsSource(d, mod)) continue
        // Create stub with the exact extension from the import path (.js, .ts, etc.)
        await mkdir(dirname(p), { recursive: true }).catch(() => {})
        await writeFile(p, `// Auto-generated stub for ${mod}\nexport default {}\n`, 'utf8')
        stubCount++
      }
    } else {
      externalModules.add(mod)
    }
  }
  console.log(`   Created ${stubCount} stubs, externalized ${externalModules.size} npm packages`)
}

if (succeeded) {
  const size = (await stat(OUT_FILE)).size
  console.log(`\n✅ Build succeeded: ${OUT_FILE}`)
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  console.log(`\n   Usage:  node ${OUT_FILE} --version`)
  console.log(`           node ${OUT_FILE} -p "Hello"`)
} else {
  console.error('\n❌ Build failed after all rounds.')
  console.error('   The transformed source is in build-src/ for inspection.')
  console.error('\n   To fix manually:')
  console.error('   1. Check build-src/ for the transformed files')
  console.error('   2. Create missing stubs in build-src/src/')
  console.error('   3. Re-run: node scripts/build.mjs')
  process.exit(1)
}
