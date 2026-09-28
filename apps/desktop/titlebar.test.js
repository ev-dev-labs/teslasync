'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HEIGHT, isTitleBarTheme, isIconDataURL } = require('./titlebar');

test('title bar accepts only explicit six-digit theme colors', () => {
  assert.equal(HEIGHT, 32);
  assert.equal(isTitleBarTheme({ color: '#f5f6f8', symbolColor: '#020617' }), true);
  assert.equal(isTitleBarTheme({ color: '#0b0d12', symbolColor: '#ffffff' }), true);
  for (const value of [
    null, {}, { color: '#fff', symbolColor: '#000' },
    { color: 'transparent', symbolColor: '#020617' },
    { color: '#f5f6f8', symbolColor: { toString: () => '#020617' } },
  ]) {
    assert.equal(isTitleBarTheme(value), false);
  }
});

test('window icon IPC accepts only bounded PNG data URLs', () => {
  assert.equal(isIconDataURL('data:image/png;base64,iVBORw0KGgo='), true);
  for (const value of [
    null, 'data:image/svg+xml;base64,iVBORw0KGgo=',
    'data:image/png;base64,<script>', 'data:image/png;base64,' + 'a'.repeat(300_000),
  ]) {
    assert.equal(isIconDataURL(value), false);
  }
});
