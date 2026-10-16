import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNestedSurfaces } from '../audit-nested-surfaces.mjs';

test('no standalone evidence brief is rendered inside another card or widget surface', () => {
  const { nestedBriefs, nestedSurfaces } = analyzeNestedSurfaces();
  assert.deepEqual(nestedBriefs, []);
  assert.deepEqual(nestedSurfaces, []);
});

test('no card repeats its title as an immediately enclosing heading', () => {
  const { duplicateTitles } = analyzeNestedSurfaces();
  assert.deepEqual(duplicateTitles, []);
});
