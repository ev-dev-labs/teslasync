// Codemod: rewrite simple-inline AI feature components to use
// AIFeatureCard. Skips files whose JSX doesn't match the canonical
// "GlassPanel → header (title + badge + desc) → inline Button →
// AiOutputPanel" pattern; those are reported and must be refactored
// by hand.
//
// Usage:
// node scripts/refactor-ai-cards.mjs --check # report
// node scripts/refactor-ai-cards.mjs --write # write

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const AI_DIR = 'src/components/ai'
const SKIP = new Set([
  'AIFeatureCard.tsx',
  'AIThinkingIndicator.tsx',
  'AIChatbotIndicator.tsx', // different surface (status pill)
  'AIChargingDiagnosis.tsx', // already refactored manually
  'AINLDriveSearch.tsx', // already refactored manually
  'AICrossRuleConflictDetection.tsx', // already refactored manually
  'AiOutputPanel.tsx',
  'AiLimitBanner.tsx',
  'ConfirmDialog.tsx',
  'withAiFeature.tsx',
])

const args = new Set(process.argv.slice(2))
const WRITE = args.has('--write')

function findFiles() {
  return readdirSync(AI_DIR)
    .filter((n) => n.startsWith('AI') && n.endsWith('.tsx') && !SKIP.has(n))
    .map((n) => join(AI_DIR, n))
}

// Extract `t(...)` first arg + default from a substring. Accepts
// literal i18n key paths (not template strings) and handles single
// or multi-line forms with embedded quotes.
function findTCall(text, anchorRegex) {
  const m = anchorRegex.exec(text)
  if (!m) return null
  const startIdx = m.index + m[0].length
  // Walk forward to find `t(`
  const tIdx = text.indexOf('t(', startIdx)
  if (tIdx < 0) return null
  // Walk paren-balanced from tIdx+1
  let depth = 0
  let i = tIdx + 1
  let started = false
  while (i < text.length) {
    const c = text[i]
    if (c === '(') {
      depth++
      started = true
    } else if (c === ')') {
      depth--
      if (started && depth === 0) {
        return { start: tIdx, end: i + 1, body: text.slice(tIdx, i + 1) }
      }
    }
    i++
  }
  return null
}

const REPORT = []

function refactorOne(path) {
  const src = readFileSync(path, 'utf8')

  // Quick reject: must contain the canonical scaffold markers.
  if (!src.includes('AiOutputPanel')) {
    REPORT.push({ path, status: 'skip', reason: 'no AiOutputPanel' })
    return
  }
  if (!src.includes("from '@/components/ai/AiOutputPanel'")) {
    REPORT.push({ path, status: 'skip', reason: 'no AiOutputPanel import' })
    return
  }
  if (!src.includes('GlassPanel')) {
    REPORT.push({ path, status: 'skip', reason: 'no GlassPanel' })
    return
  }
  if (!/return \(\s*\n\s*<GlassPanel>/.test(src)) {
    REPORT.push({ path, status: 'skip', reason: 'no return ( <GlassPanel>' })
    return
  }

  // The function body of InnerSection.
  const fnMatch = /function (\w+)\(([\s\S]*?)\)[^{]*\{([\s\S]*?)\r?\n\}\r?\n[\s\S]{0,200}?\1\.displayName/.exec(
    src,
  )
  if (!fnMatch) {
    REPORT.push({ path, status: 'skip', reason: 'no recognisable InnerSection' })
    return
  }
  const fnBody = fnMatch[3]

  // Locate the JSX return block.
  const returnIdx = fnBody.indexOf('return (')
  if (returnIdx < 0) {
    REPORT.push({ path, status: 'skip', reason: 'no return (' })
    return
  }
  // Find matching `)` that closes the return — walk paren-balanced.
  let depth = 0
  let i = returnIdx + 'return ('.length - 1
  let endIdx = -1
  for (; i < fnBody.length; i++) {
    const c = fnBody[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx < 0) {
    REPORT.push({ path, status: 'skip', reason: 'unterminated return (' })
    return
  }
  const jsx = fnBody.slice(returnIdx + 'return ('.length, endIdx)

  // Detect prompt-input variant: a Textarea/Input/textarea/input
  // appears between the header and the button row. Extract that
  // JSX as `inputSlot`.
  let inputSlotJsx = null
  const inputElementRegex = /<(?:Textarea|Input|Select|textarea|input|select)\b/
  if (inputElementRegex.test(jsx)) {
    // The header is wrapped by the outer div `<div className="flex
    // items-start justify-between gap-4">` — find its matching close.
    // Then find the button-row `<div className="flex justify-end"`
    // (or similar) — the input lives between them.
    const headerOpenRegex = /<div className="flex items-(?:start|center) justify-between gap-4">/
    const headerOpenMatch = headerOpenRegex.exec(jsx)
    if (!headerOpenMatch) {
      REPORT.push({ path, status: 'skip', reason: 'prompt-input: no header div' })
      return
    }
    // Walk to find matching </div> for the header.
    const headerStart = headerOpenMatch.index + headerOpenMatch[0].length
    let dvDepth = 1
    let scanIdx = headerStart
    let headerEnd = -1
    while (scanIdx < jsx.length) {
      const open = jsx.indexOf('<div', scanIdx)
      const close = jsx.indexOf('</div>', scanIdx)
      if (close < 0) break
      if (open >= 0 && open < close) {
        dvDepth++
        scanIdx = open + 4
      } else {
        dvDepth--
        scanIdx = close + 6
        if (dvDepth === 0) {
          headerEnd = scanIdx
          break
        }
      }
    }
    if (headerEnd < 0) {
      REPORT.push({ path, status: 'skip', reason: 'prompt-input: header not closed' })
      return
    }
    // Find the button-row div (flex justify-end).
    const buttonRowRegex = /<div className="flex (?:flex-wrap )?(?:items-center )?justify-end[^"]*">/
    const buttonRowMatch = buttonRowRegex.exec(jsx.slice(headerEnd))
    if (!buttonRowMatch) {
      REPORT.push({ path, status: 'skip', reason: 'prompt-input: no button row div' })
      return
    }
    const buttonRowStart = headerEnd + buttonRowMatch.index
    // Extract inputSlot JSX: trim whitespace.
    inputSlotJsx = jsx.slice(headerEnd, buttonRowStart).trim()
    if (inputSlotJsx.length === 0) {
      REPORT.push({ path, status: 'skip', reason: 'prompt-input: empty inputSlot' })
      return
    }
  }

  // The pattern is: <GlassPanel>...</GlassPanel> with one Button in the header.
  // Extract title, badge, description, button label.
  const titleCall = findTCall(jsx, /<h3[^>]*>\s*\{?/)
  if (!titleCall) {
    REPORT.push({ path, status: 'skip', reason: 'no <h3> t() title' })
    return
  }

  // Badge is inside the cyan span; locate via the badge default substring.
  const badgeAnchor = /<span\s+className="inline-flex items-center gap-1\.5 rounded-full border border-cyan-300/
  const badgeAnchorMatch = badgeAnchor.exec(jsx)
  if (!badgeAnchorMatch) {
    REPORT.push({ path, status: 'skip', reason: 'no badge span' })
    return
  }
  // The badge `t(...)` call lives between the inner `<span aria-hidden`
  // self-close and the `</span>` of the outer span. Find it.
  const badgeOuterStart = badgeAnchorMatch.index
  const badgeCloseIdx = jsx.indexOf('</span>', badgeOuterStart)
  // Look for the last t(before the </span>
  const badgeArea = jsx.slice(badgeOuterStart, badgeCloseIdx)
  const badgeCall = findTCall(badgeArea, /aria-hidden[\s\S]*?\/>/)
  if (!badgeCall) {
    REPORT.push({ path, status: 'skip', reason: 'no badge t() call' })
    return
  }

  // Description is in <p className="text-sm text-white/60">.
  const descCall = findTCall(jsx, /<p className="text-sm text-white\/60">\s*\{?/)
  if (!descCall) {
    REPORT.push({ path, status: 'skip', reason: 'no description t() call' })
    return
  }

  // Button label is the t() call inside the ternary on the streaming
  // line: `state === 'streaming' ? t(generating): t(generateBtn)`.
  // Find the second arg of the ternary.
  const ternaryMatch = /\{stream\.state === 'streaming'\s*\?\s*t\([^)]*\)(?:[^)]*\))?\s*\n?\s*:\s*/.exec(jsx)
  if (!ternaryMatch) {
    REPORT.push({ path, status: 'skip', reason: 'no streaming ternary' })
    return
  }
  // Grab the t(...) after the colon.
  const afterColon = jsx.slice(ternaryMatch.index + ternaryMatch[0].length)
  const buttonCall = findTCall(afterColon, /^/)
  if (!buttonCall) {
    REPORT.push({ path, status: 'skip', reason: 'no button label t() call' })
    return
  }

  // canStart predicate: find `const can<Name> = <expr>` (e.g.
  // canGenerate, canDraft, canSummarize, canAsk) and split off
  // ` && stream.state !== 'streaming'`. We'll pass the LHS to
  // canStart. Some files use no predicate (always-true) — fall
  // back to `true` in that case.
  let canStartExpr = 'true'
  const canMatch = /const\s+(can\w+)\s*=\s*([\s\S]*?)\r?\n/.exec(fnBody)
  if (canMatch) {
    let rhs = canMatch[2].trim().replace(/;?$/, '')
    // Strip the trailing && stream.state !== 'streaming' (and variants).
    rhs = rhs
      .replace(/\s*&&\s*stream\.state\s*!==\s*'streaming'\s*$/, '')
      .replace(/\s*&&\s*!isStreaming\s*$/, '')
      .replace(/\s*&&\s*!isBusy\s*$/, '')
      .trim()
    if (rhs.length === 0) rhs = 'true'
    canStartExpr = rhs
  }

  // Build the new return body.
  const titleSrc = titleCall.body
  const badgeSrc = badgeCall.body
  const descSrc = descCall.body
  const buttonSrc = buttonCall.body

  const newReturn = inputSlotJsx
    ? `return (
    <AIFeatureCard
      title={${titleSrc}}
      description={${descSrc}}
      buttonLabel={${buttonSrc}}
      badgeLabel={${badgeSrc}}
      canStart={${canStartExpr}}
      stream={stream}
      inputSlot={
        ${inputSlotJsx}
      }
    />
  )`
    : `return (
    <AIFeatureCard
      title={${titleSrc}}
      description={${descSrc}}
      buttonLabel={${buttonSrc}}
      badgeLabel={${badgeSrc}}
      canStart={${canStartExpr}}
      stream={stream}
    />
  )`

  // Replace the old return block in the file.
  // Compute absolute offsets in the full src.
  const fnAbsoluteStart = src.indexOf(fnMatch[0])
  const fnBodyAbsoluteStart = fnAbsoluteStart + fnMatch[0].indexOf(fnBody)
  const oldReturnAbsolute = fnBodyAbsoluteStart + returnIdx
  const oldReturnEndAbsolute = fnBodyAbsoluteStart + endIdx + 1 // include )

  let newSrc =
    src.slice(0, oldReturnAbsolute) +
    newReturn +
    src.slice(oldReturnEndAbsolute)

  // Now fix imports.
  // 1. Remove `import { AiOutputPanel } from '@/components/ai/AiOutputPanel'`
  newSrc = newSrc.replace(
    /import \{ AiOutputPanel \} from '@\/components\/ai\/AiOutputPanel'\r?\n/,
    "import { AIFeatureCard } from '@/components/ai/AIFeatureCard'\r\n",
  )
  // 2. Drop Button and GlassPanel from `@/components/ui` import.
  newSrc = newSrc.replace(
    /import \{([^}]+)\} from '@\/components\/ui'\r?\n/,
    (_m, items) => {
      const kept = items
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== 'Button' && s !== 'GlassPanel')
      if (kept.length === 0) return ''
      return `import { ${kept.join(', ')} } from '@/components/ui'\r\n`
    },
  )

  // 3. Drop the now-unused predicate variable (canGenerate / canDraft /
  //    canSummarize / canAsk / etc.) — its expression has been inlined
  //    into the AIFeatureCard `canStart` prop and TS would error on
  //    the unused local under noUnusedLocals.
  if (canMatch) {
    const escaped = canMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    newSrc = newSrc.replace(new RegExp(escaped, ''), '')
  }

  // Sanity check: make sure we didn't leave a dangling JSX
  // reference to GlassPanel or Button or AiOutputPanel after the
  // rewrite. Only count actual JSX usage (`<Foo` open tag), not
  // mentions in comments. Note: <Textarea> / <Input> may still
  // appear as a child of inputSlot — that's intentional and OK.
  if (
    /<GlassPanel\b/.test(newSrc) ||
    /<AiOutputPanel\b/.test(newSrc) ||
    /<Button\b/.test(newSrc)
  ) {
    REPORT.push({
      path,
      status: 'skip',
      reason: 'references GlassPanel/Button/AiOutputPanel JSX after rewrite (complex)',
    })
    return
  }

  if (WRITE) {
    writeFileSync(path, newSrc, 'utf8')
    REPORT.push({ path, status: 'rewrote' })
  } else {
    REPORT.push({ path, status: 'would-rewrite' })
  }
}

const files = findFiles()
for (const f of files) refactorOne(f)

const counts = {}
for (const r of REPORT) counts[r.status] = (counts[r.status] || 0) + 1
console.log('=== Refactor report ===')
for (const r of REPORT) {
  console.log(`  ${r.status.padEnd(15)} ${r.path}${r.reason ? ' — ' + r.reason : ''}`)
}
console.log('---')
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k}: ${v}`)
}
