import { expect } from '@playwright/test';

export interface CatalogueBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function assertCatalogueFullBounds(
  inner: CatalogueBounds, outer: CatalogueBounds, label: string,
) {
  expect(inner.width, `${label}: unmeasured width`).toBeGreaterThan(0);
  expect(inner.height, `${label}: unmeasured height`).toBeGreaterThan(0);
  expect(inner.left, `${label}: clipped at left`).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.right, `${label}: clipped at right`).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.top, `${label}: clipped at top`).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.bottom, `${label}: clipped at bottom`).toBeLessThanOrEqual(outer.bottom + 1);
}
