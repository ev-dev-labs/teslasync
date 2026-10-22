/**
 * Tests for the time-zone display audit (TZ-5 guard).
 *
 * The audit exposes `_scanSourceForTest(source, { rel })` so tests feed
 * synthetic sources instead of writing real files (fast, hermetic). Uses
 * the built-in `node:test` runner (zero deps).
 *
 * The guard has no marker comments or per-site exceptions: every rule is
 * settled by code shape alone. These tests pin both sides — real
 * violations fail, and values passed to shared date components,
 * machine attributes, or shared formatters pass.
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

test('R1: flags zone validation probes (use isValidTimeZone instead)', () => {
  const failures = _scanSourceForTest(
    `try {\n  new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);\n} catch { return 'UTC'; }\n`,
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

test('R2: flags number.toLocaleString (numbers use the shared number layer)', () => {
  const failures = _scanSourceForTest(
    `const label = count.toLocaleString();\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R2']);
  assert.match(failures[0].fix, /numberFormat/);
});

test('R3: flags timeZoneName options', () => {
  const failures = _scanSourceForTest(
    `new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' });\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R1', 'R3']);
});

test('R4: flags toISOString rendered directly in JSX', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <span>{ts.toISOString()}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(rules(failures), ['R4']);
});

test('R4: flags chained derivations of rendered ISO', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <span>{ts.toISOString().slice(0, 10)}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(rules(failures), ['R4']);
});

test('R4: flags ISO passed to non-shared calls', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <span>{String(ts.toISOString())}</span>;\n}\n`,
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

test('R4: ignores ISO in <time dateTime> machine attributes', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <time dateTime={ts.toISOString()}>{formatDateTime(ts)}</time>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R4: ignores values passed to shared date components', () => {
  const failures = _scanSourceForTest(
    `export function C({ ts }) {\n  return <><TimeStamp value={ts.toISOString()} /><DateTime value={ts} variant="full" /></>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R4: ignores ISO nested in shared-layer formatter calls', () => {
  const failures = _scanSourceForTest(
    `import { formatDateTime } from '@/lib/dateFormat';\nexport function C({ ms }) {\n  return <span>{formatDateTime(new Date(ms).toISOString())}</span>;\n}\n`,
    { rel: 'src/components/C.tsx' },
  );
  assert.deepEqual(failures, []);
});

test('R4: ignores ISO nested in hook-destructured formatter calls', () => {
  const failures = _scanSourceForTest(
    `export function C({ ms }) {\n  const { formatDateTime } = useDateFormat();\n  return <span>{formatDateTime(new Date(ms).toISOString())}</span>;\n}\n`,
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

test('R5: flags member-expression supportedValuesOf(timeZone)', () => {
  const failures = _scanSourceForTest(
    `const zones = intlAny.supportedValuesOf('timeZone');\n`,
    { rel: 'src/lib/x.ts' },
  );
  assert.deepEqual(rules(failures), ['R5']);
});
