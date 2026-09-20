import assert from 'node:assert/strict';
import test from 'node:test';
import { setNested } from './i18n-validate-keys.mjs';

test('rejects dangerous segments before mutating any path', () => {
  for (const segment of ['__proto__', 'prototype', 'constructor']) {
    for (const key of [segment, `${segment}.polluted`, `safe.${segment}.polluted`]) {
      const target = {};
      assert.equal(setNested(target, key, 'bad'), false);
      assert.deepEqual(target, {});
      assert.equal(Object.prototype.polluted, undefined);
    }
  }
});

test('creates own null-prototype dictionaries and preserves existing leaves', () => {
  const target = {};
  assert.equal(setNested(target, 'safe.label', 'hello'), true);
  assert.equal(Object.getPrototypeOf(target.safe), null);
  assert.equal(target.safe.label, 'hello');
  assert.equal(setNested(target, 'safe.label', 'changed'), false);
  assert.equal(setNested({ safe: null }, 'safe.label', 'changed'), false);
});
