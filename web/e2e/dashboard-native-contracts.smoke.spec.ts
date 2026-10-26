import { expect, test } from '@playwright/test';
import { assertPressurePaParity } from './dashboardCataloguePressureParity';
import { catalogueVerticalGap } from './dashboardCatalogueGeometry';

const source = {
  front_left: 280000, front_right: 285000, rear_left: 290000, rear_right: 295000,
};

test('pressure parity retains all four raw Pa readings', () => {
  expect(() => assertPressurePaParity(source, { ...source })).not.toThrow();
});

for (const field of Object.keys(source)) {
  test(`pressure parity rejects a changed ${field} reading`, () => {
    expect(() => assertPressurePaParity(source, { ...source, [field]: 0 })).toThrow();
  });
}

test('pressure parity rejects missing fields and never equates unknown with zero', () => {
  expect(() => assertPressurePaParity({}, {})).toThrow();
  expect(() => assertPressurePaParity(
    { ...source, front_left: null }, { ...source, front_left: 0 },
  )).toThrow();
});

test('chart allocation accepts either vertical order without accepting overlap', () => {
  const headline = { y: 20, height: 100 };
  const chart = { y: 132, height: 240 };
  expect(catalogueVerticalGap(headline, chart)).toBe(12);
  expect(catalogueVerticalGap(chart, headline)).toBe(12);
  expect(catalogueVerticalGap(headline, { y: 120, height: 240 })).toBe(0);
  expect(catalogueVerticalGap(headline, { y: 90, height: 240 })).toBe(-30);
  expect(catalogueVerticalGap({ y: 90, height: 240 }, headline)).toBe(-30);
  expect(catalogueVerticalGap(headline, { y: 118.99, height: 240 })).toBeLessThan(-1);
});
