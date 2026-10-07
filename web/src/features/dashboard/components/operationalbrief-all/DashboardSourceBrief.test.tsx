import { beforeEach, describe, expect, fireEvent, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { UnitPref } from '@/lib/unitConversion';

const captured = vi.hoisted(() => ({
  metrics: [] as OperationalBriefProps['metrics'],
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
  } as UnitPref,
}));

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: captured.units }) }));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return {
    ...actual,
    OperationalBrief: (props: OperationalBriefProps) => {
      captured.metrics = props.metrics;
      return <actual.OperationalBrief {...props} />;
    },
  };
});

import { DashboardSourceBrief } from './DashboardSourceBrief';

const metrics: readonly StatMetric[] = [
  { metricId: 'distance', rawValue: 1609344, label: 'Distance', description: 'Source metres' },
  { metricId: 'energy', rawValue: 250000, label: 'Energy', description: 'Source watt-hours' },
  { metricId: 'temperature', rawValue: 0, label: 'Cabin', description: 'Measured freezing temperature' },
  { metricId: 'count', rawValue: 0, label: 'Drives', description: 'Successful empty history' },
];

function renderBrief(readings = metrics, loading = false) {
  return render(
    <MemoryRouter>
      <DashboardSourceBrief
        metrics={readings}
        state={deriveDataState({ data: readings, error: new Error('refresh failed') }, { provenance: 'historical' })}
        eyebrow="Fleet sources"
        title="Dashboard source summary"
        description="Registry and analytics retain independent source windows."
        scope="All fleet vehicles; exact bounds unknown"
        loading={loading}
        testId="source-brief"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  captured.metrics = [];
  captured.units = {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
  };
});

describe('DashboardSourceBrief with the actual renderer and raw bridge', () => {
  it('retains canonical numerical operands, measured zero, saved units and the real review drawer', () => {
    captured.units = { ...captured.units, distance: 'mi', temperature: '°F' };
    renderBrief();
    expect(captured.metrics.map(metric => metric.rawValue)).toEqual([1609344, 250000, 0, 0]);
    expect(captured.metrics.map(metric => metric.valueState)).toEqual(['value', 'value', 'value', 'value']);
    const brief = screen.getByTestId('source-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
    expect(within(brief).getByText('1,000.00 mi')).toBeInTheDocument();
    expect(within(brief).getByText('32.00°F')).toBeInTheDocument();
    expect(within(brief).getByText('0')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('250.00 kWh')).toBeInTheDocument();
    expect(within(drawer).getByText('Source metres')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/independent source windows/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/exact bounds unknown/)).toBeInTheDocument();
  });

  it('validates missing, non-finite and fractional counts before a specialist formatter can execute', () => {
    const formatter = vi.fn(() => ({ value: 'unexpected', unit: '' }));
    const readings: readonly StatMetric[] = [
      { metricId: 'distance', rawValue: null, label: 'Missing', description: 'No reading', display: { formatter } },
      { metricId: 'energy', rawValue: Number.NaN, label: 'Invalid', description: 'Non-finite source', display: { formatter } },
      { metricId: 'count', rawValue: 1.5, label: 'Invalid count', description: 'Fractional source', display: { formatter } },
      { metricId: 'count', rawValue: 0, label: 'Measured count', description: 'Empty returned list' },
    ];
    renderBrief(readings);
    expect(formatter).not.toHaveBeenCalled();
    expect(captured.metrics.map(metric => metric.rawValue)).toEqual([null, Number.NaN, 1.5, 0]);
    expect(captured.metrics.map(metric => metric.valueState)).toEqual(['missing', 'invalid', 'invalid', 'value']);
    const brief = screen.getByTestId('source-brief');
    expect(within(brief).getAllByText('—')).toHaveLength(3);
    expect(within(brief).getByText('0')).toBeInTheDocument();
  });

  it('retains labels and raw states while the loading presentation suppresses numeric announcements', () => {
    renderBrief(metrics, true);
    const brief = screen.getByTestId('source-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(captured.metrics[0].rawValue).toBe(1609344);
    expect(within(brief).getByText('Distance')).toBeInTheDocument();
  });
});
