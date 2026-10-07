import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import './metricPreferencesTestSetup';
import { TelemetrySummaryBrief } from './TelemetrySummaryBrief';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables?.[name] ?? `{{${name}}}`));
  },
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const metrics: readonly StatMetric[] = Object.freeze([
  Object.freeze({ metricId: 'rate' as const, occurrenceId: 'rate', rawValue: 1.234567,
    label: 'Signal rate', description: 'One-second tail rate; not broker lifetime throughput',
    display: { formatter: (raw: number) => ({ value: String(raw), unit: '/s' }) } }),
  Object.freeze({ metricId: 'ratio' as const, occurrenceId: 'r', rawValue: -0.812345,
    label: 'Coefficient', description: 'Signed coefficient, not percentage', display: { precision: 4 } }),
  Object.freeze({ metricId: 'duration' as const, occurrenceId: 'lag', rawValue: -120,
    label: 'Lag', description: 'Negative means A lags B', display: { precision: 0, units: { duration: 's' as const } } }),
]);
function setup(overrides: Partial<Parameters<typeof TelemetrySummaryBrief>[0]> = {}) {
  return render(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
    metrics={metrics} testId="brief" scope="24h requested; overlap only"
    provenance="Producer-time history; receipt fallbacks excluded" {...overrides} />);
}

describe('Telemetry compact OperationalBrief contract', () => {
  it('uses the actual raw bridge without rounding input rate, coefficient, or signed lag', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-stat-strip], [data-role="metric-card"]')).toHaveLength(0);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
    expect(metrics.map(metric => metric.rawValue)).toEqual([1.234567, -0.812345, -120]);
    expect(container.querySelector('[data-operational-metric="rate"] [data-operational-value]'))
      .toHaveTextContent('1.234567 /s');
    expect(container.querySelector('[data-operational-metric="r"] [data-operational-value]'))
      .not.toHaveTextContent('%');
    expect(container.querySelector('[data-operational-metric="lag"] [data-operational-value]'))
      .toHaveTextContent('-120 s');
  });

  it('keeps the real Review details drawer, all captions, scope, and provenance', () => {
    setup();
    expect(screen.getByTestId('brief')).toHaveTextContent('24h requested; overlap only');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Signal evidence details' });
    expect(within(drawer).getByText('Signal rate')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('One-second tail rate; not broker lifetime throughput');
    expect(drawer).toHaveTextContent('Signed coefficient, not percentage');
    expect(drawer).toHaveTextContent('Negative means A lags B');
    expect(drawer).toHaveTextContent('Producer-time history; receipt fallbacks excluded');
  });

  it('retains independent source-reported bounds without fabricating missing bounds', () => {
    setup({ retained: true, sourceBounds: [
      { signal: 'A', from: '2026-01-01T01:02:03Z', to: '2026-01-02T04:05:06Z' },
      { signal: 'B' },
    ] });
    expect(screen.getByTestId('brief')).toHaveTextContent('A source bounds: 2026-01-01T01:02:03Z → 2026-01-02T04:05:06Z');
    expect(screen.getByTestId('brief')).toHaveTextContent('B source bounds not supplied');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('2026-01-02T04:05:06Z');
    expect(drawer).toHaveTextContent('B source bounds not supplied');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
  });

  it('distinguishes measured zero, missing, and invalid raw values', () => {
    const measurements: readonly StatMetric[] = [
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Zero', description: 'Successful empty result' },
      { metricId: 'count', occurrenceId: 'missing', rawValue: null, label: 'Missing', description: 'Unavailable source' },
      { metricId: 'rate', occurrenceId: 'nan', rawValue: NaN, label: 'Invalid', description: 'Non-finite source' },
      { metricId: 'count', occurrenceId: 'negative', rawValue: -1, label: 'Negative count', description: 'Invalid source count' },
    ];
    const { container } = setup({ metrics: measurements });
    const cells = [...container.querySelectorAll('[data-operational-metric]')];
    expect(cells.map(cell => cell.getAttribute('data-value-state'))).toEqual(['value', 'missing', 'invalid', 'invalid']);
    expect(cells[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([0, null, NaN, -1]);
  });

  it('exposes initial loading without values and does not blank retained evidence during refresh', () => {
    const { container, rerender } = setup({ loading: true });
    expect(screen.getByTestId('brief')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={metrics} testId="brief" scope="24h overlap" provenance="History"
      loading retained unavailable />);
    expect(screen.getByTestId('brief')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('brief')).toHaveTextContent('Retained source data');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(3);
  });

  it('does not turn partial or unavailable coverage into a healthy status', () => {
    const { rerender } = setup({ sourceStatus: 'partial' });
    expect(screen.getByTestId('brief')).toHaveTextContent('Partial source coverage');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('On track');
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={[]} testId="brief" scope="Unknown coverage" provenance="History" unavailable />);
    expect(screen.getByTestId('brief')).toHaveTextContent('Source unavailable');
  });
});
