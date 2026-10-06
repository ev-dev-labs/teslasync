/**
 * TariffLabPage — confirm-gated tariff deletion.
 *
 * Removing a tariff is destructive (rates + simulation history go with it),
 * so the row Remove button must open a danger confirm dialog naming the plan
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the table, buttons, and confirm dialog
 * render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useTariffs: vi.fn(),
    useCreateTariff: vi.fn(),
    useDeleteTariff: vi.fn(),
    useSimulateTariffs: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useTariffs,
  useCreateTariff,
  useDeleteTariff,
  useSimulateTariffs,
} from '@/api/hooks/useOwnership';
import TariffLabPage from './TariffLabPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { Tariff, TariffSimulationResponse, TariffSimulationResult } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockTariffs = useTariffs as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateTariff as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteTariff as unknown as ReturnType<typeof vi.fn>;
const mockSimulate = useSimulateTariffs as unknown as ReturnType<typeof vi.fn>;

function makeTariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: 1,
    name: 'EV Nights',
    provider: 'GridCo',
    currency: 'USD',
    structure: 'tou',
    standing_charge_minor_per_day: 120,
    demand_charge_minor_per_w: 0,
    export_price_minor_per_wh: 0,
    is_current: true,
    version: 1,
    rates: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function makeResult(overrides: Partial<TariffSimulationResult> = {}): TariffSimulationResult {
  return {
    tariff_id: 1, name: 'Replay Nights', provider: 'GridCo', structure: 'tou',
    currency: 'USD', is_current: true, rank: 1,
    observed_energy_wh: 12345, annualised_energy_wh: 54321,
    energy_cost_minor: 12345, standing_cost_minor: 2345, demand_cost_minor: 345,
    annual_cost_minor: 15035, effective_price_minor_per_wh: 0.015,
    delta_vs_current_minor: null, break_even_days: null,
    load_shift_saving_minor: 456, peak_demand_w: 7200,
    bands: [{ label: 'Observed overnight band', energy_wh: 12345, share_pct: 100, price_minor_per_wh: 0.015, cost_minor: 12345 }],
    warnings: ['Replay is not a forecast.'],
    ...overrides,
  };
}

function makeSimulation(overrides: Partial<TariffSimulationResponse> = {}): TariffSimulationResponse {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    session_count: 8, observed_energy_wh: 12345, shiftable_pct: 25,
    results: [makeResult()], best_tariff_id: 1, current_tariff_id: 1,
    max_saving_minor: null,
    quality: { status: 'sufficient', sample_count: 8, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    evidence: [],
    ...overrides,
  };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TariffLabPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given plan name. */
function removeButton(planName: string): HTMLElement {
  const row = screen.getByText(planName).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockTariffs.mockReturnValue(
    makeQuery({ items: [makeTariff(), makeTariff({ id: 2, name: 'Flat Saver', is_current: false })] }),
  );
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockSimulate.mockReturnValue({ ...makeMutation(), data: undefined });
});

describe('TariffLabPage — confirm-gated delete', () => {
  it('uses the real replay brief without promoting an unknown saving to zero or running another replay', () => {
    mockSimulate.mockReturnValue({ ...makeMutation(), data: makeSimulation() });
    renderPage();
    expectOperationalBand('Arbitrage summary', ['saving', 'observed', 'plans', 'shift']);
    expect(summaryMetric('Arbitrage summary', 'saving')).toHaveAttribute('data-value-state', 'missing');
    expect(summaryMetric('Arbitrage summary', 'observed')).toHaveTextContent('8 sessions');
    expect(summaryMetric('Arbitrage summary', 'plans')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Arbitrage summary', 'shift')).toHaveTextContent(/25(?:\.0+)?%/);
    fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Replay Nights');
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('retains complete replay economics and band evidence when the independent plan library fails', () => {
    mockTariffs.mockReturnValue({ ...makeQuery(undefined), error: new Error('library failed') });
    mockSimulate.mockReturnValue({ ...makeMutation({ error: new Error('replay refresh failed') }), data: makeSimulation() });
    renderPage();

    const economics = card('Ranked plan economics');
    const row = within(economics).getByText('Replay Nights').closest('tr');
    expect(row).toHaveTextContent('$150.35');
    expect(row).toHaveTextContent('$4.56');
    expect(row).toHaveTextContent('$123.45 · $23.45 · $3.45');
    expect(within(economics).getByText(/Replay is not a forecast/)).toBeInTheDocument();
    expect(within(card('Where your energy actually landed')).getByText('Observed overnight band')).toBeInTheDocument();
    expect(card('Where your energy actually landed')).toHaveTextContent('$123.45');
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeEnabled();
    expect(mockTariffs).toHaveBeenCalledWith(100, 0);
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('does not turn an unknown saving or absent current-plan comparison into zero', () => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({
        current_tariff_id: null, max_saving_minor: null,
        results: [makeResult({ is_current: false })],
      }),
    });
    renderPage();

    const saving = within(card('Arbitrage summary')).getByText('Best-case annual saving').parentElement;
    expect(saving).toHaveTextContent('—');
    expect(saving).not.toHaveTextContent('$0.00');
    const row = within(card('Ranked plan economics')).getByText('Replay Nights').closest('tr');
    expect(row?.textContent?.match(/—/g)).toHaveLength(2);
    expect(screen.queryByText('No plan produced a priced result — check that your plans have at least one price band.')).not.toBeInTheDocument();
  });

  it('renders supplied zero saving and current-plan delta rather than unknown placeholders', () => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({
        max_saving_minor: 0,
        results: [makeResult({ delta_vs_current_minor: 0, break_even_days: 0 })],
      }),
    });
    renderPage();

    expect(within(card('Arbitrage summary')).getByText('Best-case annual saving').parentElement).toHaveTextContent('$0.00');
    const row = within(card('Ranked plan economics')).getByText('Replay Nights').closest('tr');
    expect(row).toHaveTextContent('$0.00');
    expect(row).toHaveTextContent('0 d');
  });

  it('keeps plan records and editor reachable with no replay instead of displaying the draft rate as observed', () => {
    renderPage();
    expect(within(card('Your rate plan library')).getByText('EV Nights')).toBeInTheDocument();
    expect(within(card('Arbitrage summary')).getByText('Run a replay to see how much your plan choice is worth.')).toBeInTheDocument();
    expect(within(card('Ranked plan economics')).queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    expect(screen.getByRole('textbox', { name: 'Plan name required' })).toBeInTheDocument();
    expect(mockCreate().mutate).not.toHaveBeenCalled();
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('keeps explicitly selected member IDs and replay parameters at the mocked mutation boundary', () => {
    const mutate = vi.fn();
    mockSimulate.mockReturnValue({ ...makeMutation({ mutate }), data: undefined });
    renderPage();
    const row = screen.getByText('Flat Saver').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole('switch'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Shiftable load (%)' }), { target: { value: '37' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Switching fee (minor units)' }), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith({
      vehicle_id: 7, window_days: 90, tariff_ids: [2], shiftable_pct: 37,
      switch_fee_minor: 123, confirmed: true,
    });
  });

  it('opens a danger confirm naming the plan instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('EV Nights'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this tariff?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('EV Nights');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Flat Saver'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    // The confirm() promise resolves off the click — wait a tick for mutate.
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('EV Nights'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Flat Saver')).toBeDisabled();
    expect(removeButton('EV Nights')).not.toBeDisabled();
  });
});
