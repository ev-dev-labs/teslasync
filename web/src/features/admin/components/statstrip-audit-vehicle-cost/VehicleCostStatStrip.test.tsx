import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { VehicleCostStatStrip } from './VehicleCostStatStrip';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(vars?.[key] ?? `{{${key}}}`)),
}) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C',
    pressure: 'kPa', energy: 'kWh', duration: 's', power: 'kW', locale: 'de-DE', precision: 2 },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '€' }) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

const preferences: MetricPreferences = { units: { distance: 'km', speed: 'km/h', temperature: 'C',
  pressure: 'kPa', energy: 'kWh', duration: 's', power: 'kW', locale: 'de-DE', precision: 2 },
  currency: { kind: 'symbol', value: '€' } };
const totals = Object.freeze({ total_rows: 14000, total_bytes_est: 1344000,
  total_rate_per_minute_24h: 12.5, total_failures_24h: 3 });
const initial = getFormatterPreferences();
afterEach(() => {
  cleanup();
  setGlobalLocale(initial.locale);
  setGlobalPrecision(initial.precision);
});
function setup(overrides: Partial<Parameters<typeof VehicleCostStatStrip>[0]> = {}) {
  return render(<VehicleCostStatStrip totals={totals} vehicleCount={3} windowDays={30}
    loading={false} error={null} onRetry={vi.fn()} {...overrides} />);
}

describe('Vehicle ingest canonical summary preservation', () => {
  it('renders the actual OperationalBrief design with six numeric evidence metrics and review details', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Window: 30d');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Fleet ingest totals details' });
    expect(within(details).getByText('Total bytes (est.)')).toBeInTheDocument();
    expect(within(details).getByText('1,28 MB')).toBeInTheDocument();
    expect(details).toHaveTextContent('Totals sum the returned vehicles only (query limit 100)');
    expect(details).toHaveTextContent('Returned-vehicle total rows divided by returned vehicle count');
  });

  it('preserves all six measurements, preference formatting, estimated byte and denominator scopes', () => {
    const { container } = setup();
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.metricId))
      .toEqual(['count', 'bytes', 'number', 'count', 'count', 'number']);
    expect(tiles.map(tile => tile.getAttribute('data-operational-metric')))
      .toEqual(['total-rows', 'estimated-bytes', 'rows-rate', 'dlq-failures', 'returned-vehicles', 'mean-rows']);
    expect(tiles.map(tile => tile.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['14.000', '1,28 MB', '12,50', '3', '3', '4.667']);
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent(/^1,28 MB$/);
    expect(tiles[1]).toHaveTextContent('96 bytes/row average');
    expect(tiles[2]).toHaveTextContent('Rate (rows/min, 24h)');
    expect(tiles[3]).toHaveTextContent('DLQ failures (24h)');
    expect(tiles[4]).toHaveTextContent('Denominator: returned vehicles (query limit 100)');
    expect(tiles[0]).toHaveTextContent('Totals sum the returned vehicles only (query limit 100)');
    expect(tiles[5]).toHaveTextContent('Returned-vehicle total rows divided by returned vehicle count');
    const strip = screen.getByTestId('vehicle-cost-summary');
    expect(strip).toHaveTextContent('Queried snapshot');
    expect(strip).toHaveTextContent('Window: 30d');
    expect(strip).toHaveTextContent('The response does not provide exact report bounds.');
    expect(formatMetric('bytes', totals.total_bytes_est, preferences).rawValue).toBe(1344000);
    expect(formatMetric('number', totals.total_rows / 3, preferences, undefined, { precision: 0 }).rawValue)
      .toBe(14000 / 3);
    expect(totals.total_rate_per_minute_24h).toBe(12.5);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([14000, 1344000, 12.5, 3, 3, 14000 / 3]);
  });

  it('keeps actual zero counters and bytes valid, while unknown totals and denominator stay missing', () => {
    const { container, rerender } = setup({ totals: { total_rows: 0, total_bytes_est: 0,
      total_rate_per_minute_24h: 0, total_failures_24h: 0 }, vehicleCount: 0 });
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles.slice(0, 5).every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    expect(tiles[5]).toHaveAttribute('data-value-state', 'missing');
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent(/^0 B$/);
    expect(tiles[5]).toHaveTextContent('No returned vehicles to average');
    rerender(<VehicleCostStatStrip totals={undefined} vehicleCount={null} windowDays={7}
      loading={false} error={null} onRetry={vi.fn()} />);
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
  });

  it('does not invent an average when the returned-vehicle denominator is unknown', () => {
    const { container } = setup({ vehicleCount: null });
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles[0]).toHaveAttribute('data-value-state', 'value');
    expect(tiles[4]).toHaveAttribute('data-value-state', 'missing');
    expect(tiles[5]).toHaveAttribute('data-value-state', 'missing');
  });

  it('keeps a genuine zero mean when zero rows have a known positive vehicle denominator', () => {
    const { container } = setup({ totals: { ...totals, total_rows: 0 }, vehicleCount: 3 });
    const mean = container.querySelectorAll('[data-operational-metric]')[5]!;
    expect(mean).toHaveAttribute('data-value-state', 'value');
    expect(mean.querySelector('[data-operational-value]')).toHaveTextContent('0');
  });

  it('keeps the six canonical loading tiles and retains them on a failed refresh with retry', () => {
    const retry = vi.fn();
    const { container, rerender } = setup({ totals: undefined, vehicleCount: null, loading: true });
    expect(screen.getByTestId('vehicle-cost-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('vehicle-cost-summary')).toHaveTextContent('Loading sources');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([undefined, undefined, undefined, undefined, null, null]);
    rerender(<VehicleCostStatStrip totals={totals} vehicleCount={3} windowDays={30}
      loading retained refreshError={new Error('retained ingest refresh failed')} error={null} onRetry={retry} />);
    expect(screen.getByTestId('vehicle-cost-summary')).toHaveTextContent('Retained source data');
    expect(screen.getByTestId('vehicle-cost-summary')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByTestId('vehicle-cost-summary')).not.toHaveAttribute('aria-busy', 'true');
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
