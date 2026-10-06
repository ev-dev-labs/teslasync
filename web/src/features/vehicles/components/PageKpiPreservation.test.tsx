import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DayLogSummary } from './daylog/DayLogSummary';
import { ParkingKpiBand } from './parking-analytics/ParkingKpiBand';
import { UtilizationKpis } from './utilization/UtilizationKpis';
import { summarizeParking } from '../lib/parkingDwell';
import { summarizeUtilization } from '../lib/utilization';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', precision: 2, locale: 'en-US' },
    formatDistance: (value: number) => `${value} m`,
    formatDuration: (value: number) => `${value} s`,
    formatEnergy: (value: number) => `${value} Wh`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$', formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));

function tile(label: string) {
  const element = screen.getByText(label).closest('[data-stat]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing metric ${label}`);
  return within(element);
}

const onRetry = vi.fn();
const asOf = Date.parse('2026-08-01T00:00:00Z');

describe('canonical vehicle-page KPI preservation', () => {
  it('keeps day counts exact and unknown SI sums distinct from zero', () => {
    render(<MemoryRouter><DayLogSummary isLoading={false} error={null} onRetry={onRetry}
      summary={{ drive_count: 0, charge_count: 0, drive_duration_s: null,
        drive_distance_m: 0, energy_added_wh: null, energy_used_wh: 0 }}
    /></MemoryRouter>);
    expect(tile('Drives').getByText('0')).toBeInTheDocument();
    expect(tile('Charges').getByText('0')).toBeInTheDocument();
    expect(tile('Drive time').getByText('—')).toBeInTheDocument();
    expect(tile('Distance').getByText('0 m')).toBeInTheDocument();
    expect(tile('Energy added').getByText('—')).toBeInTheDocument();
    expect(tile('Energy used').getByText('0 Wh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open drives' })).toHaveAttribute('href', '/drives');
  });

  it('does not infer a session-free day when the summary itself is unavailable', () => {
    render(<MemoryRouter><DayLogSummary summary={null} isLoading={false} error={null} onRetry={onRetry} /></MemoryRouter>);
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(screen.queryByText('No drives or charging sessions this day.')).not.toBeInTheDocument();
  });

  it('keeps parking cohorts and overnight rules while unknown shares remain unknown', () => {
    const summary = summarizeParking([], { nowMs: asOf, rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31', timeZone: 'UTC', rowLimit: 1000 });
    render(<MemoryRouter><ParkingKpiBand summary={summary} isLoading={false} error={null} onRetry={onRetry} /></MemoryRouter>);
    expect(tile('Time parked').getByText('—')).toBeInTheDocument();
    expect(tile('Overnight share').getByText('—')).toBeInTheDocument();
    expect(tile('Overnight share').getByText('22:00–06:00 · 0 stints')).toBeInTheDocument();
    expect(tile('Longest stint').getByText('—')).toBeInTheDocument();
    expect(tile('Locations').getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
  });

  it('keeps utilization window, sample and energy-only costing qualifiers', () => {
    const summary = summarizeUtilization([], 0.15, { rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31', asOfMs: asOf, historyLimit: 1000 });
    render(<MemoryRouter><UtilizationKpis summary={summary} isLoading={false} error={null} onRetry={onRetry} /></MemoryRouter>);
    expect(tile('Time driving').getByText('—')).toBeInTheDocument();
    expect(tile('Time driving').getByText('of the observed window')).toBeInTheDocument();
    expect(tile('Distance per day').getByText('—')).toBeInTheDocument();
    expect(tile('Cost per distance').getByText('—')).toBeInTheDocument();
    expect(tile('Cost per distance').getByText('energy only')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
  });
});
