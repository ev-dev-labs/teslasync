import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display';
import { Button } from '@/components/ui';
import type { MetricPreferences } from '@/lib/metric-reference';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { ChargingSummaryBrief } from './ChargingSummaryBrief';

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'min', power: 'kW', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

afterEach(cleanup);
const preferences: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'min', power: 'kW', precision: 2, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};
const period = {
  kind: 'unknown', label: 'Selected returned sessions',
  reason: 'Up to 200 returned sessions; not a full-history aggregate.',
} as const;
const metrics: readonly StatMetric[] = [
  { metricId: 'energy', occurrenceId: 'energy', label: 'Recorded energy',
    rawValue: 42620, description: 'Vehicle pack input, not cabinet energy.' },
  { metricId: 'power', occurrenceId: 'power', label: 'Mean peak power', rawValue: 150000,
    context: 'Original returned-session denominator.' },
  { metricId: 'duration', occurrenceId: 'duration', label: 'Measured duration', rawValue: 3600 },
  { metricId: 'currency', occurrenceId: 'cost', label: 'Recorded cost', rawValue: 0 },
];
function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
function metric(container: HTMLElement, key: string) {
  const found = container.querySelector(`[data-operational-metric="${key}"]`);
  if (!found) throw new Error(`Missing operational metric ${key}`);
  return found;
}

describe('charging summaries use the real compact OperationalBrief and numeric bridge', () => {
  it('retains raw SI operands independently of the saved display preference', () => {
    const original = JSON.stringify(metrics);
    const { result } = renderHook(() => useOperationalMetrics(metrics, preferences), { wrapper });
    expect(result.current.map(item => item.rawValue)).toEqual([42620, 150000, 3600, 0]);
    expect(result.current.map(item => item.valueState)).toEqual(['value', 'value', 'value', 'value']);
    const { container } = render(<ChargingSummaryBrief title="Charging summary"
      metrics={metrics} period={period} preferences={preferences} />, { wrapper });
    expect(container.querySelector('[data-operational-brief]')).not.toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(metric(container, 'energy')).toHaveTextContent('42.62 kWh');
    expect(metric(container, 'power')).toHaveTextContent('150.00 kW');
    expect(metric(container, 'cost')).toHaveAttribute('data-value-state', 'value');
    expect(metric(container, 'cost')).toHaveTextContent('$0.00');
    expect(JSON.stringify(metrics)).toBe(original);
  });
  it('preserves missing versus invalid versus measured zero without invoking invalid specialist callbacks', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(2), unit: 'kWh/h' }));
    const source: StatMetric[] = [
      { metricId: 'power', occurrenceId: 'missing', rawValue: null, display: { formatter } },
      { metricId: 'power', occurrenceId: 'invalid', rawValue: Infinity, display: { formatter } },
      { metricId: 'power', occurrenceId: 'zero', rawValue: 0, display: { formatter } },
    ];
    const { result } = renderHook(() => useOperationalMetrics(source, preferences), { wrapper });
    expect(result.current.map(item => item.valueState)).toEqual(['missing', 'invalid', 'value']);
    expect(result.current.map(item => item.rawValue)).toEqual([null, Infinity, 0]);
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(formatter.mock.calls[0][0]).toBe(0);
  });
  it('keeps specialist denomination, signed delta and source rate units instead of applying FX or a new formula', () => {
    const source: StatMetric[] = [
      { metricId: 'currency', occurrenceId: 'invoice', rawValue: 12.75,
        display: { formatter: raw => ({ value: `EUR${raw.toFixed(2)}`, unit: '' }) } },
      { metricId: 'energy', occurrenceId: 'delta', rawValue: -1250,
        display: { formatter: raw => ({ value: String(raw), unit: 'Wh' }) } },
      { metricId: 'power', occurrenceId: 'rate', rawValue: 44490.6,
        display: { formatter: raw => ({ value: (raw / 1000).toFixed(2), unit: 'kWh/h' }) } },
    ];
    const { container } = render(<ChargingSummaryBrief metrics={source} period={period}
      preferences={preferences} />, { wrapper });
    expect(metric(container, 'invoice')).toHaveTextContent('EUR12.75');
    expect(metric(container, 'delta')).toHaveTextContent('-1250 Wh');
    expect(metric(container, 'rate')).toHaveTextContent('44.49 kWh/h');
  });
  it('opens the built-in Review details drawer with source limitations, rich help and comparisons', () => {
    render(<ChargingSummaryBrief title="Charging evidence" period={period} preferences={preferences}
      metrics={[{ ...metrics[0], context: <a href="/charging/42">Inspect charge session</a>,
        comparisonContent: <span>Cabinet invoice differs from pack by 4.2%</span> }]} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText(period.reason).length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Vehicle pack input, not cabinet energy.')).toBeInTheDocument();
    expect(within(drawer).getByText('Cabinet invoice differs from pack by 4.2%')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Inspect charge session' })).toHaveAttribute('href', '/charging/42');
  });
  it('shows loading evidence without numeric value markers and preserves usable retained values and retry actions', () => {
    const retry = vi.fn();
    const { container, rerender } = render(<ChargingSummaryBrief loading metrics={metrics} period={period}
      preferences={preferences} />, { wrapper });
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<ChargingSummaryBrief loading retained metrics={metrics} period={period}
      preferences={preferences} footer={<Button type="button" onClick={retry}>Retry source</Button>} />);
    expect(metric(container, 'energy')).toHaveTextContent('42.62 kWh');
    expect(screen.getByText('Retained source measurements')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('keeps the summary shell and actionable empty content when the source is unavailable', () => {
    const { container } = render(<ChargingSummaryBrief metrics={[{ ...metrics[0], rawValue: null }]}
      period={period} emptyContent={<p>Reconnect to load charging history.</p>} />, { wrapper });
    expect(container.querySelector('[data-operational-brief]')).not.toBeNull();
    expect(metric(container, 'energy')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Reconnect to load charging history.')).toBeInTheDocument();
    expect(screen.getByText('No source measurements')).toBeInTheDocument();
  });
});
