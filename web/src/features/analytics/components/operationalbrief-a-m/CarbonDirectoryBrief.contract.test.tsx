import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGlobalPrecision, setGlobalPrecision } from '@/lib/numberFormat';
import { buildCarbonIntelligence } from '../../lib/carbonIntelligence';
import type { CarbonQueryState } from '../carbon-intelligence/types';
import { useCarbonDisplay } from '../carbon-intelligence/useCarbonDisplay';
import { CarbonDirectoryBrief } from './CarbonDirectoryBrief';

const originalPrecision = getGlobalPrecision();
const emptyMessage = 'No valid hourly intensity rows are available.';
const invalidMessage = 'Coverage is incomplete because invalid or duplicate rows were returned.';

function source(overrides: Partial<CarbonQueryState> = {}): CarbonQueryState {
  return {
    enabled: true, hasData: true, isLoading: false, isResolved: true,
    isFetching: false, isPaused: false, refreshPaused: false,
    error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
  };
}

// Real analysis, display hook, Brief, source wrapper and Table: no rendered UI stubs.
function DirectoryFixture({ intensity, state }: { intensity: unknown; state: CarbonQueryState }) {
  const display = useCarbonDisplay();
  const analysis = buildCarbonIntelligence({
    intensity, periodSummary: undefined, lifetimeSummary: undefined, recommendation: undefined,
    window: {
      startLabel: '2026-10-01', endLabel: '2026-10-13',
      startInstant: '2026-10-01T00:00:00Z', endInstantExclusive: '2026-10-14T00:00:00Z', timezone: 'UTC',
    },
  });
  return <CarbonDirectoryBrief analysis={analysis} display={display}
    states={{ intensity: state, period: source(), lifetime: source(), recommendation: source() }} />;
}

function show(intensity: unknown, state = source()) {
  render(<MemoryRouter><DirectoryFixture intensity={intensity} state={state} /></MemoryRouter>);
  return screen.getByTestId('carbon-hourly-directory');
}

function metricValues(section: HTMLElement) {
  return within(section).getAllByRole('listitem').map(metric => ({
    label: metric.querySelector('[data-operational-value]')?.previousElementSibling?.textContent,
    value: metric.querySelector('[data-operational-value]')?.textContent,
    state: metric.getAttribute('data-value-state'),
  }));
}

afterEach(() => {
  cleanup();
  setGlobalPrecision(originalPrecision);
});

describe('CarbonDirectoryBrief local directory contract', () => {
  it('explains a resolved empty curve locally while retaining the shell and five unknown metrics', () => {
    const section = show({ curve: [] });
    expect(within(section).getByRole('heading', { name: 'Ranked hourly directory and bands' })).toBeVisible();
    expect(within(section).getByText('Built-in, admin-editable static 24-hour model')).toBeVisible();
    expect(within(section).getByText(emptyMessage)).toBeVisible();
    expect(within(section).getByText('Rows returned').nextElementSibling).toHaveTextContent('0.00');
    expect(within(section).getByText('24 expected clock-hours')).toBeVisible();
    expect(within(section).queryByText(invalidMessage)).not.toBeInTheDocument();
    expect(within(section).queryByRole('table')).not.toBeInTheDocument();
    expect(metricValues(section)).toEqual(['Minimum', 'Maximum', 'Mean', 'Median', 'Observed span']
      .map(label => ({ label, value: '—', state: 'missing' })));
    expect(within(section).getAllByRole('button').map(button => button.textContent)).toEqual(['Review details']);
  });

  it.each([
    { name: 'invalid hours', curve: [{ hour_of_day: 24, g_co2_per_kwh: 100 }], hourRule: true, intensityRule: false },
    { name: 'invalid intensities', curve: [{ hour_of_day: 2, g_co2_per_kwh: -1 }, { hour_of_day: 3, g_co2_per_kwh: Infinity }], hourRule: false, intensityRule: true },
    { name: 'mixed invalid fields', curve: [{ hour_of_day: 0.5, g_co2_per_kwh: '100' }], hourRule: true, intensityRule: true },
  ])('explains no valid ranked rows from $name without fabricating a recovery action', ({ curve, hourRule, intensityRule }) => {
    const section = show({ curve });
    expect(within(section).getByText(emptyMessage)).toBeVisible();
    expect(within(section).getByText(invalidMessage)).toBeVisible();
    expect(within(section).getByText('Rows returned').nextElementSibling).toHaveTextContent(curve.length === 2 ? '2.00' : '1.00');
    expect(Boolean(within(section).queryByText('Required integer 0–23'))).toBe(hourRule);
    expect(Boolean(within(section).queryByText('Required finite non-negative value'))).toBe(intensityRule);
    expect(within(section).queryByText('24 expected clock-hours')).not.toBeInTheDocument();
    expect(within(section).queryByRole('table')).not.toBeInTheDocument();
    expect(metricValues(section).map(metric => [metric.value, metric.state])).toEqual(Array(5).fill(['—', 'missing']));
    expect(within(section).getAllByRole('button').map(button => button.textContent)).toEqual(['Review details']);
  });

  it('keeps a real zero-intensity row and flat-band statistics rather than treating zero as empty', () => {
    const section = show({ curve: [{ hour_of_day: 7, g_co2_per_kwh: 0 }] });
    const table = within(section).getByRole('table', { name: 'Ranked hourly directory and bands' });
    expect(within(table).getAllByRole('row')).toHaveLength(1);
    expect(within(table).getByRole('rowheader')).toHaveTextContent('Rank 1 · 07:00');
    expect(within(table).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0.00 g CO₂/kWh', 'Flat curve']);
    expect(metricValues(section).map(metric => [metric.value, metric.state])).toEqual(Array(5).fill(['0.00 g CO₂/kWh', 'value']));
    expect(within(section).getByText('The curve is flat, so clean and dirty labels are withheld.')).toBeVisible();
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it('preserves all 24 representative valid hours, ranking, bands and numeric statistics', () => {
    const section = show({ curve: Array.from({ length: 24 }, (_, index) => ({
      hour_of_day: 23 - index, g_co2_per_kwh: 100 + (23 - index) * 10,
    })) });
    const table = within(section).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(24);
    expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual(
      Array.from({ length: 24 }, (_, hour) => `Rank ${hour + 1} · ${String(hour).padStart(2, '0')}:00`),
    );
    expect(within(rows[0]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['100.00 g CO₂/kWh', 'Clean band']);
    expect(within(rows[12]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['220.00 g CO₂/kWh', 'Middle band']);
    expect(within(rows[23]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['330.00 g CO₂/kWh', 'Dirty band']);
    expect(metricValues(section)).toEqual([
      ['Minimum', '100.00'], ['Maximum', '330.00'], ['Mean', '215.00'], ['Median', '215.00'], ['Observed span', '230.00'],
    ].map(([label, value]) => ({ label, value: `${value} g CO₂/kWh`, state: 'value' })));
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it('preserves tied ranks, hour identity and the first valid duplicate while discarding invalid rows', () => {
    const section = show({ curve: [
      { hour_of_day: 8, g_co2_per_kwh: 300 }, { hour_of_day: 12, g_co2_per_kwh: 100 },
      { hour_of_day: 2, g_co2_per_kwh: 100 }, { hour_of_day: 6, g_co2_per_kwh: 200 },
      { hour_of_day: 2, g_co2_per_kwh: 999 }, { hour_of_day: 24, g_co2_per_kwh: 50 },
    ] });
    const rows = within(within(section).getByRole('table')).getAllByRole('row');
    expect(rows.map(row => row.textContent)).toEqual([
      'Rank 1 · 02:00100.00 g CO₂/kWhClean band', 'Rank 1 · 12:00100.00 g CO₂/kWhClean band',
      'Rank 3 · 06:00200.00 g CO₂/kWhMiddle band', 'Rank 4 · 08:00300.00 g CO₂/kWhDirty band',
    ]);
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'loading', state: { hasData: false, isResolved: false, isLoading: true }, message: null },
    { name: 'unknown', state: { hasData: false, isResolved: false }, message: 'Source availability has not resolved yet.' },
    { name: 'paused', state: { hasData: false, isResolved: false, isPaused: true }, message: 'The query is paused while the network is unavailable; this is not treated as an empty response.' },
    { name: 'disabled', state: { enabled: false, hasData: false, isResolved: false }, message: 'Select a vehicle to load this vehicle-dependent evidence.' },
  ])('does not replace the canonical $name source state with a local empty claim', ({ state, message }) => {
    const section = show({ curve: [] }, source(state));
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(within(section).queryByRole('table')).not.toBeInTheDocument();
    if (message) expect(within(section).getByText(message)).toBeVisible();
    else expect(within(section).getByRole('status', { name: 'Loading carbon evidence' })).toBeVisible();
  });

  it('keeps canonical initial-error recovery rather than claiming an empty directory', () => {
    const onRetry = vi.fn();
    const section = show({ curve: [] }, source({ hasData: false, isResolved: false, error: new Error('fixture initial failure'), onRetry }));
    expect(within(section).getByText('This source is unavailable. Retry it from the source and scope ledger.')).toBeVisible();
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(['failed', 'paused'] as const)('retains actual directory values during a %s refresh and preserves source retry', mode => {
    const onRetry = vi.fn();
    const section = show({ curve: [{ hour_of_day: 3, g_co2_per_kwh: 123.5 }] }, source({
      refreshError: mode === 'failed' ? new Error('fixture refresh failure') : null,
      refreshPaused: mode === 'paused', onRetry,
    }));
    const row = within(within(section).getByRole('table')).getByRole('row');
    expect(row).toHaveTextContent('Rank 1 · 03:00123.50 g CO₂/kWhFlat curve');
    expect(within(section).getByText(mode === 'failed'
      ? 'Refresh failed; the most recently loaded evidence remains visible.'
      : 'The network is unavailable; cached evidence remains visible while refresh is paused.')).toBeVisible();
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses the existing display precision for directory rows and metrics without rounding source analysis', () => {
    setGlobalPrecision(1);
    const section = show({ curve: [{ hour_of_day: 4, g_co2_per_kwh: 123.456 }] });
    const row = within(within(section).getByRole('table')).getByRole('row');
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['123.5 g CO₂/kWh', 'Flat curve']);
    expect(metricValues(section).map(metric => metric.value)).toEqual([
      '123.5 g CO₂/kWh', '123.5 g CO₂/kWh', '123.5 g CO₂/kWh', '123.5 g CO₂/kWh', '0.0 g CO₂/kWh',
    ]);
  });
});
