#!/usr/bin/env node
// Shared chart-frame adoption audit.
//
// Every ResponsiveContainer in feature code must be nested inside
// ChartContainer, AnalyticsChartPanel, or EmbeddedChart. The TypeScript JSX
// AST is inspected per ResponsiveContainer, so a compliant chart elsewhere in
// the same file cannot conceal a raw chart island and strings/comments cannot
// spoof frame adoption.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ROOT = path.resolve(process.cwd(), 'src', 'features');
const FRAME_COMPONENTS = new Set([
  'ChartContainer',
  'AnalyticsChartPanel',
  'EmbeddedChart',
]);

function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') {
        files.push(...walk(full));
      }
      continue;
    }

    if (
      stat.isFile()
      && full.endsWith('.tsx')
      && !full.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }

  return files;
}

function tagName(node) {
  return node.tagName.getText();
}

function hasFrameAncestor(node) {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      ts.isJsxElement(ancestor)
      && FRAME_COMPONENTS.has(tagName(ancestor.openingElement))
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

function auditFile(file) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<ResponsiveContainer')) {
    return { responsive: 0, framed: 0, offenders: [] };
  }

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const offenders = [];
  let responsive = 0;
  let framed = 0;

  function visit(node) {
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (openingElement && tagName(openingElement) === 'ResponsiveContainer') {
      responsive += 1;
      if (hasFrameAncestor(node)) {
        framed += 1;
      } else {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        offenders.push({
          line: line + 1,
          reason:
            'ResponsiveContainer is not nested inside ChartContainer, AnalyticsChartPanel, or EmbeddedChart',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { responsive, framed, offenders };
}

const offenders = [];
let responsiveCount = 0;
let framedCount = 0;
let filesWithCharts = 0;

for (const file of walk(ROOT)) {
  const result = auditFile(file);
  if (result.responsive > 0) filesWithCharts += 1;
  responsiveCount += result.responsive;
  framedCount += result.framed;

  const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
  for (const offender of result.offenders) {
    offenders.push(`${relative}:${offender.line} — ${offender.reason}`);
  }
}

console.log(
  `[audit:chart-frame] files: ${filesWithCharts}, ResponsiveContainer: ${responsiveCount}, framed: ${framedCount}, raw: ${offenders.length}`,
);

if (offenders.length > 0) {
  console.error(
    '\n[audit:chart-frame] ERROR — raw feature charts bypass the production chart contract:',
  );
  for (const offender of offenders) console.error(`  · ${offender}`);
  console.error(
    '\nWrap each chart in ChartContainer, AnalyticsChartPanel, or EmbeddedChart. '
      + 'Use EmbeddedChart when an existing GlassPanel or widget already owns the visual surface.',
  );
  process.exit(1);
}

console.log(
  'OK — every feature ResponsiveContainer is nested inside a shared chart frame',
);
