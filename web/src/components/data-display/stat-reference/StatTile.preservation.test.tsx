import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatMetric, type MetricPreferences, type StatPeriod } from '@/lib/metric-reference';
import { StatStrip, type StatMetric } from './index';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback: string) => ({
    'developerReference.stats.reason.nonfinite': 'Translated finite-measurement explanation',
    'developerReference.stats.valueState.invalid': 'Translated invalid state',
  } as Record<string, string>)[key] ?? fallback,
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span> };
});
const preferences: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};
const analysis: StatPeriod = { kind: 'analysis', label: 'Explicit analysis window',
  start: '2026-09-27T00:00:00Z', endExclusive: '2026-10-04T00:00:00Z', timezone: 'UTC',
  completeness: 'unknown', provenance: 'synthetic-test-only' };
const unknown: StatPeriod = { kind: 'unknown', label: 'Prior source window',
  reason: 'No backend query or complete-window claim is associated with these fixtures.' };
afterEach(cleanup);

describe('Stat comparison preservation', () => {
  it('preserves unknown comparison reason even when the strip analysis period is known', () => {
    const { container } = render(<StatStrip period={analysis} preferences={preferences}
      metrics={[{ metricId: 'count', rawValue: 6, comparison: {
        metricId: 'number', rawValue: 2, signed: true, period: unknown, label: 'Change in sessions',
      } }]} />);
    const delta = container.querySelector('[data-stat-delta]');
    expect(delta).toHaveAttribute('data-comparison-state', 'value');
    expect(delta).toHaveTextContent('Change in sessions: +2.00');
    expect(delta?.querySelector('[data-stat-comparison-period]')).toHaveTextContent(unknown.label);
    expect(delta?.querySelector('[data-stat-comparison-period-reason]')).toHaveTextContent(unknown.reason!);
    expect(screen.getByText(unknown.reason!)).toBeVisible();
    expect(container.querySelector('[data-stat-comparison-reason]')).toBeNull();
    expect(container.querySelector('[data-stat-comparison-state-label]')).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])('preserves nonfinite comparison %s, translated state and reason', rawValue => {
    const { container } = render(<StatStrip period={analysis} preferences={preferences}
      metrics={[{ metricId: 'energy', rawValue: 26340, comparison: {
        metricId: 'percent', rawValue, signed: true, period: unknown, label: 'Energy change',
      } }]} />);
    const delta = container.querySelector('[data-stat-delta]');
    expect(delta).toHaveAttribute('data-comparison-state', 'invalid');
    expect(delta).toHaveTextContent('Energy change: —');
    expect(delta).not.toHaveTextContent('+—');
    expect(delta?.querySelector('[data-stat-comparison-state-label]')).toHaveTextContent('Translated invalid state');
    expect(delta?.querySelector('[data-stat-comparison-reason]')).toHaveTextContent('Translated finite-measurement explanation');
    expect(screen.getByText('Translated finite-measurement explanation')).toBeVisible();
    expect(screen.getByText(unknown.reason!)).toBeVisible();
    const result = formatMetric('percent', rawValue, preferences);
    expect(result.state).toBe('invalid');
    expect(result.reasonKey).toBe('developerReference.stats.reason.nonfinite');
    expect(Object.is(result.rawValue, rawValue)).toBe(true);
  });

  it('gives a full-tile link the main value, signed comparison, period and uncertainty context', () => {
    render(<MemoryRouter><StatStrip period={analysis} preferences={preferences}
      metrics={[{ metricId: 'count', rawValue: 6, href: '/dev/stats', comparison: {
        metricId: 'number', rawValue: 2, signed: true, period: unknown, label: 'Change in sessions',
      } }]} /></MemoryRouter>);
    const name = `Count: 6; Change in sessions: +2.00; ${unknown.label}; ${unknown.reason}`;
    const link = screen.getByRole('link', { name });
    expect(link).toHaveAccessibleName(name);
    expect(link).toHaveAttribute('href', '/dev/stats');
    expect(link).toHaveAttribute('data-stat');
    expect(link.className).toContain('focus-visible:ring-2');
    link.focus();
    expect(link).toHaveFocus();
  });

  it('includes both main missing and invalid-comparison explanations in a linked tile name', () => {
    render(<MemoryRouter><StatStrip period={analysis} preferences={preferences}
      metrics={[{ metricId: 'energy', rawValue: null, missingReason: 'Original main missing reason',
        href: '/dev/stats', comparison: { metricId: 'percent', rawValue: NaN,
          period: unknown, label: 'Energy change' } }]} /></MemoryRouter>);
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(`Energy: —; Original main missing reason; Energy change: —; ${unknown.label}; ${unknown.reason}; Translated invalid state; Translated finite-measurement explanation`);
    expect(screen.getByText('Original main missing reason')).toBeVisible();
    expect(screen.getByText('Translated finite-measurement explanation')).toBeVisible();
  });

  it('omits absent comparison without changing raw values, facts or preferences', () => {
    const metric: StatMetric = Object.freeze({ metricId: 'energy', rawValue: 26340, href: '/dev/stats' });
    const facts = Object.freeze(['4 home', '2 Supercharger', 'Recorded cost']);
    const before = JSON.stringify({ metric, facts, preferences, analysis });
    const { container } = render(<MemoryRouter><StatStrip period={analysis} preferences={preferences}
      metrics={[metric]} breakdown={facts} /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAccessibleName('Energy: 26.34 kWh');
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(1);
    for (const selector of ['[data-stat-delta]', '[data-stat-comparison-period]',
      '[data-stat-comparison-period-reason]', '[data-stat-comparison-state-label]', '[data-stat-comparison-reason]'])
      expect(container.querySelector(selector)).toBeNull();
    expect(container.querySelector('[data-stat-breakdown]')).toHaveTextContent(facts.join(' · '));
    expect(formatMetric(metric.metricId, metric.rawValue, preferences).rawValue).toBe(26340);
    expect(JSON.stringify({ metric, facts, preferences, analysis })).toBe(before);
  });

  it('preserves zero, raw signed comparison and supplied facts across a precision update', () => {
    const sourcePeriod = Object.freeze({ ...unknown });
    const comparison = Object.freeze({ metricId: 'percent' as const, rawValue: -4,
      period: sourcePeriod, label: 'Original energy change', signed: true });
    const metric: StatMetric = Object.freeze({ metricId: 'energy', rawValue: 0, comparison });
    const facts = Object.freeze(['Original category fact', 'Original cost fact']);
    const before = JSON.stringify({ metric, facts, preferences });
    const { container, rerender } = render(<StatStrip period={analysis} preferences={preferences}
      metrics={[metric]} breakdown={facts} />);
    expect(container.querySelector('[data-stat-value]')).toHaveTextContent('0.00');
    expect(container.querySelector('[data-stat-delta]')).toHaveTextContent('Original energy change: -4.00%');
    rerender(<StatStrip period={analysis}
      preferences={{ ...preferences, units: { ...preferences.units, precision: 4 } }}
      metrics={[metric]} breakdown={facts} />);
    expect(container.querySelector('[data-stat-value]')).toHaveTextContent('0.0000');
    expect(container.querySelector('[data-stat-delta]')).toHaveTextContent('Original energy change: -4.0000%');
    expect(container.querySelector('[data-stat-comparison-period-reason]')).toHaveTextContent(sourcePeriod.reason!);
    expect(container.querySelector('[data-stat-breakdown]')).toHaveTextContent(facts.join(' · '));
    expect(comparison.rawValue).toBe(-4);
    expect(metric.rawValue).toBe(0);
    expect(JSON.stringify({ metric, facts, preferences })).toBe(before);
  });
});
