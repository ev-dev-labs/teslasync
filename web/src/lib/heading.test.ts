import { describe, expect, it } from 'vitest';
import { headingToCardinal } from './heading';

describe('headingToCardinal', () => {
  it.each([
    [0, 'N'],
    [2, 'N'],
    [42, 'NE'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
    [315, 'NW'],
    [360, 'N'],
    [-45, 'NW'],
  ])('maps %s° to %s', (deg, expected) => {
    expect(headingToCardinal(deg)).toBe(expected);
  });

  it.each([[null], [undefined], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'returns an em dash for %s',
    (deg) => {
      expect(headingToCardinal(deg)).toBe('—');
    },
  );
});
