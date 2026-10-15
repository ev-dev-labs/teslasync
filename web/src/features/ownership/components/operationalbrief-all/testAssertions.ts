import { expect } from 'vitest';
import { screen } from '@testing-library/react';

export function summaryMetric(title: string, key: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title }).closest('[data-card]');
  const metric = card?.querySelector(`[data-operational-metric="${key}"]`);
  if (!(metric instanceof HTMLElement)) throw new Error(`Missing ${title} metric ${key}`);
  return metric;
}

export function expectOperationalBand(title: string, keys: readonly string[]) {
  const card = screen.getByRole('heading', { name: title }).closest('[data-card]');
  expect(card?.querySelector('[data-operational-brief]')).toBeInTheDocument();
  expect(Array.from(card?.querySelectorAll('[data-operational-metric]') ?? [])
    .map((metric) => metric.getAttribute('data-operational-metric'))).toEqual(keys);
}
