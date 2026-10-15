import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { analyzeTrueCost } from '../../lib/trueCost';
import { TrueCostMonthlyDirectory } from './TrueCostMonthlyDirectory';
import type { TrueCostDisplay, TrueCostQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const state: TrueCostQueryState = {
  enabled: true,
  hasData: true,
  isLoading: false,
  isResolved: true,
  isFetching: false,
  isPaused: false,
  refreshPaused: false,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

const formatNumber = (value: number | null | undefined) => value == null ? '—' : String(value);
const display: TrueCostDisplay = {
  distanceUnit: 'km',
  energyUnit: 'kWh',
  formatNumber,
  formatCurrency: (value) => value == null ? '—' : `$${value}`,
  formatSignedCurrency: (value) => value == null ? '—' : `$${value}`,
  formatDistanceKm: formatNumber,
  distanceValueKm: (value) => value,
  costPerDistanceValue: (value) => value,
  formatCostPerDistance: formatNumber,
  formatEnergy: formatNumber,
  energyValue: (value) => value,
  formatMonth: (month) => month,
};

const emptyMessage = 'No monthly positive-cost rows were returned.';
const invalidMessage = 'The monthly_breakdown field is malformed; no monthly rows were fabricated.';

function renderDirectory(monthly: unknown, queryState = state) {
  const analysis = analyzeTrueCost({
    total_charging_cost: 100,
    total_savings: 200,
    monthly_breakdown: monthly,
  });
  render(
    <TrueCostMonthlyDirectory
      analysis={analysis}
      state={queryState}
      display={display}
      gasUnit="gallon"
    />,
  );
  return analysis;
}

describe('TrueCostMonthlyDirectory monthly availability', () => {
  it.each([
    ['omitted', undefined, 'Unavailable'],
    ['null', null, 'Unavailable'],
    ['object', {}, invalidMessage],
    ['string', 'invalid', invalidMessage],
  ])('does not infer an empty result from a %s monthly array', (_label, monthly, message) => {
    const analysis = renderDirectory(monthly);

    const section = screen.getByTestId('tco-monthly-directory');
    expect(within(section).getByText('Monthly evidence directory')).toBeInTheDocument();
    expect(within(section).getByText(message)).toBeInTheDocument();
    expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(within(section).queryByRole('table')).not.toBeInTheDocument();
    expect(analysis.metrics.totalChargingCost.value).toBe(100);
    expect(analysis.metrics.totalFuelDelta.value).toBe(200);
    expect(state.hasData).toBe(true);
  });

  it('shows the successful empty state only for an empty array', () => {
    renderDirectory([]);
    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
  });

  it('preserves populated rows, dispositions, and independently validated numeric fields', () => {
    renderDirectory([
      { month: '2025-01', ev_cost: 40, equiv_gas_cost: 120, energy_wh: 40000, savings: 80, cumulative_savings: 80 },
      { month: '2025-01', ev_cost: 60, equiv_gas_cost: 180 },
      { month: 'invalid', ev_cost: 25 },
      null,
    ]);

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('2025-01')).toHaveLength(2);
    for (const disposition of ['Eligible', 'Duplicate month', 'Invalid YYYY-MM', 'Invalid row']) {
      expect(within(table).getByText(disposition)).toBeInTheDocument();
    }
    expect(within(table).getByText('$40')).toBeInTheDocument();
    expect(within(table).getByText('$120')).toBeInTheDocument();
    expect(within(table).getByText('40000')).toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it.each([
    [{ enabled: false, hasData: false }, 'Select a vehicle to load its lifetime operating-cost evidence.'],
    [{ hasData: false, isPaused: true }, 'The initial query is paused while the network is unavailable; no empty response is inferred.'],
    [{ hasData: false, error: new Error('failed') }, 'Operating-cost evidence is unavailable. Retry from the evidence ledger.'],
    [{ hasData: false, isResolved: false }, 'Source availability has not resolved yet.'],
  ])('preserves the query state ahead of monthly availability', (overrides, message) => {
    renderDirectory(undefined, { ...state, ...overrides });
    expect(screen.getByText('Monthly evidence directory')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it('preserves initial loading and cached populated data during refresh failures', () => {
    const { unmount } = render(
      <TrueCostMonthlyDirectory
        analysis={analyzeTrueCost(undefined)}
        state={{ ...state, hasData: false, isLoading: true }}
        display={display}
        gasUnit="gallon"
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading operating-cost evidence' })).toBeInTheDocument();
    unmount();

    renderDirectory([{ month: '2025-01', ev_cost: 40 }], {
      ...state,
      isFetching: true,
      refreshError: new Error('refresh failed'),
    });
    expect(within(screen.getByRole('table')).getByText('$40')).toBeInTheDocument();
  });
});
