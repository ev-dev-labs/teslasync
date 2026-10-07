import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { VehicleEvidenceBrief } from './VehicleEvidenceBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    },
  }),
}));

const metrics: readonly StatMetric[] = [
  { metricId: 'speed', occurrenceId: 'speed', label: 'Measured speed', rawValue: 0, context: 'Latest independently reported speed' },
  { metricId: 'energy', occurrenceId: 'energy', label: 'Remaining energy', rawValue: null, missingReason: 'Not reported by the source' },
  { metricId: 'number', occurrenceId: 'current', label: 'Pack current', rawValue: -1.25,
    display: { formatter: raw => ({ value: raw.toFixed(2), unit: 'A' }) } },
  { metricId: 'count', occurrenceId: 'coverage', label: 'Covered records', rawValue: 0, display: { countTotal: 4 } },
];

function renderBrief(status: 'ok' | 'stale' | 'initial' = 'ok') {
  return render(<MemoryRouter><VehicleEvidenceBrief
    id="test-evidence" title="Returned vehicle evidence"
    description="Independent measurements, no shared observation timestamp."
    status={status} scope="Bounded to returned records"
    provenance="Historical source" metrics={metrics} />
  </MemoryRouter>);
}

describe('VehicleEvidenceBrief raw operational bridge', () => {
  it('retains numeric raw inputs, signed specialist units, real zero counts and missing states', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, null, -1.25, 0]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'value', 'value']);
    expect(result.current[0].value).toBe('0.00 mph');
    expect(result.current[2].value).toBe('-1.25 A');
    expect(result.current[3].value).toBe('0/4');
  });

  it('preserves unknown, invalid and measured zero separately before executing a specialist formatter', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(1), unit: 'V' }));
    const { result } = renderHook(() => useOperationalMetrics([
      { metricId: 'number', rawValue: null, display: { formatter } },
      { metricId: 'number', rawValue: NaN, display: { formatter } },
      { metricId: 'number', rawValue: 0, display: { formatter } },
    ]));
    expect(result.current.map(metric => metric.valueState)).toEqual(['missing', 'invalid', 'value']);
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(result.current[2].rawValue).toBe(0);
    expect(result.current[2].value).toBe('0.0 V');
  });

  it('shows retained evidence and opens the real Review details drawer with all captions and coverage', () => {
    renderBrief('stale');
    const brief = screen.getByTestId('test-evidence');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(within(brief).getByText('Retained after refresh failure')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="energy"]')).toHaveAttribute('data-value-state', 'missing');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Latest independently reported speed')).toBeInTheDocument();
    expect(within(drawer).getByText('Not reported by the source')).toBeInTheDocument();
    expect(within(drawer).getByText('-1.25 A')).toBeInTheDocument();
    expect(within(drawer).getByText('0/4')).toBeInTheDocument();
  });

  it('marks the actual brief loading without presenting unresolved values as measured zeros', () => {
    renderBrief('initial');
    const brief = screen.getByTestId('test-evidence');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(within(brief).queryByText('0.00 mph')).not.toBeInTheDocument();
  });
});
