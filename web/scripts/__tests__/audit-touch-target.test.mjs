/**
 * Phase-46 / Prompt 69 — Tests for the touch-target audit.
 *
 * The audit script exposes two test seams:
 *  • `_classifyForTest({ openTag, elementName, innerContent, allowlisted })`
 *    — classify a single element directly, bypassing file I/O.
 *  • `_scanSourceForTest(source, { rel, allowlist })` — feed an entire
 *    synthetic `.tsx` source string and get back the list of failures.
 *
 * Tests use these seams instead of writing real files so they're fast
 * and hermetic across CI runners. We use the built-in `node:test`
 * runner (zero deps) per the prompt's requirement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  _classifyForTest,
  _scanSourceForTest,
} from '../audit-touch-target.mjs';

// ────────────────────────────────────────────────────────────────────────────
// _classifyForTest — single-element checks
// ────────────────────────────────────────────────────────────────────────────

test('skip: element without interactive prop', () => {
  const r = _classifyForTest({
    openTag: '<button>',
    elementName: 'button',
    innerContent: 'Decorative',
    allowlisted: false,
  });
  assert.equal(r.status, 'skip');
});

test('skip: explicitly allowlisted element', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x}>',
    elementName: 'button',
    innerContent: '<svg className="h-4 w-4" />',
    allowlisted: true,
  });
  assert.equal(r.status, 'skip');
});

test('pass: element with min-h-11 min-w-11 safe class', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="min-h-11 min-w-11">',
    elementName: 'button',
    innerContent: '<svg className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: element with touch-target utility class', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="touch-target">',
    elementName: 'button',
    innerContent: '<svg className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: <Button> with size="lg"', () => {
  const r = _classifyForTest({
    openTag: '<Button size="lg" onClick={x}>',
    elementName: 'Button',
    innerContent: 'Save',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: <Button> with no size prop (defaults to md)', () => {
  const r = _classifyForTest({
    openTag: '<Button onClick={x}>',
    elementName: 'Button',
    innerContent: 'Save',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: arbitrary-value Tailwind size like h-[44px]', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="h-[44px] w-[44px]">',
    elementName: 'button',
    innerContent: '<svg className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: density-aware row token h-d-row', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="h-d-row min-w-11">',
    elementName: 'button',
    innerContent: '<svg className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: padding p-3 around an icon', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="rounded p-3">',
    elementName: 'button',
    innerContent: '<X className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('pass: anchor with text content (not icon-only)', () => {
  const r = _classifyForTest({
    openTag: '<a href="/x">',
    elementName: 'a',
    innerContent: 'Read more',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('fail: tiny size class h-5 w-5 on element itself (20px < 24px floor)', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="h-5 w-5">',
    elementName: 'button',
    innerContent: 'X',
    allowlisted: false,
  });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /tiny size/);
});

test('pass: h-6 w-6 on element itself (24px meets WCAG 2.5.8 AA)', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="h-6 w-6">',
    elementName: 'button',
    innerContent: 'X',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('fail: icon-only child without padding', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x}>',
    elementName: 'button',
    innerContent: '<X className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /icon-only/);
});

test('fail: icon-only child with too-small padding (p-1)', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="rounded p-1">',
    elementName: 'button',
    innerContent: '<X className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'fail');
});

test('pass: icon-only child with safe padding p-2', () => {
  const r = _classifyForTest({
    openTag: '<button onClick={x} className="rounded p-2">',
    elementName: 'button',
    innerContent: '<X className="h-4 w-4" />',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

test('skip: <a> with no href and no onClick (not interactive)', () => {
  const r = _classifyForTest({
    openTag: '<a className="text-cyan-300">',
    elementName: 'a',
    innerContent: 'Static label',
    allowlisted: false,
  });
  assert.equal(r.status, 'skip');
});

test('pass: anchor with `to` (react-router Link uses `to=`)', () => {
  const r = _classifyForTest({
    openTag: '<a to="/x" className="touch-target">',
    elementName: 'a',
    innerContent: 'Go',
    allowlisted: false,
  });
  assert.equal(r.status, 'pass');
});

// ────────────────────────────────────────────────────────────────────────────
// _scanSourceForTest — synthetic-file end-to-end checks
// ────────────────────────────────────────────────────────────────────────────

test('synthetic file with bad button — failure cites the line number', () => {
  const src = [
    '// good control',
    '<button onClick={save} className="min-h-11 min-w-11">Save</button>',
    '',
    '// bad control: icon-only button with no padding (line 5)',
    '<button onClick={close}>',
    '  <X className="h-4 w-4" />',
    '</button>',
  ].join('\n');
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].line, 5);
  assert.equal(failures[0].elementName, 'button');
});

test('synthetic file passes when every element has a safe class', () => {
  const src = [
    '<button onClick={a} className="touch-target">A</button>',
    '<button onClick={b} className="min-h-11 min-w-11">B</button>',
    '<a href="/x" className="p-3">C</a>',
    '<Button onClick={d} size="lg">D</Button>',
    '<Button onClick={e}>Default</Button>',
  ].join('\n');
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 0);
});

test('synthetic allowlisted entry suppresses an otherwise-failing element', () => {
  const src =
    '<button onClick={close}><X className="h-4 w-4" /></button>';
  const allowlist = [
    {
      file: 'features/widget/Widget.tsx',
      element: 'button',
      reason: 'high-density row toolbar — covered by parent overlay',
    },
  ];
  const failures = _scanSourceForTest(src, {
    rel: 'web/src/features/widget/Widget.tsx',
    allowlist,
  });
  assert.equal(failures.length, 0);
});

test('allowlist with mismatched file does not suppress failure', () => {
  const src =
    '<button onClick={close}><X className="h-4 w-4" /></button>';
  const allowlist = [
    {
      file: 'features/other/Other.tsx',
      element: 'button',
      reason: 'unrelated',
    },
  ];
  const failures = _scanSourceForTest(src, {
    rel: 'web/src/features/widget/Widget.tsx',
    allowlist,
  });
  assert.equal(failures.length, 1);
});

test('synthetic file with multiple failures reports each one', () => {
  const src = [
    '<button onClick={a} className="h-5 w-5">A</button>',
    '<button onClick={b}><Icon className="h-4 w-4" /></button>',
    '<button onClick={c} className="min-h-11">OK</button>',
  ].join('\n');
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 2);
  assert.equal(failures[0].line, 1);
  assert.equal(failures[1].line, 2);
});

test('block-comment example does not false-positive', () => {
  const src = [
    '/*',
    ' * Example: <button onClick={x}><X className="h-4 w-4" /></button>',
    ' */',
    '<button onClick={save} className="touch-target">Save</button>',
  ].join('\n');
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 0);
});

test('JSX expression children with nested braces do not break tag scan', () => {
  const src =
    '<Button onClick={() => onSave({ a: 1, b: 2 })} size="lg">Save</Button>';
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 0);
});

test('<Avatar> and <address> do not match the audit (lookahead guard)', () => {
  const src = [
    '<Avatar src="/x.png" />',
    '<address className="text-sm">123 Main St</address>',
  ].join('\n');
  const failures = _scanSourceForTest(src);
  assert.equal(failures.length, 0);
});
