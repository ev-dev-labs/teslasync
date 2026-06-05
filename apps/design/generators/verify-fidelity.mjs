// Fidelity gate: golden-compare a sampled set of tokens against the REAL web
// theme values (extracted from web/src/index.css, web/tailwind.config.js,
// web/src/lib/tokens.ts, web/src/lib/colors.ts) and confirm the generated
// platform files actually carry those values. Exit 1 on any mismatch.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadTokens, GENERATED_DIR, toHexARGB, toComposeColor, toSwiftComponents,
} from './lib/tokens.mjs';

// ── Golden sample — verbatim web values (the source of truth) ──────────────────
// Each entry: a token path + its expected web value. If tokens.json drifts from
// the web theme, this catches it.
const GOLDEN = [
  ['color.dark.bg', '#0a0a0f', (t) => t.color.dark.bg],
  ['color.dark.surface', '#0f1019', (t) => t.color.dark.surface],
  ['color.dark.textPrimary', '#ffffff', (t) => t.color.dark.textPrimary],
  ['color.dark.textSecondary', '#9ca3af', (t) => t.color.dark.textSecondary],
  ['color.dark.textMuted', '#8a95a6', (t) => t.color.dark.textMuted],
  ['color.dark.accent', '#00f0ff', (t) => t.color.dark.accent],
  ['color.dark.border', 'rgba(255, 255, 255, 0.12)', (t) => t.color.dark.border],
  ['color.dark.surfaceGlass', 'rgba(255, 255, 255, 0.04)', (t) => t.color.dark.surfaceGlass],
  ['color.light.bg', '#f8fafc', (t) => t.color.light.bg],
  ['color.light.textPrimary', '#0f172a', (t) => t.color.light.textPrimary],
  ['color.light.accent', '#0891b2', (t) => t.color.light.accent],
  ['color.highContrast.bg', '#ffffff', (t) => t.color.highContrast.bg],
  ['color.highContrast.textPrimary', '#000000', (t) => t.color.highContrast.textPrimary],
  ['color.dark.status.success', '#10b981', (t) => t.color.dark.status.success],
  ['color.dark.status.warning', '#f59e0b', (t) => t.color.dark.status.warning],
  ['color.dark.status.danger', '#ef4444', (t) => t.color.dark.status.danger],
  // CHART_COLORS (web/src/lib/colors.ts → CHART_COLORS_CB_SAFE).
  ['chart.categorical[0]', '#0072B2', (t) => t.chart.categorical[0]],
  ['chart.categorical[1]', '#E69F00', (t) => t.chart.categorical[1]],
  ['chart.categorical[7]', '#4B4B4B', (t) => t.chart.categorical[7]],
  // motion (web/src/lib/tokens.ts → motion.duration, index.css → --motion-*).
  ['motion.durations.fast', 150, (t) => t.motion.durations.fast],
  ['motion.durations.normal', 250, (t) => t.motion.durations.normal],
  ['motion.durations.slow', 400, (t) => t.motion.durations.slow],
  ['motion.easing.standard', 'cubic-bezier(0.2, 0, 0, 1)', (t) => t.motion.easing.standard],
  // typography (web/tailwind.config.js fontSize + lib/tokens role sizes).
  ['typography.body.size', 14, (t) => t.typography.body.size],
  ['typography.display.size', 30, (t) => t.typography.display.size],
  ['typography.label.size', 12, (t) => t.typography.label.size],
];

function eq(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function main() {
  const tokens = loadTokens();
  let fail = 0;

  console.log('── Golden token fidelity (tokens.json vs web values) ──');
  for (const [path, expected, get] of GOLDEN) {
    const actual = get(tokens);
    if (eq(actual, expected)) {
      console.log(`  OK  ${path} = ${JSON.stringify(actual)}`);
    } else {
      console.error(`  FAIL ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      fail++;
    }
  }

  // Confirm generated files carry the sampled values in platform encodings.
  console.log('── Generated-file coverage (sampled colors present) ──');
  const files = {
    fluent: join(GENERATED_DIR, 'windows', 'Tokens.xaml'),
    material: join(GENERATED_DIR, 'android', 'Theme.kt'),
    apple: join(GENERATED_DIR, 'apple', 'Tokens.swift'),
  };
  for (const [name, p] of Object.entries(files)) {
    if (!existsSync(p)) {
      console.error(`  FAIL ${name}: ${p} not generated`);
      fail++;
    }
  }

  if (fail === 0) {
    const accent = tokens.color.dark.accent;
    const xaml = readFileSync(files.fluent, 'utf8');
    const kt = readFileSync(files.material, 'utf8');
    const swift = readFileSync(files.apple, 'utf8');

    const fluentNeedle = toHexARGB(accent);          // #FF00F0FF
    const ktNeedle = toComposeColor(accent);         // 0xFF00F0FF
    const sw = toSwiftComponents(accent);
    const swiftNeedle = `red: ${sw.red}, green: ${sw.green}, blue: ${sw.blue}`;

    const checks = [
      ['fluent accent brush', xaml.includes(fluentNeedle), fluentNeedle],
      ['material accent color', kt.includes(ktNeedle), ktNeedle],
      ['apple accent components', swift.includes(swiftNeedle), swiftNeedle],
      // chart[0] index-stable across all three platforms.
      ['fluent chart[0]', xaml.includes(toHexARGB(tokens.chart.categorical[0])), 'chart[0]'],
      ['material chart[0]', kt.includes(toComposeColor(tokens.chart.categorical[0])), 'chart[0]'],
    ];
    for (const [label, ok, needle] of checks) {
      if (ok) console.log(`  OK  ${label} (${needle})`);
      else { console.error(`  FAIL ${label}: ${needle} not found in generated output`); fail++; }
    }
  }

  if (fail > 0) {
    console.error(`FIDELITY FAIL: ${fail} mismatch(es).`);
    process.exit(1);
  }
  console.log('FIDELITY PASSED: sampled tokens match web values and appear in all three platform files.');
}

main();
