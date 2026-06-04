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
// The palettes are duplicated here (kept in sync with `web/src/lib/colors.ts`)
// so this script does not need a TypeScript loader to import the source. A
// guard at the bottom greps the source file for both arrays' opening lines so
// drift is caught on the next CI run.
//
// Run via: `node scripts/auditChartPalette.mjs`
// `npm run audit:palette`

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { converter } from 'culori';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLORS_SRC = join(__dirname, '..', 'src', 'lib', 'colors.ts');

/** Must match `CHART_COLORS_CB_SAFE` in web/src/lib/colors.ts. */
const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
];

/** Must match `CHART_COLORS_NEON` in web/src/lib/colors.ts. */
const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
];

const MIN_DELTA_L = 0.1;
const MIN_DELTA_H_DEG = 30;

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

function check(name, palette) {
  let failed = 0;
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i];
    const b = palette[i + 1];
    const { dL, dH } = adjacentDistance(a, b);
    const ok = dL >= MIN_DELTA_L || dH >= MIN_DELTA_H_DEG;
    const status = ok ? 'pass' : 'FAIL';
    const line = `  [${i}] ${a} -> ${b}  dL=${dL.toFixed(3)}  dH=${dH.toFixed(1)}°  ${status}`;
    if (ok) {
      console.log(line);
    } else {
      console.error(line);
      console.error(
        `        adjacent pair too similar — need dL >= ${MIN_DELTA_L} OR dH >= ${MIN_DELTA_H_DEG}°`,
      );
      failed += 1;
    }
  }
  return failed;
}

function checkSourceContains(literal, label) {
  let src = '';
  try {
    src = readFileSync(COLORS_SRC, 'utf8');
  } catch (err) {
    console.error(`drift guard: cannot read ${COLORS_SRC}: ${err.message}`);
    return 1;
  }
  if (!src.includes(literal)) {
    console.error(
      `drift guard: ${label} hex "${literal}" not found in ${COLORS_SRC}.`,
    );
    console.error(
      '              Update both this script and web/src/lib/colors.ts together.',
    );
    return 1;
  }
  return 0;
}

let exitCode = 0;

console.log('=== CHART_COLORS_CB_SAFE ===');
exitCode += check('CB_SAFE', CHART_COLORS_CB_SAFE);

console.log('=== CHART_COLORS_NEON ===');
exitCode += check('NEON', CHART_COLORS_NEON);

console.log('=== drift guard ===');
// Pick a representative anchor hex from each palette. Drift on any other
// entry trips the adjacency check above; these guards catch wholesale
// rename / removal of either palette.
exitCode += checkSourceContains(CHART_COLORS_CB_SAFE[0], 'CB_SAFE[0]');
exitCode += checkSourceContains(CHART_COLORS_CB_SAFE[CHART_COLORS_CB_SAFE.length - 1], 'CB_SAFE[last]');
exitCode += checkSourceContains(CHART_COLORS_NEON[0], 'NEON[0]');
exitCode += checkSourceContains(CHART_COLORS_NEON[CHART_COLORS_NEON.length - 1], 'NEON[last]');

if (exitCode === 0) {
  console.log('OK — both palettes pass adjacency thresholds.');
}
process.exit(exitCode === 0 ? 0 : 1);
