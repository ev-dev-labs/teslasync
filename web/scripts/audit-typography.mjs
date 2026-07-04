#!/usr/bin/env node
/**
 * Typography audit (Typography loop).
 *
 * Enforces the consistency + legibility contract from
 * `.github/prompts/typography/0000-typography-system.md` §2:
 * every piece of text must render through the shared typography tokens /
 * primitives and the theme text-color vars, so the user's font / size /
 * weight / spacing choices (and every theme) apply app-wide.
 *
 * Flags the §2 auto-fail patterns:
 *   - arbitrary sized text / leading with units: `text-[13px]`, `leading-[19px]`
 *     (unitless `leading-[1.1]` on display headings is intentional and allowed)
 *   - arbitrary font family: `font-['Inter']`, `font-[Roboto]` (but `font-[var(…)]` ok)
 *   - inline font style: `style={{ … fontFamily|fontSize|fontWeight … }}`
 *   - non-theme text colors on copy: `text-white`, `text-white/60`,
 *     `text-gray-400`, `text-black`, `text-[#fff]`
 *     (use `text-[var(--text-primary|secondary|muted)]` / typography.color.*)
 *
 * These are a SUPERSET of the gate's guardian greps, so a file that passes this
 * audit also passes the gate backstop.
 *
 * Usage:
 *   node scripts/audit-typography.mjs                 # whole src
 *   node scripts/audit-typography.mjs src/foo.tsx     # a single file/dir (scoped)
 *   node scripts/audit-typography.mjs src/features/x  # a directory (recursive)
 *
 * Exits 1 when the violation count exceeds TYPOGRAPHY_ALLOWED_DRIFT (default 0).
 * The env var is a temporary escape hatch while the typography loop sweeps pages
 * (mirrors LIGHT_MODE_ALLOWED_DRIFT in audit-light-mode-parity.mjs); the
 * long-term target is 0. Scoped runs (a file/dir argument) should always be 0 —
 * that is what the per-unit gate enforces.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, basename, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const SRC_ROOT = join(WEB_ROOT, 'src')

// ── Auto-fail patterns (§2). `name` is printed with each hit. ──
const PATTERNS = [
  { name: 'arbitrary text size (text-[..px|rem|em|pt])', re: /text-\[\d+(?:\.\d+)?(?:px|rem|em|pt)\]/g },
  { name: 'arbitrary line-height (leading-[..px|rem|em])', re: /leading-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g },
  { name: "arbitrary font family (font-['…'] / font-[Name])", re: /font-\['|font-\[(?!var\()[A-Za-z]/g },
  { name: 'inline font style (style={{ …font… }})', re: /style=\{\{[^}]*font(?:Family|Size|Weight)/g },
  { name: 'non-theme text color (text-white)', re: /\btext-white(?![\w-])/g },
  { name: 'non-theme text color (text-black)', re: /\btext-black(?![\w-])/g },
  { name: 'non-theme text color (text-gray-N)', re: /\btext-gray-\d+/g },
  { name: 'hardcoded hex text color (text-[#…])', re: /text-\[#/g },
]

// ── Exempt files (§2). These DEFINE the system or are non-app. ──
function isExempt(absPath) {
  const rel = relative(SRC_ROOT, absPath).split(sep).join('/')
  if (rel.startsWith('..')) {
    // Outside src — only allow if it's an explicitly passed .tsx; still apply
    // the basename-based exemptions below.
  }
  if (/\.(test|spec)\.tsx$/.test(absPath)) return true
  if (/\.stories\.tsx$/.test(absPath)) return true
  if (/\.d\.ts$/.test(absPath)) return true
  if (absPath.split(sep).includes('generated')) return true
  const base = basename(absPath)
  if (base === 'Typography.tsx') return true // the primitive that defines roles
  if (base === 'tokens.ts') return true
  if (rel.includes('lib/tokens/')) return true
  if (base === 'index.css' || base === 'tailwind.config.js') return true
  return false
}

const offenders = []

function scanFile(absPath) {
  if (!absPath.endsWith('.tsx')) return // only JSX/TSX carries className/style text
  if (isExempt(absPath)) return
  let text
  try {
    text = readFileSync(absPath, 'utf8')
  } catch {
    return
  }
  const relForReport = relative(WEB_ROOT, absPath).split(sep).join('/')
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split(/\r?\n/).length
      offenders.push({ file: relForReport, line, match: m[0], name })
    }
  }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const nm of entries) {
    const p = join(dir, nm)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (nm === 'node_modules' || nm === 'dist' || nm === '__snapshots__' || nm === 'generated') continue
      walk(p)
    } else {
      scanFile(p)
    }
  }
}

// ── Resolve scope from CLI args (relative to cwd), else whole src. ──
const args = process.argv.slice(2)
if (args.length === 0) {
  walk(SRC_ROOT)
} else {
  for (const a of args) {
    const abs = resolve(process.cwd(), a)
    if (!existsSync(abs)) {
      console.error(`warning: path not found, skipping: ${a}`)
      continue
    }
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs)
    else scanFile(abs)
  }
}

// ── Report. ──
offenders.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
for (const o of offenders) {
  console.log(`${o.file}:${o.line}  ${o.match}   [${o.name}]`)
}

const counts = offenders.reduce((acc, o) => {
  acc[o.name] = (acc[o.name] ?? 0) + 1
  return acc
}, {})

console.log(`\nTotal typography violations: ${offenders.length}`)
for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`)
}

const ALLOWED_DRIFT = Number(process.env.TYPOGRAPHY_ALLOWED_DRIFT ?? 0)
if (offenders.length > ALLOWED_DRIFT) {
  if (ALLOWED_DRIFT > 0) console.error(`\nAllowed drift (TYPOGRAPHY_ALLOWED_DRIFT): ${ALLOWED_DRIFT}`)
  console.error(
    `\nFAIL: ${offenders.length} typography violation(s).\n` +
      'Render text through <Heading>/<Text> + typography.* tokens (@/lib/tokens),\n' +
      'size via the Tailwind scale (text-sm/base/lg…), and color via\n' +
      'text-[var(--text-primary|secondary|muted)]. See\n' +
      '.github/prompts/typography/0000-typography-system.md §2.',
  )
  process.exit(1)
}

console.log('\nOK — no typography violations.')
process.exit(0)
