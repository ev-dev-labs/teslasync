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
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
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
import type { Tariff, TariffSimulationRequest, TariffSimulationResponse, TariffSimulationResult } from '@/types/ownership';

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter><QueryClientProvider client={client}>
      {children}
    </QueryClientProvider></MemoryRouter>;
  }
  return render(<TariffLabPage />, { wrapper });
}

/** The Remove button in the table row showing the given plan name. */
function removeButton(planName: string): HTMLElement {
  const row = screen.getByText(planName).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

describe('TariffLabPage — publication retention', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  function realReplay() {
    const requests: Array<ReturnType<typeof deferred<TariffSimulationResponse>>> = [];
    const submitted: TariffSimulationRequest[] = [];
    function useReplayMutation() {
      return useMutation({
        mutationFn: (inputs: TariffSimulationRequest) => {
          submitted.push(structuredClone(inputs));
          const request = deferred<TariffSimulationResponse>();
          requests.push(request);
          return request.promise;
        },
      });
    }
    vi.mocked(useSimulateTariffs).mockImplementation(useReplayMutation);
    return { requests, submitted };
  }

  function replayValues() {
    return Array.from(card('Arbitrage summary').querySelectorAll('[data-operational-metric]'))
      .map(metric => ({
        id: metric.getAttribute('data-operational-metric'),
        state: metric.getAttribute('data-value-state'),
        value: metric.querySelector('[data-operational-value]')?.textContent,
      }));
  }

  describe('real mutation transitions', () => {
    it.each(['success', 'error'] as const)('retains SI economics, source bounds and submitted assumptions through pending and %s', async outcome => {
      const replay = realReplay();
      renderPage();
      const run = screen.getByRole('button', { name: 'Replay load against plans' });
      expect(card('Arbitrage summary')).toHaveTextContent('Not computed');
      const selectedRow = screen.getByText('Flat Saver').closest('tr');
      if (selectedRow == null) throw new Error('Missing selectable tariff row');
      fireEvent.click(within(selectedRow).getByRole('switch'));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Switching fee (minor units)' }), { target: { value: '123' } });
      fireEvent.click(run);
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      const original = makeSimulation({
        max_saving_minor: 0,
        quality: {
          status: 'limited', sample_count: 8, coverage_pct: null,
          window_start: '2026-01-01T00:00:00Z', window_end: '2026-03-01T00:00:00Z',
          reasons: ['Only recorded vehicle charging load is included.'],
        },
        evidence: [{
          source: 'Measured charging sessions', observed_at: '2026-03-01T00:00:00Z',
          sample_count: 8, summary: 'Original replay provenance',
        }],
      });
      act(() => replay.requests[0].resolve(original));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Source returned'));
      const values = replayValues();
      const economics = card('Ranked plan economics').textContent;
      const bands = card('Where your energy actually landed').textContent;
      fireEvent.change(screen.getByLabelText('Analysis window'), { target: { value: '180' } });
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Shiftable load (%)' }), { target: { value: '55' } });
      fireEvent.click(within(selectedRow).getByRole('switch'));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Switching fee (minor units)' }), { target: { value: '456' } });
      fireEvent.click(run);
      await waitFor(() => expect(replay.requests).toHaveLength(2));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Refreshing source'));
      expect(run).toBeDisabled();
      expect(replayValues()).toEqual(values);
      expect(card('Ranked plan economics').textContent).toBe(economics);
      expect(card('Where your energy actually landed').textContent).toBe(bands);
      expect(card('Evidence, quality, and limitations')).toHaveTextContent('Original replay provenance');
      expect(card('Evidence, quality, and limitations')).toHaveTextContent('Only recorded vehicle charging load is included.');
      expect(card('Arbitrage summary')).toHaveTextContent('vehicle #7, 90 days, shiftable 35%');
      expect(card('Arbitrage summary')).toHaveTextContent('switching fee 123 minor units, tariff IDs 2');
      expect(card('Arbitrage summary')).not.toHaveTextContent('180 days, shiftable 55%');
      fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveTextContent('Submitted replay: vehicle #7, 90 days, shiftable 35%');
      expect(drawer).toHaveTextContent('switching fee 123 minor units, tariff IDs 2');
      expect(drawer).toHaveTextContent('Recorded bounds');
      expect(drawer).toHaveTextContent('Replay Nights');
      fireEvent.keyDown(document, { key: 'Escape' });

      if (outcome === 'error') {
        act(() => replay.requests[1].reject(new Error('replay unavailable')));
        await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Retained source'));
        expect(screen.getByText('replay unavailable')).toBeVisible();
        expect(replayValues()).toEqual(values);
        expect(card('Ranked plan economics').textContent).toBe(economics);
        expect(card('Evidence, quality, and limitations')).toHaveTextContent('Original replay provenance');
        expect(run).toBeEnabled();
        fireEvent.click(run);
        await waitFor(() => expect(replay.requests).toHaveLength(3));
      }
      act(() => replay.requests[outcome === 'error' ? 2 : 1].resolve(makeSimulation({
        max_saving_minor: null, observed_energy_wh: 42000, shiftable_pct: 55,
        window: { from: '2026-04-01T00:00:00Z', to: '2026-10-01T00:00:00Z', days: 180 },
        results: [makeResult({ name: 'Replacement Replay' })],
      })));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Source returned'));
      expect(card('Arbitrage summary')).toHaveTextContent('vehicle #7, 180 days, shiftable 55%');
      expect(summaryMetric('Arbitrage summary', 'saving')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryMetric('Arbitrage summary', 'observed')).toHaveTextContent('42');
      expect(card('Ranked plan economics')).toHaveTextContent('Replacement Replay');
      expect(replay.submitted[0]).toEqual({
        vehicle_id: 7, window_days: 90, tariff_ids: [2], shiftable_pct: 35,
        switch_fee_minor: 123, confirmed: true,
      });
      expect(run).toBeEnabled();
    });

    it.each(['success', 'error'] as const)('clears prior vehicle values and ignores late %s after returning to that vehicle', async outcome => {
      const replay = realReplay();
      const view = renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      act(() => replay.requests[0].resolve(makeSimulation()));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Source returned'));
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(2));
      fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      const selection = { vehicleId: 8, vehicle: null, vehicles: [], setVehicleId: vi.fn() };
      vi.mocked(useSelectedVehicle).mockReturnValue(selection);
      view.rerender(<TariffLabPage />);
      expect(card('Arbitrage summary')).toHaveTextContent('Not computed');
      expect(replayValues().every(metric => metric.state === 'missing')).toBe(true);
      expect(drawer).not.toHaveTextContent('Submitted replay: vehicle #7');
      expect(drawer).not.toHaveTextContent('Replay Nights');
      fireEvent.keyDown(document, { key: 'Escape' });
      vi.mocked(useSelectedVehicle).mockReturnValue({ ...selection, vehicleId: 7 });
      view.rerender(<TariffLabPage />);
      await act(async () => {
        if (outcome === 'success') replay.requests[1].resolve(makeSimulation());
        else replay.requests[1].reject(new Error('old vehicle replay failed'));
        await replay.requests[1].promise.catch(() => undefined);
      });
      expect(card('Arbitrage summary')).toHaveTextContent('Not computed');
      expect(card('Ranked plan economics')).not.toHaveTextContent('Replay Nights');
      expect(screen.queryByText('old vehicle replay failed')).not.toBeInTheDocument();
      vi.mocked(useSelectedVehicle).mockReturnValue({ ...selection, vehicleId: null });
      view.rerender(<TariffLabPage />);
      expect(card('Arbitrage summary')).toHaveTextContent('Selection required');
      expect(screen.getByRole('button', { name: 'Replay load against plans' })).toBeDisabled();
    });

    it('does not relabel retained source currency with an edited tariff draft', async () => {
      const replay = realReplay();
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      act(() => replay.requests[0].resolve(makeSimulation({ max_saving_minor: 0, results: null })));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Source returned'));
      fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'ISO currency code required' }), { target: { value: 'JPY' } });
      expect(summaryMetric('Arbitrage summary', 'saving')).not.toHaveTextContent('$0.00');
      expect(summaryMetric('Arbitrage summary', 'saving')).not.toHaveTextContent('¥');
      expect(summaryMetric('Arbitrage summary', 'saving')).toHaveTextContent('—');
      expect(summaryMetric('Arbitrage summary', 'saving')).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByRole('textbox', { name: 'Plan name required' })).toBeVisible();
    });

    it('shows an initial replay failure without claiming a retained result or hiding the controls', async () => {
      const replay = realReplay();
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      act(() => replay.requests[0].reject(new Error('initial replay unavailable')));
      await waitFor(() => expect(card('Arbitrage summary')).toHaveTextContent('Source unavailable'));
      expect(card('Arbitrage summary')).not.toHaveTextContent('Retained source');
      expect(replayValues().every(metric => metric.state === 'missing')).toBe(true);
      expect(screen.getByText('initial replay unavailable')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Replay load against plans' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add plan' })).toBeEnabled();
      expect(screen.getByRole('heading', { name: 'Annualised cost by plan' })).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Where your energy actually landed' })).toBeVisible();
    });
  });
});

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
