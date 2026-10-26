import { describe, expect, it } from 'vitest';
import { formatFixtures } from './fixtures';

describe('canonical stats fixtures', () => {
  it('preserves the exact Wh/m source value for the 300 Wh/mi display example', () => {
    expect(formatFixtures.find(fixture => fixture.id === 'efficiency-mi')).toMatchObject({
      rawValue: 300 / 1609.344,
      originalExample: '300 Wh/mi',
      units: { distance: 'mi', energy: 'Wh' },
    });
  });
});
