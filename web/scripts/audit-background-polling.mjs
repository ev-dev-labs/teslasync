#!/usr/bin/env node
// Background polling audit.
//
// TanStack Query's `refetchInterval` continues firing while the tab is
// in the background unless `refetchIntervalInBackground` is `false`.
// flips the default to `false` at the QueryClient
// level (see web/src/api/queryClient.ts) so every hook automatically
// pauses refetches while `document.hidden === true` — saving Tesla
// Fleet API quota, CPU, and battery for users who park TeslaSync in a
// background tab.
//
// Hooks that genuinely need to keep polling in the background MUST
// override the default per-query AND annotate the override:
//
// useQuery({
// refetchInterval: 30_000,
// // ALLOW-BG-POLLING: SSE bridge bootstrap requires a ticking
// // poller while the tab is suspended so the next-event cursor
// // doesn't drift past the server's retention window.
// refetchIntervalInBackground: true,
// })
//
// This audit walks every `.ts` / `.tsx` file under web/src and fails
// when a `refetchIntervalInBackground: true` is found without an
// `// ALLOW-BG-POLLING: <reason>` annotation either on the same line
// (trailing comment) or on the directly preceding non-blank line.
// Tests / fixtures under `*.test.ts(x)` are exempt — the queryClient
// behavioural test exercises the opt-in path on purpose.
//
// Usage: `npm run audit:bg-polling`. Chained into `npm run lint`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(process.cwd(), 'src')

// Catches `refetchIntervalInBackground: true` (any whitespace, optional
// trailing comma). The audit deliberately does not match `refetchInterval`
// alone — that's the inherited default and is precisely the value we
// want to leave un-annotated.
const OPTION_RE = /refetchIntervalInBackground\s*:\s*true\b/

// Trailing-comment OR previous-line annotation are both accepted. The
// reason text is optional at the regex level but the convention text
// in this script's failure message tells authors to include one.
const ANNOTATION_RE = /\/\/\s*ALLOW-BG-POLLING\b/

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.vite') continue
    const p = path.join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(p)
      continue
    }
    if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue
    // Skip test files: queryClient.test.ts intentionally exercises the
    // opt-in path with refetchIntervalInBackground:true to verify the
    // override mechanism still works. Fixtures and other *.test.* are
    // not production polling sources either.
    if (p.endsWith('.test.ts') || p.endsWith('.test.tsx')) continue
    yield p
  }
}

/**
 * Strip block comments (`/*... *​/`) AND single-line comments (`//`)
 * from a source file, replacing the comment characters with spaces so
 * line numbers and column offsets are preserved. We deliberately do
 * NOT strip comments inside string literals — strings can't legally
 * contain a `refetchIntervalInBackground: true` token at the option
 * call site we're auditing, so the simpler comment-only stripper is
 * sufficient and avoids a string-aware lexer.
 */
function stripComments(source) {
  const out = []
  let inBlock = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1] ?? ''
    if (inBlock) {
      if (ch === '*' && next === '/') {
        out.push('  ')
        i += 1
        inBlock = false
        continue
      }
      out.push(ch === '\n' ? '\n' : ' ')
      continue
    }
    if (ch === '/' && next === '*') {
      out.push('  ')
      i += 1
      inBlock = true
      continue
    }
    if (ch === '/' && next === '/') {
      // Skip to end of line — preserve the newline so line numbers
      // are unaffected.
      while (i < source.length && source[i] !== '\n') {
        out.push(' ')
        i += 1
      }
      if (i < source.length) out.push('\n')
      continue
    }
    out.push(ch)
  }
  return out.join('')
}

const offenders = []
let scanned = 0

for (const file of walk(ROOT)) {
  scanned += 1
  const rawText = readFileSync(file, 'utf8')
  // Quick reject: if the file doesn't mention the option literally,
  // skip the more expensive comment-stripping pass.
  if (!OPTION_RE.test(rawText)) continue

  const codeText = stripComments(rawText)
  if (!OPTION_RE.test(codeText)) continue

  const codeLines = codeText.split(/\r?\n/)
  const rawLines = rawText.split(/\r?\n/)
  for (let i = 0; i < codeLines.length; i += 1) {
    // Match against the comment-stripped view so a JSDoc example like
    // * refetchIntervalInBackground: true,
    // does not count as a real opt-in.
    if (!OPTION_RE.test(codeLines[i])) continue

    // 1. Trailing-comment form: `refetchIntervalInBackground: true, // ALLOW-BG-POLLING:...`
    // Annotation check uses the RAW line (still has its // comment).
    if (ANNOTATION_RE.test(rawLines[i])) continue

    // 2. Preceding-non-blank-line form: walk backwards past blank
    // lines (which a formatter may insert between a JSDoc-style
    // block and the option) until the first line with content.
    let j = i - 1
    while (j >= 0 && rawLines[j].trim() === '') j -= 1
    if (j >= 0 && ANNOTATION_RE.test(rawLines[j])) continue

    offenders.push({
      where: `${path.relative(process.cwd(), file)}:${i + 1}`,
      line: rawLines[i].trim(),
    })
  }
}

console.log(
  `[audit:bg-polling] scanned ${scanned} file(s); offenders: ${offenders.length}`,
)

if (offenders.length > 0) {
  console.error('')
  console.error('[audit:bg-polling] FAIL — refetchIntervalInBackground:true without annotation:')
  for (const o of offenders) {
    console.error(`  ✗ ${o.where}`)
    console.error(`      ${o.line}`)
  }
  console.error('')
  console.error('  Phase-46 / Prompt 53 sets `refetchIntervalInBackground: false`')
  console.error('  as the QueryClient default. Hooks that must keep polling in')
  console.error('  the background have to opt in AND explain why:')
  console.error('')
  console.error('      useQuery({')
  console.error('        refetchInterval: 30_000,')
  console.error('        // ALLOW-BG-POLLING: <one-line justification>')
  console.error('        refetchIntervalInBackground: true,')
  console.error('      })')
  console.error('')
  console.error('  Place the annotation on the same line as the option or on')
  console.error('  the directly preceding non-blank line.')
  process.exit(1)
}

console.log('[audit:bg-polling] OK — every refetchIntervalInBackground:true is annotated.')
process.exit(0)
