import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStatus } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { VehicleEvidenceBrief } from './VehicleEvidenceBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const count = values?.count
      const pluralFallback = count === 1 && typeof values?.defaultValue_one === 'string'
        ? values.defaultValue_one
        : count !== 1 && typeof values?.defaultValue_other === 'string'
          ? values.defaultValue_other
          : fallback ?? key
      return Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), pluralFallback)
    },
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

function briefElement(status: DataStatus = 'ok', sourceMetrics = metrics, loading?: boolean, variant?: 'standalone' | 'embedded') {
  return <MemoryRouter><VehicleEvidenceBrief
    id="test-evidence" title="Returned vehicle evidence"
    description="Independent measurements, no shared observation timestamp."
    status={status} scope="Bounded to returned records"
    provenance="Historical source" metrics={sourceMetrics} loading={loading} variant={variant} />
  </MemoryRouter>;
}

function renderBrief(status: DataStatus = 'ok') {
  return render(briefElement(status));
}

function openDetails(brief: HTMLElement) {
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog');
}

describe('VehicleEvidenceBrief raw operational bridge', () => {
  it('renders without a surface when embedded inside a host card', () => {
    const { container } = render(briefElement('ok', metrics, undefined, 'embedded'));
    expect(container.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull();
  });

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
    expect(brief.querySelector('[data-operational-metric="energy"]')).toBeNull();
    const drawer = openDetails(brief);
    expect(within(drawer).getByText('Retained source snapshots')).toBeInTheDocument();
    expect(within(drawer).getByText('1 empty field is hidden.')).toBeInTheDocument();
    expect(within(drawer).getByText('Latest independently reported speed')).toBeInTheDocument();
    expect(within(drawer).queryByText('Not reported by the source')).not.toBeInTheDocument();
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

  it('keeps paused-without-data readings unknown without an active loading or failure state', () => {
    const state = deriveDataState({ fetchStatus: 'paused', isLoading: false });
    const unknownMetrics = metrics.map(metric => ({ ...metric, rawValue: null }));
    render(briefElement(state.status, unknownMetrics, false));
    const brief = screen.getByTestId('test-evidence');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
    const drawer = openDetails(brief);
    expect(within(drawer).getByText('Pending')).toBeInTheDocument();
    expect(within(drawer).queryByText('Loading source')).not.toBeInTheDocument();
    expect(within(drawer).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    expect(within(brief).queryByText(/failure|unavailable/i)).not.toBeInTheDocument();
    expect(within(brief).queryByText('0.00 mph')).not.toBeInTheDocument();
  });

  it('preserves successful empty evidence as a real zero count, not loading or failure', () => {
    const state = deriveDataState({ data: [], isSuccess: true });
    render(briefElement(state.status, [
      { metricId: 'count', occurrenceId: 'records', label: 'Returned records', rawValue: state.data?.length },
    ]));
    const brief = screen.getByTestId('test-evidence');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelector('[data-value-state="value"]')).toBeInTheDocument();
    expect(within(brief).getByText('0')).toBeInTheDocument();
    expect(within(openDetails(brief)).getByText('Source returned')).toBeInTheDocument();
  });

  it('keeps an authoritatively empty source distinct from a pending source', () => {
    const state = deriveDataState({ data: [], isSuccess: true }, { unavailable: true });
    render(briefElement(state.status, []));
    const brief = screen.getByTestId('test-evidence');
    const drawer = openDetails(brief);
    expect(within(drawer).getByText('No source data')).toBeInTheDocument();
    expect(within(drawer).queryByText('Pending')).not.toBeInTheDocument();
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
  });

  it.each(['paused', 'aged', 'failed'] as const)(
    'keeps %s retained evidence cause-neutral and restores the returned state after recovery',
    cause => {
      const state = deriveDataState({
        data: metrics,
        dataUpdatedAt: 1_000,
        fetchStatus: cause === 'paused' ? 'paused' : 'idle',
        error: cause === 'failed' ? new Error('Refresh failed') : null,
      }, { maxAgeMs: 1_000, now: () => cause === 'aged' ? 3_000 : 1_000 });
      expect(state.status).toBe('stale');
      expect(state.refreshError != null).toBe(cause === 'failed');
      const { rerender } = render(briefElement(state.status, state.data));
      const brief = screen.getByTestId('test-evidence');
      expect(within(brief).queryByText(/failure/i)).not.toBeInTheDocument();
      expect(within(brief).getByText('0.00 mph')).toBeInTheDocument();
      expect(brief).not.toHaveAttribute('aria-busy');
      expect(within(openDetails(brief)).getByText('Retained source snapshots')).toBeInTheDocument();

      const recovered = deriveDataState({ data: metrics, isSuccess: true });
      rerender(briefElement(recovered.status, recovered.data));
      expect(within(brief).getByText('0.00 mph')).toBeInTheDocument();
      expect(within(openDetails(brief)).getByText('Source returned')).toBeInTheDocument();
    },
  );
});
