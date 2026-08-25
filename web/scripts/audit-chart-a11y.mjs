#!/usr/bin/env node
// chart accessibility audit.
//
// Walks `web/src/**` and fails if any shared chart-frame JSX
// opening tag is missing the `ariaLabel` prop (REQUIRED), or — when
// `data` is supplied — its companion `dataColumns` prop. When `data`
// is absent the caller MUST justify the omission with a
// `// chart-a11y:no-table <reason>` comment within the same JSX
// element (block region 0–10 lines above the opening tag).
//
// Why this exists
// ---------------
// Recharts renders pure SVG with no semantic structure. Screen-reader
// users hear "graphic" and nothing else; Windows High Contrast users
// see SVG strokes collapse to monochrome line noise. 
// fixes both at the source by:
// 1. Always exposing an `aria-label` summary on the chart figure;
// 2. Rendering a visually-hidden `<table>` (made visible in
// forced-colors mode) carrying the same data the chart shows.
// This audit locks the contract in so a regression can't ship.
//
// Allowed escape hatch
// --------------------
// Some charts genuinely have no tabular form — e.g. a 10k-cell
// heatmap, or a polyline plotted point cloud where the table would
// drown the SR user. In those cases the caller can omit `data` IF
// they leave a `// chart-a11y:no-table <reason>` comment within the
// 10 lines preceding the opening tag, and provide a richer
// `ariaDescription` instead. `ariaLabel` remains REQUIRED.
//
// Run via `npm run audit:chart-a11y` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = join('src');
// Files exempt from the audit: the contract test deliberately
// exercises ChartContainer with various prop combinations (including
// the minimal-required-props case), so applying the audit there
// would create a circular dependency between the contract and its
// own enforcement.
const EXEMPT_FILES = new Set([
  join('src', 'components', 'charts', '__tests__', 'ChartContainer.a11y.test.tsx'),
  // Typed adapter forwards the required aria/data contract through
  // `ChartContainerProps`; call sites are audited as `<EmbeddedChart>`.
  join('src', 'components', 'charts', 'EmbeddedChart.tsx'),
]);
const offenders = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    if (EXEMPT_FILES.has(p)) continue;
    auditFile(p);
  }
}

// Build a list of [start, end) ranges in `text` corresponding to
// string literals or comments. Used to filter false-positive
// `<ChartContainer` matches inside JSDoc / block comments / strings.
function buildMaskedRegions(text) {
  const regions = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      regions.push([start, i]);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      regions.push([start, i]);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 2;
        else i++;
      }
      i++;
      regions.push([start, i]);
      continue;
    }
    i++;
  }
  return regions;
}

function isMaskedRegion(regions, offset) {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true;
    if (s > offset) return false;
  }
  return false;
}

// Scan forward from `from` (just past the `<ChartContainer` token)
// until we hit the matching `>` or `/>` that closes the JSX opening
// tag, while tracking brace depth and string/template state so
// embedded JS expressions (`title={t('…')}`) don't trip us up.
function findTagEnd(text, from) {
  let i = from;
  // Skip a leading TS generic param block (rare for ChartContainer
  // but kept for symmetry with audit-datatable-tableid).
  if (text[i] === '<') {
    let angle = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '<') angle++;
      else if (c === '>') {
        angle--;
        if (angle === 0) {
          i++;
          break;
        }
      }
    }
  }
  let depth = 0;
  let inString = null; // ' " or `
  for (; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === inString && text[i - 1] !== '\\') inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }
    if (c === '{') {
      depth++;
      continue;
    }
    if (c === '}') {
      depth--;
      continue;
    }
    if (depth === 0 && (c === '>' || (c === '/' && text[i + 1] === '>'))) {
      return c === '/' ? i + 2 : i + 1;
    }
  }
  return -1;
}

// Returns true if the 10 lines preceding `tagStart` contain a line
// that includes the literal `chart-a11y:no-table` marker (anywhere on
// the line — usually inside a `//` comment).
function hasNoTableJustification(text, tagStart) {
  const lineStart = text.lastIndexOf('\n', tagStart - 1) + 1;
  const before = text.slice(0, lineStart);
  const lines = before.split('\n');
  const window = lines.slice(Math.max(0, lines.length - 10));
  return window.some((l) => l.includes('chart-a11y:no-table'));
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const masked = buildMaskedRegions(text);
  // Match `<ChartContainer` followed by whitespace, `<` (generic
  // param), `/`, or `>`. Excludes anything that just shares a prefix.
  const re = /<(ChartContainer|AnalyticsChartPanel|EmbeddedChart)(?=[\s</>])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isMaskedRegion(masked, m.index)) continue;
    const componentName = m[1];
    const tagEnd = findTagEnd(text, m.index + componentName.length + 1);
    if (tagEnd === -1) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push({
        where: `${path}:${line}`,
        why: `<${componentName}> opening tag never closes — could not parse`,
      });
      continue;
    }
    const tagSource = text.slice(m.index, tagEnd);
    const line = text.slice(0, m.index).split('\n').length;

    const hasAriaLabel = /\bariaLabel\s*=/.test(tagSource);
    const hasData = /\bdata\s*=/.test(tagSource);
    const hasDataColumns = /\bdataColumns\s*=/.test(tagSource);

    if (!hasAriaLabel) {
      offenders.push({
        where: `${path}:${line}`,
        why: 'missing required `ariaLabel` — every chart must announce a one-sentence summary to screen readers',
      });
    }

    if (hasData && !hasDataColumns) {
      offenders.push({
        where: `${path}:${line}`,
        why: '`data` set without `dataColumns` — fallback table cannot render columns without a column spec',
      });
    }

    if (!hasData) {
      const justified = hasNoTableJustification(text, m.index);
      if (!justified) {
        offenders.push({
          where: `${path}:${line}`,
          why: 'missing `data` prop AND no `// chart-a11y:no-table <reason>` justification within the preceding 10 lines',
        });
      }
    }
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\nShared chart-frame accessibility audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by adding the required props:\n' +
      '\n' +
      '  // For charts with a tabular shape (most line / bar / area):\n' +
      '  <ChartContainer\n' +
      '    title={t(...)}\n' +
      '    ariaLabel={t("chart.aria.dailyEnergy", "Daily energy use over the last 30 days")}\n' +
      '    data={tableRows}\n' +
      '    dataColumns={[{ key: "time", label: "Time" }, { key: "kwh", label: "kWh" }]}\n' +
      '  >\n' +
      '    ...\n' +
      '  </ChartContainer>\n' +
      '\n' +
      '  // For charts that genuinely cannot be tabulated (heatmaps,\n' +
      '  // 10k-point scatter clouds, geographic maps): justify the\n' +
      '  // omission with a `chart-a11y:no-table` comment AND provide\n' +
      '  // a richer `ariaDescription`:\n' +
      '\n' +
      '  // chart-a11y:no-table 10k-cell heatmap — table would be unusable\n' +
      '  <ChartContainer\n' +
      '    title={t(...)}\n' +
      '    ariaLabel={t(...)}\n' +
      '    ariaDescription={t("chart.desc.heatmap", "Activity heatmap showing peak usage between 6pm and 9pm on weekdays.")}\n' +
      '  >\n' +
      '    ...\n' +
      '  </ChartContainer>\n',
  );
  process.exit(1);
}

console.log(`OK — every shared chart frame in ${ROOT} has ariaLabel + data/dataColumns or a no-table justification`);
