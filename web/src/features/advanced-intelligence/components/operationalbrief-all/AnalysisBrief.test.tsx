import type { ReactNode } from 'react';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatEfficiencyFromSI } from '../../formatters';
import { AnalysisBrief } from './AnalysisBrief';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

const metrics: readonly StatMetric[] = [
  { occurrenceId: 'zero-energy', metricId: 'energy', rawValue: 0, label: 'Usable battery', description: 'Returned battery energy.' },
  { occurrenceId: 'missing-energy', metricId: 'energy', rawValue: null, label: 'Energy required', description: 'Unsupported energy is not zero.' },
  { occurrenceId: 'invalid-percent', metricId: 'percent', rawValue: Number.NaN, label: 'Readiness', description: 'Returned readiness percentage.' },
  { occurrenceId: 'horizon', metricId: 'duration', rawValue: 7200, label: 'Survival horizon', description: 'Modeled duration.' },
  { occurrenceId: 'epsilon', metricId: 'ratio', rawValue: 0.25, label: 'Epsilon', description: 'Dimensionless privacy spend.' },
  { occurrenceId: 'efficiency', metricId: 'efficiency', rawValue: 0.15, label: 'Efficiency', description: 'Calibrated Wh/m.',
    display: { formatter: (raw, preferences) => ({
      value: formatEfficiencyFromSI(raw, preferences.units), unit: '',
    }) } },
];

describe('advanced intelligence raw OperationalBrief bridge', () => {
  it('retains numeric raw SI/epsilon values, distinguishes invalid and missing from zero and preserves specialist efficiency display', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics), { wrapper: Wrapper });
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, null, Number.NaN, 7200, 0.25, 0.15]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'invalid', 'value', 'value', 'value']);
    expect(result.current[0].value).toBe('0.00 kWh');
    expect(result.current[1].value).toBe('—');
    expect(result.current[2].value).toBe('—');
    expect(result.current[3].value).toBe('2.00 h');
    expect(result.current[4].value).toBe('0.25');
    expect(result.current[5].value).toBe(formatEfficiencyFromSI(0.15, {
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    }));
    expect(metrics[3].rawValue).toBe(7200);
  });

  it('validates each count without coercing unknown, fractional or negative samples into a count', () => {
    const counts: readonly StatMetric[] = [
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0 },
      { metricId: 'count', occurrenceId: 'unknown', rawValue: undefined },
      { metricId: 'count', occurrenceId: 'fractional', rawValue: 1.5 },
      { metricId: 'count', occurrenceId: 'negative', rawValue: -1 },
    ];
    const { result } = renderHook(() => useOperationalMetrics(counts), { wrapper: Wrapper });
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, undefined, 1.5, -1]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'invalid', 'invalid']);
  });

  it('keeps actual bridge markers and the built-in drawer with ordered evidence and unscored confidence', () => {
    render(<AnalysisBrief
      id="analysis-brief-contract"
      title="Modeled source summary"
      description="Supported source values only."
      emptyMessage="Submit a scenario."
      metrics={metrics}
      vehicleId={7}
      hasResult
      quality={{
        status: 'limited', sample_count: 0, coverage_pct: null,
        window_start: '2026-08-01T00:00:00Z', window_end: '2026-08-03T00:00:00Z',
        reasons: ['Coverage is incomplete.'],
      }}
      generatedAt="2026-08-04T00:00:00Z"
      evidence={[
        { source: 'first-source', summary: 'First evidence.', sample_count: 0, observed_at: null },
        { source: 'second-source', summary: 'Second evidence.', sample_count: null, observed_at: '2026-08-02T00:00:00Z' },
      ]}
      limitations={['No physical actuation.']}
      provenance="Modeled local source"
    />, { wrapper: Wrapper });
    const brief = screen.getByTestId('analysis-brief-contract');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief.querySelector('[data-operational-metric="zero-energy"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="invalid-percent"]')).toHaveAttribute('data-value-state', 'invalid');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Modeled source summary details' });
    expect(within(drawer).getByText('First evidence. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getByText('Second evidence.')).toBeInTheDocument();
    expect(within(drawer).getAllByText('No physical actuation.')).toHaveLength(2);
    expect(within(drawer).getByText('Coverage is incomplete.')).toBeInTheDocument();
    expect(within(drawer).getByText('Source coverage not supplied')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('Unsupported energy is not zero.')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
