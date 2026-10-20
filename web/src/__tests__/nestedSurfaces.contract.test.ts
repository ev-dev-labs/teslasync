import { describe, expect, it } from 'vitest';
import { analyzeNestedSurfaces } from '../../scripts/audit-nested-surfaces.mjs';

describe('nested card surface contract', () => {
  it('keeps every page to one bordered surface per block and one title per card', () => {
    const { nestedBriefs, nestedSurfaces, duplicateTitles } = analyzeNestedSurfaces();
    expect(nestedBriefs).toEqual([]);
    expect(nestedSurfaces).toEqual([]);
    expect(duplicateTitles).toEqual([]);
  });
});
