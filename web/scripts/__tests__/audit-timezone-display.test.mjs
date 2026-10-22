/**
 * Tests for the time-zone display audit (TZ-5 guard).
 *
 * The audit exposes `_scanSourceForTest(source, { rel })` so tests feed
 * synthetic sources instead of writing real files (fast, hermetic). Uses
 * the built-in `node:test` runner (zero deps).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { _scanSourceForTest } from '../audit-timezone-display.mjs';

const rules = (failures) => failures.map((f) => f.rule).sort();

test('R1: flags direct Intl.DateTimeFormat in a component', () => {
  const failures = _scanSourceForTest(
    `export function C() {\n  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(new Date());\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(rules(failures), ['R1']);
});

test('R1: documented tz-computation marker excuses validation probes', () => {
  const failures = _scanSourceForTest(
    `// tz-computation: validates the saved IANA zone, never renders\ntry {\n  new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);\n} catch { return 'UTC'; }\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(failures, []);
});

test('R1: marker more than 3 lines above does not excuse', () => {
  const failures = _scanSourceForTest(
    `// tz-computation: stale marker\nconst a = 1;\nconst b = 2;\nconst c = 3;\nnew Intl.DateTimeFormat('en-US').format(new Date());\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R1']);
});

test('R1: ignores the construct inside comments and strings', () => {
  const failures = _scanSourceForTest(
    `// new Intl.DateTimeFormat('') throws on empty tags\nconst hint = "use Intl.DateTimeFormat via the shared layer";\nexport const ok = 1;\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(failures, []);
});

test('R2: flags toLocaleString/toLocaleDateString/toLocaleTimeString', () => {
  const failures = _scanSourceForTest(
    `const a = d.toLocaleString();\nconst b = d.toLocaleDateString('en-US');\nconst c = d.toLocaleTimeString('en-US', { hour: '2-digit' });\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R2', 'R2', 'R2']);
});

test('R2: tz-number-format marker excuses number grouping', () => {
  const failures = _scanSourceForTest(
    `// tz-number-format: thousands grouping on a plain count\nconst label = count.toLocaleString();\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(failures, []);
});

test('R3: flags timeZoneName options', () => {
  const failures = _scanSourceForTest(
    `new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' });\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R1', 'R3']);
});

test('R3: tz-dst-offset marker excuses fall-back disambiguation', () => {
  const failures = _scanSourceForTest(
    `// tz-dst-offset: GMT offset identifies repeated fall-back hours\nconst offset = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(d);\n`,
    { rel: 'src/lib/x.ts' },
  );
  // The Intl construct still needs its own tz-computation marker.
  assert.deepEqual(rules(failures), ['R1']);
});

test('R4: flags toISOString rendered directly in JSX', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <span>{ts.toISOString()}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(rules(failures), ['R4']);
});

test('R4: ignores toISOString in handlers and memo callbacks', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  const payload = useMemo(() => ({ at: ts.toISOString() }), [ts]);\n  return <button onClick={() => send(ts.toISOString())}>go</button>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R4: tz-computation marker excuses shared-formatter arguments', () => {
  const failures = _scanSourceForTest(
    `export function C({ ms }) {\n  // tz-computation: ISO feeds the shared formatter\n  return <span>{formatDateTime(new Date(ms).toISOString())}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R4: tz-export marker excuses export builders', () => {
  const failures = _scanSourceForTest(
    `export function C({ rows }) {\n  // tz-export: CSV keeps full ISO timestamps with offsets\n  return <span>{rows[0].toISOString()}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R5: flags supportedValuesOf(timeZone) but not currency', () => {
  const tz = _scanSourceForTest(
    `const zones = Intl.supportedValuesOf('timeZone');\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(tz), ['R5']);
  const currency = _scanSourceForTest(
    `const list = Intl.supportedValuesOf('currency');\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(currency, []);
});

test('R5: tz-schedule-data marker excuses per-window zones', () => {
  const failures = _scanSourceForTest(
    `// tz-schedule-data: each quiet-hours window carries its own IANA zone\nconst zones = intlAny.supportedValuesOf('timeZone');\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(failures, []);
});
