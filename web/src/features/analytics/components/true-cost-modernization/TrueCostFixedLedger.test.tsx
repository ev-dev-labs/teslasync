import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { TcoLedgerResponse } from '@/types/analytics';
import { trueCostQueryState } from '../true-cost/queryState';

const h = vi.hoisted(() => ({
  data: undefined as TcoLedgerResponse | undefined,
  isLoading: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  refetch: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  deletePending: false,
  distanceUnit: 'km' as 'km' | 'mi',
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useTcoLedger: () => ({
    data: h.data, isLoading: h.isLoading, isError: h.isError,
    isPending: h.data === undefined && !h.isError,
    isSuccess: h.data !== undefined && !h.isError,
    isFetching: h.fetchStatus === 'fetching', fetchStatus: h.fetchStatus,
    error: h.isError ? new Error('Ledger refresh unavailable') : null,
    refetch: h.refetch,
  }),
  useAddTcoLedgerEntry: () => ({ mutate: h.add, isPending: false, isError: false }),
  useDeleteTcoLedgerEntry: () => ({ mutate: h.remove, isPending: h.deletePending, isError: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const values = (typeof second === 'object' && second ? second : third) as Record<string, unknown> | undefined;
      const fallback = typeof second === 'string' ? second
        : typeof values?.defaultValue === 'string' ? values.defaultValue : key;
      return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: h.distanceUnit } }),
}));
vi.mock('@/hooks/useNumberFormatting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useNumberFormatting')>();
  return {
    ...actual,
    useNumberFormatting: () => ({
      ...actual.useNumberFormatting(),
      fmtNumber: (value: number) => String(value),
    }),
  };
});

import { TrueCostFixedLedger } from './TrueCostFixedLedger';
import { TrueCostMonthlyDirectory } from '../true-cost/TrueCostMonthlyDirectory';
import { TrueCostSensitivityMatrix } from '../true-cost/TrueCostSensitivityMatrix';
import { analyzeTrueCost } from '../../lib/trueCost';
import type { TrueCostDisplay } from '../true-cost/types';

const retained: TcoLedgerResponse = {
  vehicle_id: 3,
  entries: [{
    id: 2, vehicle_id: 3, category: 'tires', amount: 800, currency: 'USD',
    incurred_on: '2026-01-10', note: 'winter set', created_at: '',
  }],
  totals: { by_category: { tires: 800 }, grand_total: 800, entries: 1 },
};

function mount() {
  return render(
    <TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} totalKm={10000} totalChargingCost={700} chargingCurrency="USD" />,
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter> },
  );
}

const aggregateState = trueCostQueryState({
  data: {}, isLoading: false, isPending: false, isSuccess: true,
  isError: false, error: null, isFetching: false, fetchStatus: 'idle',
}, true, vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  h.data = retained;
  h.isLoading = false;
  h.isError = false;
  h.fetchStatus = 'idle';
  h.distanceUnit = 'km';
  h.deletePending = false;
});

afterEach(() => vi.restoreAllMocks());

function phoneContainer() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 375, bottom: 300, width: 375, height: 300,
    toJSON: () => ({}),
  });
}

const display: TrueCostDisplay = {
  distanceUnit: 'km', energyUnit: 'kWh',
  formatNumber: value => value == null ? '—' : String(value),
  formatCurrency: value => value == null ? '—' : `$${value.toFixed(2)}`,
  formatSignedCurrency: value => value == null ? '—' : `$${value.toFixed(2)}`,
  formatDistanceKm: value => `${value} km`,
  distanceValueKm: value => value,
  costPerDistanceValue: value => value,
  formatCostPerDistance: value => `${value}/km`,
  formatEnergy: value => value == null ? '—' : `${value / 1000} kWh`,
  energyValue: value => value / 1000,
  formatMonth: value => value,
};

describe('true-cost shared mobile details', () => {
  it('exposes every ledger column, the complete note and confirmed delete via keyboard', async () => {
    phoneContainer();
    const user = userEvent.setup();
    mount();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const detail = screen.getByRole('dialog');
    for (const label of ['Date', 'Category', 'Amount', 'Note']) {
      expect(within(detail).getByText(label)).toBeInTheDocument();
    }
    expect(within(detail).getByText('winter set')).toBeInTheDocument();
    expect(within(detail).getByText('USD $800.00')).toBeInTheDocument();
    const remove = within(detail).getByRole('button', { name: 'Delete entry' });
    expect(remove.parentElement).toHaveClass('[&_button]:min-h-11', '[&_button]:min-w-11');
    remove.focus();
    await user.keyboard('{Enter}');
    expect(h.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Delete this entry?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(h.remove).toHaveBeenCalledWith(
      { vehicleId: 3, id: 2 }, expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(h.data).toEqual(retained);
  });

  it('exposes all nine monthly columns in the existing detail dialog', async () => {
    phoneContainer();
    const analysis = analyzeTrueCost({
      monthly_breakdown: [{ month: '2026-01', ev_cost: 12, equiv_gas_cost: 30, energy_wh: 20000,
        savings: 18, cumulative_savings: 18 }],
    });
    render(<MemoryRouter><TrueCostMonthlyDirectory analysis={analysis}
      state={aggregateState} display={display} gasUnit="gallon" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const detail = screen.getByRole('dialog');
    expect(detail.querySelectorAll('dt')).toHaveLength(9);
    expect(within(detail).getByText('$12.00')).toBeInTheDocument();
    expect(within(detail).getByText('$30.00')).toBeInTheDocument();
    expect(within(detail).getByText('20 kWh')).toBeInTheDocument();
    for (const label of ['Source row', 'Month', 'Disposition', 'Recorded EV cost',
      'Modeled gas equivalent', 'Recorded-cost energy', 'API savings', 'API cumulative', 'Derived fuel delta']) {
      expect(within(detail).getByText(label)).toBeInTheDocument();
    }
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps all nine sensitivity scenarios and both values per scenario accessible', async () => {
    phoneContainer();
    const baseline = analyzeTrueCost({});
    const analysis = {
      ...baseline,
      sensitivity: ([0.8, 1, 1.2] as const).flatMap(priceFactor => ([0.8, 1, 1.2] as const).map(mpgFactor => ({
        priceFactor, mpgFactor, modeledGasCost: 100 * priceFactor / mpgFactor,
        fuelDelta: 100 * priceFactor / mpgFactor - 20, disposition: 'savings' as const,
      }))),
    };
    render(<MemoryRouter><TrueCostSensitivityMatrix analysis={analysis}
      state={aggregateState} display={display} gasUnit="gallon" /></MemoryRouter>);
    const user = userEvent.setup();
    for (let index = 0; index < 3; index++) {
      await user.click(screen.getAllByRole('button', { name: 'Quick view' })[index]);
      const detail = screen.getByRole('dialog');
      expect(detail.querySelectorAll('dt')).toHaveLength(4);
      for (const label of ['0.8× MPG', '1.0× MPG', '1.2× MPG']) {
        expect(within(detail).getByText(label)).toBeInTheDocument();
      }
      expect(within(detail).getAllByText(/^Gas \$/)).toHaveLength(3);
      await user.keyboard('{Escape}');
    }
  });
});

describe('modernized fixed-cost ledger retained-source behavior', () => {
  it('records the explicitly chosen ISO code, not the display symbol', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Currency' }), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record cost' }));
    expect(h.add).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'EUR', amount: 60 }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it.each(['', 'XYZ', 'XXX'])('does not record an unknown currency %s', (currency) => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Currency' }), { target: { value: currency } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '60' } });
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeDisabled();
    expect(h.add).not.toHaveBeenCalled();
  });

  it.each(['EUR', '', 'XYZ', 'XXX'])('does not add mixed or unknown fixed currency %s to charging', (currency) => {
    h.data = { ...retained, entries: [...retained.entries, {
      ...retained.entries[0], id: 5, amount: 50, currency, note: 'source amount',
    }], totals: { ...retained.totals, grand_total: 850, entries: 2 } };
    mount();
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.queryByText(/USD \$850/)).not.toBeInTheDocument();
    if (currency === 'EUR') expect(screen.getByText('EUR €50.00')).toBeInTheDocument();
    expect(screen.getByText('source amount')).toBeInTheDocument();
  });

  it('withholds an all-in total when the charging source has no ISO code', () => {
    render(<MemoryRouter><TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} /></MemoryRouter>);
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.getByText('USD $800.00')).toBeInTheDocument();
  });

  it('preserves a non-USD populated ledger and combines only matching source currencies', () => {
    h.data = { ...retained, entries: [{ ...retained.entries[0], currency: 'EUR' }] };
    const view = render(<MemoryRouter><TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} chargingCurrency="EUR" /></MemoryRouter>);
    expect(screen.getByText('All-in: EUR €1500.00 (EUR €0.15/km)')).toBeInTheDocument();
    expect(screen.getByText('EUR €800.00')).toBeInTheDocument();
    view.rerender(<MemoryRouter><TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} chargingCurrency="USD" /></MemoryRouter>);
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.getByText('EUR €800.00')).toBeInTheDocument();
  });

  it('preserves the source ISO code in mobile amount and detail presentations', async () => {
    phoneContainer();
    h.data = { ...retained, entries: [{ ...retained.entries[0], currency: 'EUR' }] };
    mount();
    expect(screen.getByText('EUR €800.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByText('EUR €800.00')).toBeInTheDocument();
  });

  it.each([4, undefined])('invalidates unsubmitted confirmation when scope changes to %s, including a return', (vehicleId) => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    expect(screen.getByRole('dialog', { name: 'Delete this entry?' })).toBeInTheDocument();
    view.rerender(<TrueCostFixedLedger vehicleId={vehicleId} aggregateState={aggregateState} />);
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} />);
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('keeps a pending deletion scoped and ignores its stale success after a vehicle change', () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    const originalSuccess = h.remove.mock.calls[0][1].onSuccess;
    h.deletePending = true;
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} />);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    h.data = { ...retained, vehicle_id: 4, entries: [{ ...retained.entries[0], vehicle_id: 4 }] };
    view.rerender(<TrueCostFixedLedger vehicleId={4} aggregateState={aggregateState} />);
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    act(() => originalSuccess());
    expect(screen.getByRole('dialog', { name: 'Delete this entry?' })).toBeInTheDocument();
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove.mock.calls[0][0]).toEqual({ vehicleId: 3, id: 2 });

    h.deletePending = false;
    view.rerender(<TrueCostFixedLedger vehicleId={4} aggregateState={aggregateState} />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(h.remove.mock.calls[1][0]).toEqual({ vehicleId: 4, id: 2 });
    act(() => h.remove.mock.calls[1][1].onSuccess());
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
  });

  it('does not let an old completion dismiss a newer confirmation for another row or the same row', () => {
    h.data = { ...retained, entries: [...retained.entries, { ...retained.entries[0], id: 5, note: 'second row' }] };
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete entry' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    const originalSuccess = h.remove.mock.calls[0][1].onSuccess;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete entry' })[1]);
    act(() => originalSuccess());
    expect(screen.getByRole('dialog', { name: 'Delete this entry?' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(h.remove.mock.calls[1][0]).toEqual({ vehicleId: 3, id: 5 });
    act(() => h.remove.mock.calls[1][1].onSuccess());
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete entry' })[0]);
    act(() => originalSuccess());
    expect(screen.getByRole('dialog', { name: 'Delete this entry?' })).toBeInTheDocument();
  });

  it('retains confirmation on rejection and closes only after a matching retry succeeds', async () => {
    let rejectDelete!: (error: Error) => void;
    const failure = vi.fn();
    const completion = new Promise<void>((_resolve, reject) => { rejectDelete = reject; });
    h.remove.mockImplementationOnce((_variables, options: { onSuccess: () => void }) => {
      void completion.then(options.onSuccess, failure);
    });
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    h.deletePending = true;
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} />);
    await act(async () => { rejectDelete(new Error('Delete rejected')); await completion.catch(failure); });
    h.deletePending = false;
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} />);
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'Delete rejected' }));
    expect(screen.getByRole('dialog', { name: 'Delete this entry?' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(h.remove.mock.calls[1][0]).toEqual({ vehicleId: 3, id: 2 });
    act(() => h.remove.mock.calls[1][1].onSuccess());
    expect(screen.queryByRole('dialog', { name: 'Delete this entry?' })).not.toBeInTheDocument();
  });

  it('converts lifetime distance and per-distance cost when units change without changing source amounts', () => {
    const view = mount();
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.15/km)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · 10000 km lifetime')).toBeInTheDocument();

    h.distanceUnit = 'mi';
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} chargingCurrency="USD" />);
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.24/mi)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · 6213.71192237334 mi lifetime')).toBeInTheDocument();
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(h.data).toEqual(retained);
    expect(h.add).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();

    h.distanceUnit = 'km';
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} chargingCurrency="USD" />);
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.15/km)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · 10000 km lifetime')).toBeInTheDocument();
  });

  it('uses selected units for zero and unavailable distance without inventing a per-distance cost', () => {
    h.distanceUnit = 'mi';
    const view = mount();
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={0} totalChargingCost={700} chargingCurrency="USD" />);
    expect(screen.getByText('All-in: USD $1500.00 (—/mi)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · 0 mi lifetime')).toBeInTheDocument();
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={null} totalChargingCost={700} chargingCurrency="USD" />);
    expect(screen.getByText('All-in: USD $1500.00 (—/mi)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · — mi lifetime')).toBeInTheDocument();
  });

  it('keeps loaded rows, accounting, inputs and delete access after a refresh failure', () => {
    const view = mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '120' } });
    h.isError = true;
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState} totalKm={10000} totalChargingCost={700} chargingCurrency="USD" />);
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.15/km)')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(120);
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeEnabled();
    expect(screen.getByText(/most recently loaded entries remain visible/)).toBeInTheDocument();
    // Rendering a refresh failure never performs a write.
    expect(h.add).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('keeps a retained empty ledger distinct from a fatal no-data error', () => {
    h.data = { ...retained, entries: [], totals: { by_category: {}, grand_total: 0, entries: 0 } };
    h.isError = true;
    mount();
    expect(screen.getByText(/most recently loaded entries remain visible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeInTheDocument();
    expect(screen.getByText(/No fixed costs recorded/)).toBeInTheDocument();
  });

  it('retries a retained refresh error without changing rows or performing a mutation', () => {
    h.isError = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(h.add).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('does not replace retained entries with an initial-loading skeleton', () => {
    h.isLoading = true;
    mount();
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeInTheDocument();
  });

  it('renders a no-data fatal error inside the ledger shell without showing an empty table', () => {
    h.data = undefined;
    h.isError = true;
    mount();
    expect(screen.getByText('Fixed-cost ledger')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record cost' })).not.toBeInTheDocument();
    expect(screen.queryByText(/most recently loaded entries remain visible/)).not.toBeInTheDocument();
  });

  it('preserves record payload, note trimming and post-success input reset during retained failure', () => {
    h.isError = true;
    mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Date', { selector: 'input[type="date"]' }), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '  renewal  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record cost' }));
    expect(h.add).toHaveBeenCalledWith({
      vehicle_id: 3, category: 'insurance', amount: 120, currency: 'USD',
      incurred_on: '2026-09-30', note: 'renewal',
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    act(() => h.add.mock.calls[0][1].onSuccess());
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(null);
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
    expect(screen.getByLabelText('Date', { selector: 'input[type="date"]' })).toHaveValue('2026-09-30');
  });

  it('retains the explicit delete confirmation and scoped payload on refresh failure', () => {
    h.isError = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    expect(h.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(h.remove).toHaveBeenCalledWith(
      { vehicleId: 3, id: 2 }, expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it.each(['fetching', 'paused', 'idle'] as const)('withholds totals with no ledger data while %s', (fetchStatus) => {
    h.data = undefined;
    h.fetchStatus = fetchStatus;
    h.isLoading = fetchStatus === 'fetching';
    mount();
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.queryByText(/No fixed costs recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record cost' })).not.toBeInTheDocument();
    if (fetchStatus === 'paused') expect(screen.getByText(/Initial loading is paused/)).toBeInTheDocument();
  });

  it('withholds aggregate totals without losing known fixed costs', () => {
    const view = mount();
    view.rerender(<TrueCostFixedLedger vehicleId={3}
      aggregateState={{ ...aggregateState, hasData: false, isResolved: false, isPaused: true }}
      totalKm={0} totalChargingCost={0} />);
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · — km lifetime')).toBeInTheDocument();
    expect(screen.getByText('winter set')).toBeInTheDocument();
  });

  it('retains supported totals through aggregate refresh failure and recovers with new inputs', () => {
    const view = mount();
    const props = { vehicleId: 3, totalKm: 10000, totalChargingCost: 700, chargingCurrency: 'USD' };
    view.rerender(<TrueCostFixedLedger {...props}
      aggregateState={{ ...aggregateState, refreshError: new Error('Aggregate refresh failed') }} />);
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.15/km)')).toBeInTheDocument();
    expect(screen.getByText('winter set')).toBeInTheDocument();
    view.rerender(<TrueCostFixedLedger {...props} aggregateState={aggregateState}
      totalChargingCost={900} />);
    expect(screen.getByText('All-in: USD $1700.00 (USD $0.17/km)')).toBeInTheDocument();
  });

  it('does not coerce unsupported numeric inputs into a combined total', () => {
    const view = mount();
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={Number.NaN} totalChargingCost={undefined} />);
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.getByText('1 entries · USD $800.00 fixed · — km lifetime')).toBeInTheDocument();
    h.data = { ...retained, totals: { ...retained.totals, grand_total: Number.NaN } };
    view.rerender(<TrueCostFixedLedger vehicleId={3} aggregateState={aggregateState}
      totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('distinguishes selection-required from an empty ledger even with cached inputs', () => {
    const view = mount();
    view.rerender(<TrueCostFixedLedger aggregateState={{ ...aggregateState, enabled: false }}
      totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText(/Select a vehicle/)).toBeInTheDocument();
    expect(screen.getByText('All-in: — (—/km)')).toBeInTheDocument();
    expect(screen.queryByText(/No fixed costs recorded/)).not.toBeInTheDocument();
  });

  it('accepts successful empty and zero inputs and recovers from retained refresh failure', () => {
    h.data = { ...retained, entries: [], totals: { by_category: {}, grand_total: 0, entries: 0 } };
    const view = mount();
    const props = { vehicleId: 3, aggregateState, totalKm: 0, totalChargingCost: 0, chargingCurrency: 'USD' };
    view.rerender(<TrueCostFixedLedger {...props} />);
    expect(screen.getByText('All-in: USD $0.00 (—/km)')).toBeInTheDocument();
    expect(screen.getByText(/No fixed costs recorded/)).toBeInTheDocument();
    h.isError = true;
    view.rerender(<TrueCostFixedLedger {...props} aggregateState={{ ...aggregateState, refreshError: new Error('offline') }} />);
    expect(screen.getByText('All-in: USD $0.00 (—/km)')).toBeInTheDocument();
    h.isError = false;
    h.data = retained;
    view.rerender(<TrueCostFixedLedger {...props} totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText('All-in: USD $1500.00 (USD $0.15/km)')).toBeInTheDocument();
    expect(screen.queryByText(/most recently loaded entries remain visible/)).not.toBeInTheDocument();
  });
});
