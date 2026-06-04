#!/usr/bin/env node
// Chart legend toggle adoption audit.
//
// Multi-series charts (≥ 2 sibling <Line|Bar|Area>) MUST opt into the
// URL-persisted hidden-series toggle so users can declutter and share
// a chart view. The opt-in is `<ChartContainer chartKey="...">` plus
// the matching `<ChartLegend state={…}>` and `hide={…}` props on each
// series.
//
// This audit walks every `web/src/features/**/*.tsx` and
// `web/src/components/charts/**/*.tsx` file, locates each
// `<ChartContainer …>` block, counts sibling `<Line|<Bar|<Area`
// declarations inside, and emits a WARNING (not an error) when the
// count is ≥ 2 and no `chartKey=` prop is present.
//
// Why warn-only:
// • Adoption is incremental, not a hard ratchet.
// • Some charts deliberately don't want toggling (e.g. confidence
// bands paired with a primary line, where hiding the band alone
// misleads). Authors can silence the warning per-block with a
// `// chart-legend-audit:skip <reason>` comment line above the
// `<ChartContainer …>` opening tag.
//
// Exit status: always 0. Output is informational; the gate captures
// it via `AUDIT_EXIT=$LASTEXITCODE`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src');
const SCAN_DIRS = [path.join(ROOT, 'features'), path.join(ROOT, 'components', 'charts')];
const FILE_RE = /\.tsx$/;
const SKIP_RE = /\/\/\s*chart-legend-audit:skip\b/;

/**
 * Recursively gather every.tsx file under the given dir. Skips
 * `__tests__` and `*.test.tsx` because tests routinely fabricate
 * stripped-down chart blocks that would false-positive.
 */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...walk(full));
      continue;
    }
    if (st.isFile() && FILE_RE.test(name) && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Bracket-aware extraction of every `<ChartContainer …>…</ChartContainer>`
 * block. Returns [{block, openTag, lineNumber }] where `block` is the
 * whole element source (opening through closing tag) and `openTag` is
 * just the attributes-and-props portion (so attribute checks aren't
 * tricked by descendant content).
 */
function extractChartContainerBlocks(source) {
  const blocks = [];
  const openTagRe = /<ChartContainer\b/g;
  let m;
  while ((m = openTagRe.exec(source)) !== null) {
    const start = m.index;
    // Scan forward to find the end of the opening `<ChartContainer …>`
    // (could be `>` or `/>`), tracking nested braces so JSX expressions
    // inside props don't trip us up.
    let i = m.index + m[0].length;
    let inString = false;
    let stringQuote = '';
    let braceDepth = 0;
    let openTagEnd = -1;
    let selfClosing = false;
    while (i < source.length) {
      const ch = source[i];
      const next = source[i + 1] ?? '';
      if (inString) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === stringQuote) inString = false;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringQuote = ch;
        i += 1;
        continue;
      }
      if (ch === '{') {
        braceDepth += 1;
        i += 1;
        continue;
      }
      if (ch === '}') {
        if (braceDepth > 0) braceDepth -= 1;
        i += 1;
        continue;
      }
      if (braceDepth > 0) {
        i += 1;
        continue;
      }
      if (ch === '/' && next === '>') {
        openTagEnd = i + 2;
        selfClosing = true;
        break;
      }
      if (ch === '>') {
        openTagEnd = i + 1;
        break;
      }
      i += 1;
    }
    if (openTagEnd < 0) {
      // Malformed source; bail on this match.
      openTagRe.lastIndex = source.length;
      continue;
    }
    const openTag = source.slice(start, openTagEnd);

    let blockEnd = openTagEnd;
    if (!selfClosing) {
      // Find the matching `</ChartContainer>` by tracking nested
      // ChartContainer occurrences (rare but possible in
      // composition).
      let depth = 1;
      let j = openTagEnd;
      const openRe = /<ChartContainer\b/g;
      const closeRe = /<\/ChartContainer>/g;
      openRe.lastIndex = j;
      closeRe.lastIndex = j;
      while (depth > 0 && j < source.length) {
        const oNext = openRe.exec(source);
        const cNext = closeRe.exec(source);
        if (!cNext) break;
        if (oNext && oNext.index < cNext.index) {
          depth += 1;
          j = oNext.index + oNext[0].length;
          openRe.lastIndex = j;
          closeRe.lastIndex = j;
        } else {
          depth -= 1;
          j = cNext.index + cNext[0].length;
          openRe.lastIndex = j;
          closeRe.lastIndex = j;
        }
      }
      blockEnd = j;
    }

    const block = source.slice(start, blockEnd);
    const lineNumber = source.slice(0, start).split('\n').length;
    // Look at the immediately preceding line for a skip waiver.
    const prevLineEnd = source.lastIndexOf('\n', start - 1);
    const prevLineStart = source.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const prevLine = source.slice(prevLineStart, prevLineEnd);
    const waived = SKIP_RE.test(prevLine);
    blocks.push({ block, openTag, lineNumber, waived });
    openTagRe.lastIndex = blockEnd;
  }
  return blocks;
}

/**
 * Count distinct sibling `<Line`, `<Bar`, `<Area` opening tags inside
 * a chart block. We look for the literal `<Line ` / `<Line\n` / `<Line/`
 * forms — close enough for an audit warning.
 */
function countSeriesElements(block) {
  const re = /<(Line|Bar|Area)(?=[\s/>])/g;
  let n = 0;
  while (re.exec(block) !== null) n += 1;
  return n;
}

function hasChartKeyProp(openTag) {
  // Match `chartKey=` (any value form). Anchor on word boundary so
  // a hypothetical `notChartKey=` doesn't false-positive.
  return /\bchartKey\s*=/.test(openTag);
}

const warnings = [];
const adopted = [];

for (const dir of SCAN_DIRS) {
  const files = walk(dir);
  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!src.includes('<ChartContainer')) continue;
    const blocks = extractChartContainerBlocks(src);
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    for (const { block, openTag, lineNumber, waived } of blocks) {
      const seriesCount = countSeriesElements(block);
      if (seriesCount < 2) continue;
      if (hasChartKeyProp(openTag)) {
        adopted.push(`${rel}:${lineNumber} (${seriesCount} series)`);
        continue;
      }
      if (waived) continue;
      warnings.push(`${rel}:${lineNumber} (${seriesCount} sibling Line|Bar|Area; missing chartKey=)`);
    }
  }
}

console.log(
  `[audit:chart-legend] adopted: ${adopted.length}, candidate warnings: ${warnings.length}`,
);

if (adopted.length > 0) {
  console.log('[audit:chart-legend] charts adopting URL-persisted legend toggle:');
  for (const a of adopted) console.log(`  ✓ ${a}`);
}

if (warnings.length > 0) {
  console.log('');
  console.log(
    '[audit:chart-legend] WARN — multi-series charts that could adopt `chartKey=` for click-to-hide UX:',
  );
  for (const w of warnings) console.log(`  · ${w}`);
  console.log('');
  console.log(
    '  Adopt by setting `chartKey="<stable-id>"` on <ChartContainer/>, calling',
  );
  console.log(
    '  `useHiddenSeries("<stable-id>")` at the page level, replacing <Legend/>',
  );
  console.log(
    '  with <ChartLegend state={hidden} />, and adding `hide={hidden.isHidden(\'<dataKey>\')}`',
  );
  console.log(
    '  to each Line|Bar|Area. If the chart genuinely should not opt in, add a',
  );
  console.log(
    '  `// chart-legend-audit:skip <reason>` comment on the line above the',
  );
  console.log('  `<ChartContainer …>` opening tag.');
}

// Always exit 0 — this audit warns only.
process.exit(0);
