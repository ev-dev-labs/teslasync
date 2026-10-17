import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { auditCanonicalPalettes, readCanonicalPalettes } from '../auditChartPalette.mjs';

const canonicalSource = readFileSync(new URL('../../src/lib/colors.ts', import.meta.url), 'utf8');
const names = ['CHART_COLORS_CB_SAFE', 'CHART_COLORS_NEON'];
const paletteFixture = (palette) => names
  .map((name) => `export const ${name} = ${JSON.stringify(palette)} as const;`).join('\n');
// Black/white alternation exercises lightness independently of hue.
const distinct = Array.from({ length: 8 }, (_, i) => i % 2 ? '#ffffff' : '#000000');
function run(source) {
  const output = [];
  const logger = { log: (line) => output.push(line), error: (line) => output.push(line) };
  return { exit: auditCanonicalPalettes(source, logger), output: output.join('\n') };
}

test('reads the actual exported canonical arrays and checks every adjacent pair', () => {
  const palettes = readCanonicalPalettes(canonicalSource);
  for (const name of names) {
    assert.equal(palettes[name].length, 8);
    const { output } = run(canonicalSource);
    for (let i = 0; i < 7; i++) {
      assert.ok(output.includes(`[${i}] ${palettes[name][i]} -> ${palettes[name][i + 1]}`));
    }
  }
});

test('a valid fixture passes without requiring obsolete hex anchors', () => {
  assert.equal(run(paletteFixture(distinct)).exit, 0);
});

test('interior canonical drift fails even when old literals remain elsewhere', () => {
  const drifted = [...distinct];
  drifted[3] = drifted[2];
  const comments = canonicalSource.split('\n').map((line) => `// ${line}`).join('\n');
  const result = run(`${paletteFixture(drifted)}\n${comments}`);
  assert.equal(result.exit, 1);
  assert.match(result.output, /\[2\] #000000 -> #000000.*FAIL/);
});

test('removed, nonexported, malformed, and shortened palettes fail closed', () => {
  const fixtures = [
    paletteFixture(distinct).replace('CHART_COLORS_NEON', 'REMOVED'),
    paletteFixture(distinct).replace('export const CHART_COLORS_NEON', 'const CHART_COLORS_NEON'),
    paletteFixture(distinct).replace('"#000000"', '"not-a-color"'),
    paletteFixture(distinct.slice(0, 7)),
    paletteFixture(distinct).replace('[', 'getPalette(['),
    paletteFixture(distinct).replace(' as const', ' as const; export const CHART_COLORS_CB_SAFE = []'),
  ];
  for (const source of fixtures) {
    const result = run(source);
    assert.equal(result.exit, 1, source);
    assert.match(result.output, /drift guard:/);
  }
});

test('unresolved canonical token references cannot silently waive missing data', () => {
  const source = paletteFixture(distinct).replace('"#000000"', 'missingToken');
  assert.equal(run(source).exit, 1);
});

test('the unchanged 30-degree threshold rejects the actual near-threshold pair', () => {
  const fixture = [...distinct];
  fixture[3] = '#d6a0a5';
  fixture[4] = '#c3a2b5';
  const result = run(paletteFixture(fixture));
  assert.equal(result.exit, 1);
  assert.match(result.output, /\[3\] #d6a0a5 -> #c3a2b5.*dH=29\.8°.*FAIL/);
  assert.match(result.output, /dL >= 0\.1 OR dH >= 30°/);
});

test('drift sensitivity includes a temporary override of the actual canonical source', () => {
  const palettes = readCanonicalPalettes(canonicalSource);
  const changed = canonicalSource.replace(palettes.CHART_COLORS_CB_SAFE[3], palettes.CHART_COLORS_CB_SAFE[2]);
  const result = run(changed);
  assert.equal(result.exit, 1);
  assert.ok(result.output.includes(`[2] ${palettes.CHART_COLORS_CB_SAFE[2]} -> ${palettes.CHART_COLORS_CB_SAFE[2]}`));
});
