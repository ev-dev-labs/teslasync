import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UnitPref } from '@/lib/unitConversion';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

const preferences = vi.hoisted(() => ({
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  } as UnitPref,
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: preferences.units }) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

function renderBrief(metrics: readonly StatMetric[], loading = false) {
  return render(<MemoryRouter><DrivingSummaryBrief
    id="test-driving-brief" title="Selected-window evidence" description="Returned rows only"
    scope="2026-01-01 — 2026-02-01" provenance="Recorded drives" metrics={metrics}
    loading={loading}
  /></MemoryRouter>);
}

beforeEach(() => {
  preferences.units = { ...preferences.units, distance: 'km', speed: 'km/h', precision: 2, locale: 'en-US' };
});

describe('DrivingSummaryBrief — real OperationalBrief and raw metric bridge', () => {
  it('retains the exact unclassified 50/50 denominator and measured zero separately from missing and invalid counts', () => {
    renderBrief([
      { metricId: 'count', occurrenceId: 'unclassified', rawValue: 50, display: { countTotal: 50 }, label: 'Unclassified' },
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Measured zero' },
      { metricId: 'count', occurrenceId: 'missing', rawValue: null, label: 'Unavailable count' },
      { metricId: 'count', occurrenceId: 'invalid', rawValue: Number.NaN, label: 'Invalid count' },
    ]);
    const brief = screen.getByTestId('test-driving-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelector('[data-operational-metric="unclassified"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="unclassified"] [data-operational-value]')).toHaveTextContent('50/50');
    expect(brief.querySelector('[data-operational-metric="zero"] [data-operational-value]')).toHaveTextContent('0');
    expect(brief.querySelector('[data-operational-metric="missing"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
  });

  it('converts SI distance with saved display preferences without converting the count denominator', () => {
    preferences.units = { ...preferences.units, distance: 'mi' };
    renderBrief([
      { metricId: 'distance', occurrenceId: 'distance', rawValue: 1609.344, label: 'Distance' },
      { metricId: 'count', occurrenceId: 'coverage', rawValue: 3, display: { countTotal: 7 }, label: 'Coverage' },
    ]);
    expect(screen.getByTestId('test-driving-brief').querySelector('[data-operational-metric="distance"] [data-operational-value]')).toHaveTextContent('1.00 mi');
    expect(screen.getByText('3/7')).toBeInTheDocument();
  });

  it('keeps compact loading geometry and exposes no measured-value markers before source resolution', () => {
    renderBrief([{ metricId: 'count', rawValue: null, label: 'Rows' }], true);
    const brief = screen.getByTestId('test-driving-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(within(brief).getByText('Rows')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it('opens the real details drawer with rich metric context and source provenance', () => {
    renderBrief([{
      metricId: 'distance', rawValue: 1000, label: 'Business',
      description: 'Selected-period classified distance',
      context: <>$25.00 · 3 drives</>,
    }]);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Selected-period classified distance')).toBeInTheDocument();
    expect(within(dialog).getByText('$25.00 · 3 drives')).toBeInTheDocument();
    expect(within(dialog).getByText('Recorded drives')).toBeInTheDocument();
  });
});
