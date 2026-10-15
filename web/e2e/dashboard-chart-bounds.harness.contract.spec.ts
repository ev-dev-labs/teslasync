import { expect, test } from '@playwright/test';
import { assertCatalogueFullBounds, type CatalogueBounds } from './dashboardCatalogueBounds';

const bounds = (left: number, top: number, width: number, height: number): CatalogueBounds => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test('fixed viewport detects the captured nineteen-pixel caption displacement', () => {
  const viewport = bounds(289, 451.75, 1102, 160);
  const svg = bounds(289, 470.75, 1102, 160);
  expect(() => assertCatalogueFullBounds(svg, viewport, 'Captured DrivingDynamics SVG'))
    .toThrow(/clipped at bottom/);
});

test('caption outside the fixed viewport leaves the SVG fully contained', () => {
  const viewport = bounds(289, 470.75, 1102, 160);
  expect(() => assertCatalogueFullBounds(viewport, viewport, 'Geometry-only outside caption'))
    .not.toThrow();
});

test('an in-viewport DOM legend cannot consume extra height below a full-height SVG', () => {
  const viewport = bounds(0, 0, 720, 180);
  expect(() => assertCatalogueFullBounds(bounds(0, 20, 720, 180), viewport, 'Geometry-only DOM legend'))
    .toThrow(/clipped at bottom/);
});

test('managed chart legend with contained SVG and ticks remains valid', () => {
  const viewport = bounds(0, 0, 720, 180);
  assertCatalogueFullBounds(viewport, viewport, 'Geometry-only managed legend SVG');
  assertCatalogueFullBounds(bounds(30, 150, 40, 12), viewport, 'Geometry-only X glyph');
});

test('full X-axis glyph bottom is checked even when horizontal bounds fit', () => {
  expect(() => assertCatalogueFullBounds(bounds(30, 155, 40, 12), bounds(0, 0, 720, 160), 'Geometry-only X glyph'))
    .toThrow(/clipped at bottom/);
});

test('full rotated-axis glyph top is checked', () => {
  expect(() => assertCatalogueFullBounds(bounds(30, -2, 40, 12), bounds(0, 0, 720, 160), 'Geometry-only rotated glyph'))
    .toThrow(/clipped at top/);
});

test('the original one-pixel tolerance remains exact', () => {
  const viewport = bounds(0, 0, 720, 160);
  assertCatalogueFullBounds(bounds(-1, -1, 722, 162), viewport, 'One-pixel allowance');
  expect(() => assertCatalogueFullBounds(bounds(0, 0, 720, 161.01), viewport, 'Beyond allowance'))
    .toThrow(/clipped at bottom/);
});
