#!/usr/bin/env node
/**
 * Tooltip text-color audit.
 *
 * Flags `<Tooltip...>` and `<HelpTooltip...>` callsites whose `content`
 * prop passes JSX subtree(s) hardcoding a `text-white/N` or
 * `text-gray-{100..400}/N` colour class.
 *
 * Why: `web/src/components/ui/Tooltip.tsx` uses an INVERTED surface for
 * high contrast — `bg-gray-900 text-gray-100 dark:bg-gray-100
 * dark:text-gray-900`. A child that hardcodes `text-white/80` will:
 * - render white-on-light-card in dark mode (invisible)
 * - get globally remapped to dark slate text in light mode by
 * `:root.light-mode.text-white\/N` overrides → dark-on-dark card
 * (invisible)
 *
 * The body should INHERIT the tooltip's intrinsic text colour by simply
 * omitting the colour class. Decorative shades that convey meaning
 * (text-amber-300 for severity, text-emerald-300 for success) are fine —
 * they're toned-down body-text shades that have explicit `:root.light-mode`
 * overrides for readability.
 *
 * False-positive avoidance:
 * - Skips files that don't import `Tooltip` from `@/components/ui` or a
 * relative `ui/Tooltip` path, or `HelpTooltip` from
 * `@/components/ui` / `@/components/feedback/HelpTooltip` / a relative
 * `HelpTooltip` path. This excludes the recharts `<Tooltip>` re-export
 * in `@/components/charts` (a different component with its own
 * `wrapperStyle` / `contentStyle` API).
 * - Skips test/spec files (false positives are noise; tests intentionally
 * render hostile JSX to verify the runtime warn).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', 'src')

const FORBIDDEN = /text-(?:white|gray-[1-4]00)(?:\/(?:[0-9]+))?\b/g

const offenders = []

function hasOurTooltipImport(text) {
  return (
    /from ['"](?:@\/components\/ui(?:\/Tooltip)?|(?:\.{1,2}\/)+(?:components\/)?ui\/Tooltip|\.{1,2}\/Tooltip)['"]/.test(text)
    || /from ['"](?:@\/components\/ui(?:\/HelpTooltip)?|@\/components\/feedback\/HelpTooltip|(?:\.{1,2}\/)+(?:components\/)?ui\/HelpTooltip|\.{1,2}\/HelpTooltip)['"]/.test(text)
  )
}

/**
 * Find the `content={...}` prop value boundaries for a `<Tooltip|HelpTooltip>`
 * opening tag at `tagStart`. We scan forward from the tag opening for a
 * matching `content={` sequence that lives BEFORE the tag's `>` close, then
 * walk balanced braces to find the closing `}`.
 *
 * Returns {start, end} (exclusive) of the JSX expression body, or null if no
 * `content` prop is present (e.g. `<HelpTooltip text="…" />`).
 */
function findContentExpr(text, tagStart) {
  // Find end of opening tag (>) accounting for nested braces in attrs.
  let i = tagStart
  let depth = 0
  let attrStart = -1
  let attrEnd = -1
  // We have to find content={…}, balancing braces, before the tag's
  // top-level `>` (which closes the opening tag at depth 0 outside braces).
  while (i < text.length) {
    const c = text[i]
    if (c === '{') {
      if (depth === 0 && text.slice(Math.max(0, i - 8), i).endsWith('content=')) {
        attrStart = i + 1
        depth = 1
        i++
        // Walk balanced braces.
        while (i < text.length && depth > 0) {
          const cc = text[i]
          if (cc === '{') depth++
          else if (cc === '}') depth--
          if (depth === 0) {
            attrEnd = i
            break
          }
          i++
        }
        return attrStart >= 0 && attrEnd > attrStart ? { start: attrStart, end: attrEnd } : null
      }
      depth++
    } else if (c === '}') {
      if (depth > 0) depth--
    } else if (c === '>' && depth === 0) {
      // End of opening tag with no content={...} found.
      return null
    }
    i++
  }
  return null
}

function scan(filePath) {
  const text = readFileSync(filePath, 'utf8')
  if (!/<(?:Tooltip|HelpTooltip)\b/.test(text)) return
  if (!hasOurTooltipImport(text)) return

  const tagRe = /<(Tooltip|HelpTooltip)\b/g
  let m
  while ((m = tagRe.exec(text))) {
    const expr = findContentExpr(text, m.index)
    if (!expr) continue
    const body = text.slice(expr.start, expr.end)
    let mm
    FORBIDDEN.lastIndex = 0
    while ((mm = FORBIDDEN.exec(body))) {
      const lineNum = text.slice(0, expr.start + mm.index).split('\n').length
      offenders.push(`${filePath}:${lineNum}:${mm[0]}`)
    }
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__snapshots__') continue
      walk(p)
      continue
    }
    if (!p.endsWith('.tsx')) continue
    // Skip tests — they intentionally render the offending content to
    // exercise the dev-time runtime warn.
    if (p.includes(`${sep}__tests__${sep}`)) continue
    if (/\.(?:test|spec)\.tsx$/.test(p)) continue
    scan(p)
  }
}

walk(ROOT)

if (offenders.length > 0) {
  console.error(`\nTooltip content with hardcoded text-white/text-gray-{100..400} colour (${offenders.length}):\n`)
  for (const o of offenders) console.error('  ', o)
  console.error(
    '\nFix: remove the colour class from the JSX inside the `content` prop.',
  )
  console.error(
    '     The shared <Tooltip> body uses an inverted surface (light card in',
  )
  console.error(
    '     dark mode) and cascades its own `text-gray-100 dark:text-gray-900`',
  )
  console.error(
    '     pair. Hardcoded `text-white` / `text-gray-{100..400}` will render',
  )
  console.error(
    '     invisibly in one of the two modes (light-mode global overrides flip',
  )
  console.error(
    '     `text-white` to dark slate, which collides with the dark card).',
  )
  console.error(
    '\n     Decorative colours (text-amber-300 severity, text-emerald-300',
  )
  console.error(
    '     success) are allowed — they have light-mode overrides and convey',
  )
  console.error(
    '     meaning rather than body text.\n',
  )
  process.exit(1)
}

console.log('OK — no tooltip content overrides intrinsic text colour')
