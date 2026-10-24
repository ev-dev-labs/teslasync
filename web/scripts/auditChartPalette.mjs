#!/usr/bin/env node
// Chart palette adjacency validator.
//
// Verifies that the chart palettes exposed by `web/src/lib/colors.ts`
// (`CHART_COLORS_CB_SAFE` and `CHART_COLORS_NEON`) keep adjacent series
// distinguishable. For each adjacent pair (i, i+1) we convert both colours
// to the OKLCh perceptual colour space and require either:
//
// - Lightness delta dL >= MIN_DELTA_L (default 0.1, range 0–1), OR
// - Circular hue delta dH >= MIN_DELTA_H_DEG (default 30°, range 0–180°).
//
// If both deltas are below threshold for any adjacent pair, the script exits
// non-zero and the gate fails. Hue distance uses circular distance so wraps
// like 354° → 25° measure the true 31° gap rather than a naive 329°.
//
// Read the exported constant arrays from the canonical TypeScript AST, not
// duplicated palettes or incidental literals in comments/unrelated constants.
// Missing, malformed, or unsupported initializers fail closed.
//
// Run via: `node scripts/auditChartPalette.mjs`
// `npm run audit:palette`

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { converter } from 'culori';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLORS_SRC = join(__dirname, '..', 'src', 'lib', 'colors.ts');

const PALETTE_NAMES = ['CHART_COLORS_CB_SAFE', 'CHART_COLORS_NEON'];

export function readCanonicalPalettes(source) {
  const file = ts.createSourceFile(COLORS_SRC, source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) {
    throw new Error('canonical palette source has TypeScript syntax errors');
  }
  return Object.fromEntries(PALETTE_NAMES.map((name) => {
    const declarations = file.statements
      .filter((statement) => ts.isVariableStatement(statement)
        && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        && (statement.declarationList.flags & ts.NodeFlags.Const))
      .flatMap((statement) => [...statement.declarationList.declarations])
      .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
    if (declarations.length !== 1) throw new Error(`${name}: expected one canonical exported const`);
    let initializer = declarations[0].initializer;
    while (initializer && (ts.isAsExpression(initializer)
      || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
      initializer = initializer.expression;
    }
    if (!initializer || !ts.isArrayLiteralExpression(initializer) || initializer.elements.length !== 8) {
      throw new Error(`${name}: expected eight canonical colors (seven adjacent pairs)`);
    }
    const palette = initializer.elements.map((element, index) => {
      if (!ts.isStringLiteral(element) || !/^#[\da-f]{6}$/i.test(element.text)) {
        throw new Error(`${name}[${index}]: expected a resolved six-digit hex color`);
      }
      return element.text;
    });
    return [name, palette];
  }));
}

const MIN_DELTA_L = 0.1;
const MIN_DELTA_H_DEG = 30;
const MIN_DELTA_E = 0.12;

const okl = converter('oklch');

function adjacentDistance(a, b) {
  const oa = okl(a);
  const ob = okl(b);
  const dL = Math.abs((oa?.l ?? 0) - (ob?.l ?? 0));
  // Achromatic colours (greys, pure black/white) have undefined hue —
  // treat the missing hue as 0 so the lightness delta carries the pair.
  const ah = oa?.h ?? 0;
  const bh = ob?.h ?? 0;
  let dH = Math.abs(ah - bh);
  if (dH > 180) dH = 360 - dH;
  return { dL, dH };
}

function check(palette, logger) {
  let failed = 0;
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i];
    const b = palette[i + 1];
    const { dL, dH } = adjacentDistance(a, b);
    const ok = dL >= MIN_DELTA_L || dH >= MIN_DELTA_H_DEG;
    const status = ok ? 'pass' : 'FAIL';
    const line = `  [${i}] ${a} -> ${b}  dL=${dL.toFixed(3)}  dH=${dH.toFixed(1)}°  ${status}`;
    if (ok) {
      logger.log(line);
    } else {
      logger.error(line);
      logger.error(
        `        adjacent pair too similar — need dL >= ${MIN_DELTA_L} OR dH >= ${MIN_DELTA_H_DEG}°`,
      );
      failed += 1;
    }
  }
  return failed;
}

function isVisualColorLiteral(text) {
  return /^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(text.trim())
    || /^(?:rgb|rgba|hsl|hsla)\s*\(/i.test(text.trim());
}

/** Find resolved color literals in chart/data-visual source, excluding comments. */
export function findVisualColorLiterals(source, fileName = 'visual.tsx') {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const hits = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) && isVisualColorLiteral(node.text)) {
      hits.push({ position: node.getStart(file), value: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

function walk(root, predicate) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

function lineOf(source, position) {
  return source.slice(0, position).split('\n').length;
}

export function auditCanonicalPalettes(source, logger = console) {
  let palettes;
  try {
    palettes = readCanonicalPalettes(source);
  } catch (err) {
    logger.error(`drift guard: ${err.message}`);
    return 1;
  }
  let failed = 0;
  logger.log(`=== canonical drift guard: ${COLORS_SRC} ===`);
  for (const name of PALETTE_NAMES) {
    logger.log(`=== ${name} ===`);
    failed += check(palettes[name], logger);
  }
  if (failed === 0) logger.log('OK — both canonical palettes pass adjacency thresholds.');
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const paletteExit = auditCanonicalPalettes(readFileSync(COLORS_SRC, 'utf8'));
    const webRoot = join(__dirname, '..');
    const allowed = new Set([
      join(webRoot, 'src', 'lib', 'colors.ts'),
      join(webRoot, 'src', 'lib', 'tokens.ts'),
      join(webRoot, 'src', 'features', 'dashboard', 'lib', 'dashboardTokens.ts'),
    ]);
    const visualRoots = [
      join(webRoot, 'src', 'components', 'charts'),
      join(webRoot, 'src', 'components', 'maps'),
      join(webRoot, 'src', 'features', 'dashboard', 'widgets'),
      join(webRoot, 'src', 'features', 'analytics'),
      join(webRoot, 'src', 'features', 'driving'),
      join(webRoot, 'src', 'features', 'charging'),
      join(webRoot, 'src', 'features', 'battery'),
      join(webRoot, 'src', 'features', 'vehicles'),
      join(webRoot, 'src', 'features', 'maps'),
      join(webRoot, 'src', 'features', 'telemetry'),
      join(webRoot, 'src', 'features', 'system'),
      join(webRoot, 'src', 'features', 'settings'),
      join(webRoot, 'src', 'features', 'developer-reference'),
    ];
    let visualFailures = 0;
    for (const root of visualRoots) {
      for (const file of walk(root, candidate => /\.(?:ts|tsx)$/.test(candidate))) {
        if (allowed.has(file) || /\.(?:test)\.tsx?$/.test(file)) continue;
        const source = readFileSync(file, 'utf8');
        if (!/(?:<(?:Line|Area|Bar|Pie|Scatter|Cell|Polyline|CircleMarker|Radar|ReferenceArea)\b|fill=|stroke=|stopColor=|pathOptions=|\b(?:heatmap|gradient|sparkline)\b)/i.test(source)) continue;
        for (const hit of findVisualColorLiterals(source, file)) {
          console.error(`hard-coded visual color: ${join(relative(webRoot, file))}:${lineOf(source, hit.position)} ${hit.value}`);
          visualFailures += 1;
        }
      }
    }
    if (visualFailures === 0) console.log('OK - no hard-coded visual colors outside the token modules.');
    process.exitCode = paletteExit || visualFailures > 0 ? 1 : 0;
  } catch (err) {
    console.error(`drift guard: cannot read ${COLORS_SRC}: ${err.message}`);
    process.exitCode = 1;
  }
}
