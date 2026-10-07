import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { MetricPreferences, StatPeriod } from '@/lib/metric-reference';
import { StatStrip } from './StatStrip';
import type { StatMetric } from './types';

const saved = vi.hoisted(() => ({
  settings: { unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
    locale: 'de-DE', decimal_precision: 3, currency_symbol: '€' },
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: saved.settings, settingsUnavailable: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }));

const period: StatPeriod = { kind: 'unknown', label: 'Source window unavailable', reason: 'Bounds were not recorded' };
const analysis: StatPeriod = { kind: 'analysis', label: 'Recorded October window',
  start: '2026-10-01T00:00:00Z', endExclusive: '2026-10-05T00:00:00Z',
  timezone: 'UTC', completeness: 'subset', provenance: 'Completed source records only' };
const initial = getFormatterPreferences();
afterEach(() => {
  cleanup();
  setGlobalPrecision(initial.precision);
  setGlobalLocale(initial.locale);
  saved.settings = { unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
    locale: 'de-DE', decimal_precision: 3, currency_symbol: '€' };
});

describe('production StatStrip content preservation', () => {
  it('renders every occurrence in ordered six-column banks without mutating raw measurements', () => {
    const metrics: readonly StatMetric[] = Object.freeze(Array.from({ length: 14 }, (_, index) =>
      Object.freeze({ metricId: 'count' as const, rawValue: index, occurrenceId: `record-${index}`,
        label: `Source measurement ${index}` })));
    const { container } = render(<StatStrip metrics={metrics} period={analysis} testId="production-stats" />);
    const tiles = [...container.querySelectorAll('[data-stat]')];
    expect(tiles).toHaveLength(14);
    expect(tiles.map(tile => tile.querySelector('[data-stat-label]')?.textContent))
      .toEqual(metrics.map(metric => metric.label));
    expect(tiles.map(tile => tile.querySelector('[data-stat-value]')?.textContent))
      .toEqual(metrics.map(metric => String(metric.rawValue)));
    expect([...container.querySelectorAll('[data-stat-bank]')].map(bank => bank.getAttribute('data-columns')))
      .toEqual(['6', '6', '2']);
    expect(screen.getByTestId('production-stats-kpis-2').querySelectorAll('[data-stat]')).toHaveLength(2);
    expect(metrics.map(metric => metric.rawValue)).toEqual(Array.from({ length: 14 }, (_, index) => index));
  });

  it('keeps repeated semantic occurrences attached to their stable nodes when reordered', () => {
    const first: StatMetric = { metricId: 'energy', rawValue: 850, occurrenceId: 'home', label: 'Home energy' };
    const second: StatMetric = { metricId: 'energy', rawValue: 26340, occurrenceId: 'away', label: 'Away energy' };
    const { container, rerender } = render(<StatStrip metrics={[first, second]} period={period} />);
    const before = [...container.querySelectorAll('[data-stat]')];
    rerender(<StatStrip metrics={[second, first]} period={period} />);
    const after = [...container.querySelectorAll('[data-stat]')];
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after.map(tile => tile.querySelector('[data-stat-label]')?.textContent)).toEqual(['Away energy', 'Home energy']);
    expect(after[0]?.querySelector('[data-stat-value]')).toHaveTextContent('26,340');
    expect(after[1]?.querySelector('[data-stat-value]')).toHaveTextContent('0,850');
  });

  it('distinguishes measured zero from null and undefined with caller missing reasons intact', () => {
    const { container } = render(<StatStrip period={period} metrics={[
      { metricId: 'energy', rawValue: 0, label: 'Measured energy' },
      { metricId: 'energy', rawValue: null, label: 'Absent energy', missingReason: 'Source withheld energy' },
      { metricId: 'count', rawValue: undefined, label: 'Unknown records' },
    ]} />);
    const tiles = [...container.querySelectorAll('[data-stat]')];
    expect(tiles.map(tile => tile.getAttribute('data-state'))).toEqual(['value', 'missing', 'missing']);
    expect(tiles[0]?.querySelector('[data-stat-value]')).toHaveTextContent('0,000');
    expect(tiles[0]).not.toHaveAttribute('data-missing-reason');
    expect(tiles[1]).toHaveAttribute('data-missing-reason', 'Source withheld energy');
    expect(tiles[1]).toHaveAttribute('aria-label', 'Absent energy: —; Source withheld energy');
    expect(tiles[2]).toHaveAttribute('data-missing-reason', 'No measurement supplied');
  });

  it('retains every value, metadata slot and source error during refresh instead of replacing them', () => {
    const { container, rerender } = render(<StatStrip id="retained-strip" period={analysis}
      metrics={[{ metricId: 'count', rawValue: 0 }]} loading retained error="Refresh failed"
      breakdown={['Recorded zero', 'Subset totals']} secondary={<span>Independent source status</span>}
      footer={<a href="/exports">Existing export</a>} />);
    expect(container.querySelector('#retained-strip')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('#retained-strip')).toHaveAttribute('data-retained', 'true');
    expect(container.querySelector('[data-stat]')).toHaveAttribute('data-state', 'value');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
    expect(screen.queryByText('Loading measurements')).not.toBeInTheDocument();
    expect(container.querySelector('[data-stat-breakdown]')).toHaveTextContent('Recorded zero · Subset totals');
    expect(container.querySelector('[data-stat-secondary]')).toHaveTextContent('Independent source status');
    expect(screen.getByRole('link', { name: 'Existing export' })).toHaveAttribute('href', '/exports');
    rerender(<StatStrip period={analysis} metrics={[{ metricId: 'count', rawValue: 0 }]} loading />);
    expect(container.querySelector('[data-stat]')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByText('Loading measurements')).toBeInTheDocument();
  });

  it('keeps unknown reasons until the owning header explicitly acknowledges the context', () => {
    const { container, rerender } = render(<><p id="source-period">{period.label}</p>
      <StatStrip metrics={[]} period={period} periodInHeader periodHeaderId="source-period" /></>);
    const strip = container.querySelector('[data-stat-strip]');
    expect(strip).toHaveAttribute('aria-describedby', 'source-period');
    expect(container.querySelector('#source-period')).toHaveTextContent(period.label);
    expect(strip?.querySelector('[data-stat-period]')).toBeNull();
    expect(screen.getByText(period.reason ?? '')).toBeInTheDocument();
    rerender(<><p id="source-period">{period.label}; {period.reason}</p>
      <StatStrip metrics={[]} period={period} periodInHeader periodHeaderId="source-period" periodContextInHeader /></>);
    expect(container.querySelector('[data-stat-strip]')).toHaveAttribute('aria-describedby', 'source-period');
    expect(container.querySelector('[data-stat-strip]')).not.toHaveTextContent(period.reason ?? '');
    expect(container.querySelector('#source-period')).toHaveTextContent(period.reason ?? '');
  });

  it('preserves title, comparison label, provenance, semantic tags, slots and footer interaction', () => {
    const action = vi.fn();
    const { container } = render(<MemoryRouter><StatStrip id="summary" testId="summary-stats" title="Source summary"
      className="caller-layout" variant="embedded" metrics={[{ metricId: 'count', rawValue: 7, href: '/drives' }]}
      period={analysis} comparisonLabel="Same-source comparison" breakdown={['7 completed', '1 excluded']}
      secondary={<a href="/source-details">Source details</a>} footer={<a href="/export"
        onClick={event => { event.preventDefault(); action(); }}>Export source</a>} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Source summary', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Same-source comparison').tagName).toBe('SPAN');
    expect(container.querySelector('[data-stat-provenance]')?.tagName).toBe('P');
    expect(container.querySelector('[data-stat-provenance]')).toHaveTextContent(analysis.provenance);
    expect(screen.getByTestId('summary-stats')).toHaveClass('caller-layout');
    expect(container.querySelector('[data-stat-secondary]')?.tagName).toBe('DIV');
    expect(container.querySelector('[data-stat-footer]')?.tagName).toBe('DIV');
    expect(screen.getByRole('link', { name: /^Count: 7$/ })).toHaveAttribute('href', '/drives');
    expect(screen.getByRole('link', { name: 'Source details' })).toHaveAttribute('href', '/source-details');
    fireEvent.click(screen.getByRole('link', { name: 'Export source' }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('keeps snapshot freshness and provenance visible even when observation time is unknown', () => {
    const snapshot: StatPeriod = { kind: 'snapshot', label: 'Observation time unknown',
      observedAt: null, provenance: 'Retained live source' };
    const { container } = render(<StatStrip metrics={[{ metricId: 'status', rawValue: 'Unknown freshness' }]}
      period={snapshot} />);
    expect(container.querySelector('[data-stat-strip]')).toHaveAttribute('data-period-kind', 'snapshot');
    expect(container.querySelector('[data-stat-freshness]')).toHaveTextContent(snapshot.label);
    expect(container.querySelector('[data-stat-period]')).toBeNull();
    expect(container.querySelector('[data-stat-provenance]')).toHaveTextContent(snapshot.provenance);
    expect(screen.getByText('Unknown freshness')).toBeInTheDocument();
  });

  it('honors saved locale, units, precision and currency without mutating them on rerenders', () => {
    const original = { ...saved.settings };
    const metrics: readonly StatMetric[] = [
      { metricId: 'distance', rawValue: 1609.344 }, { metricId: 'currency', rawValue: 12.5 },
    ];
    const { container, rerender } = render(<StatStrip metrics={metrics} period={period} />);
    expect(container.querySelector('[data-metric="distance"] [data-stat-value]')).toHaveTextContent('1,000');
    expect(container.querySelector('[data-metric="distance"] [data-stat-unit]')).toHaveTextContent('mi');
    expect(container.querySelector('[data-metric="currency"] [data-stat-value]')).toHaveTextContent('€12,500');
    act(() => { setGlobalPrecision(5); setGlobalLocale('en-US'); });
    rerender(<StatStrip metrics={metrics} period={period} retained />);
    expect(container.querySelector('[data-metric="distance"] [data-stat-value]')).toHaveTextContent('1,000');
    expect(saved.settings).toEqual(original);
    const preferences: MetricPreferences = { units: { distance: 'km', speed: 'km/h', temperature: '°C',
      pressure: 'kPa', energy: 'Wh', duration: 's', power: 'W', precision: 2, locale: 'en-US' },
    currency: { kind: 'symbol', value: '£' } };
    rerender(<StatStrip metrics={metrics} period={period} preferences={preferences} />);
    expect(container.querySelector('[data-metric="distance"] [data-stat-value]')).toHaveTextContent('1.61');
    expect(container.querySelector('[data-metric="currency"] [data-stat-value]')).toHaveTextContent('£12.50');
    expect(saved.settings).toEqual(original);
    rerender(<StatStrip metrics={metrics} period={period} />);
    expect(container.querySelector('[data-metric="currency"] [data-stat-value]')).toHaveTextContent('€12,500');
  });

  it('preserves an explicit empty source explanation and its independent slots', () => {
    const { container } = render(<StatStrip metrics={[]} period={period}
      emptyContent={<p>Source prerequisites and recovery</p>} secondary="Source diagnostics" footer="Export unavailable reason" />);
    expect(screen.getByText('Source prerequisites and recovery')).toBeInTheDocument();
    expect(screen.queryByText('No metrics supplied')).not.toBeInTheDocument();
    expect(container.querySelector('[data-stat-secondary]')).toHaveTextContent('Source diagnostics');
    expect(container.querySelector('[data-stat-footer]')).toHaveTextContent('Export unavailable reason');
    expect(container.querySelector('[data-stat-bank]')).toBeNull();
  });

  it('forwards specialist content, display overrides and explicit comparison periods without changing raw values', () => {
    const metric: StatMetric = Object.freeze({
      metricId: 'energy', occurrenceId: 'recorded-energy', rawValue: 26340, label: 'Recorded energy',
      context: <span>Returned subset, not fleet total</span>,
      comparisonContent: <span>Existing domain comparison</span>,
      display: { precision: 1, units: { energy: 'Wh', locale: 'en-US' } },
      comparison: { metricId: 'percent', rawValue: 4, period, label: 'Prior source window', signed: true },
    } satisfies StatMetric);
    const { container } = render(<StatStrip metrics={[metric]} period={analysis} />);
    const tile = container.querySelector('[data-stat]');
    expect(tile?.querySelector('[data-stat-value]')).toHaveTextContent('26,340.0');
    expect(tile?.querySelector('[data-stat-unit]')).toHaveTextContent('Wh');
    expect(tile?.querySelector('[data-stat-delta]')).toHaveTextContent('+4,000%');
    expect(tile?.querySelector('[data-stat-comparison-period-reason]')).toHaveTextContent(period.reason ?? '');
    expect(tile?.querySelector('[data-stat-specialist-comparison]')).toHaveTextContent('Existing domain comparison');
    const descriptions = tile?.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(descriptions).toHaveLength(2);
    expect(descriptions.map(id => container.querySelector(`[id="${id}"]`)?.textContent))
      .toEqual(['Returned subset, not fleet total', 'Existing domain comparison']);
    expect(tile?.getAttribute('aria-label')).toContain(period.reason ?? '');
    expect(metric.rawValue).toBe(26340);
    expect(metric.comparison?.rawValue).toBe(4);
    expect(saved.settings.decimal_precision).toBe(3);
  });
});
