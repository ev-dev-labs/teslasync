/**
 * TariffLabPage — confirm-gated tariff deletion.
 *
 * Removing a tariff is destructive (rates + simulation history go with it),
 * so the row Remove button must open a danger confirm dialog naming the plan
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the table, buttons, and confirm dialog
 * render for real.
 */

import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';

const chartProbe = vi.hoisted(() => ({
  axis: vi.fn(),
  tooltip: vi.fn(),
  bars: vi.fn(),
}));

vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  function inspect(children: ReactNode) {
    Children.forEach(children, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return;
      if (child.type === actual.YAxis) chartProbe.axis(child.props);
      if (child.type === actual.Tooltip) chartProbe.tooltip(child.props);
      if (child.type === actual.BarChart) chartProbe.bars(child.props);
      inspect(child.props.children);
    });
  }
  return {
    ...actual,
    ChartContainer: (props: ComponentProps<typeof actual.ChartContainer>) => {
      inspect(props.children);
      return <actual.ChartContainer {...props} />;
    },
  };
});

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...dom } = rest;
      return <div {...dom}>{children}</div>;
    },
  },
}));

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
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { Tariff, TariffSimulationRequest, TariffSimulationResponse, TariffSimulationResult } from '@/types/ownership';

// These fixtures return partial hook results; preserve the real callable contracts.
const mockSelected = vi.mocked(useSelectedVehicle, { partial: true, deep: true });
// Pick the supplied result fields, not an invented complete TanStack state.
const mockTariffs = vi.mocked<
  (...args: Parameters<typeof useTariffs>) => Pick<
    ReturnType<typeof useTariffs>, 'data' | 'isLoading' | 'isFetching' | 'isError' | 'error' | 'refetch'
  >
>(useTariffs, { partial: true, deep: true });
const mockCreate = vi.mocked(useCreateTariff, { partial: true });
const mockRemove = vi.mocked(useDeleteTariff, { partial: true });
const mockSimulate = vi.mocked<
  (...args: Parameters<typeof useSimulateTariffs>) => Pick<
    ReturnType<typeof useSimulateTariffs>, 'mutate' | 'isPending' | 'isPaused' | 'variables' | 'data' | 'error'
  >
>(useSimulateTariffs, { partial: true });

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

function makeQuery(data: Parameters<typeof mockTariffs.mockReturnValue>[0]['data']) {
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
      <ThemeProvider>{children}</ThemeProvider>
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
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Not computed', { contains: true });
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
      await waitFor(() => expect(replayValues().find(m => m.id === 'observed')?.value).toBeDefined());
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source returned', { contains: true });
      const values = replayValues();
      const economics = within(card('Ranked plan economics')).getByRole('table').textContent;
      const bands = card('Where your energy actually landed').textContent;
      fireEvent.change(screen.getByLabelText('Analysis window'), { target: { value: '180' } });
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Shiftable load (%)' }), { target: { value: '55' } });
      fireEvent.click(within(selectedRow).getByRole('switch'));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Switching fee (minor units)' }), { target: { value: '456' } });
      fireEvent.click(run);
      await waitFor(() => expect(replay.requests).toHaveLength(2));
      await waitFor(() => expect(run).toBeDisabled());
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Refreshing source', { contains: true });
      expect(run).toBeDisabled();
      expect(replayValues()).toEqual(values);
      expect(within(card('Ranked plan economics')).getByRole('table').textContent).toBe(economics);
      // No face retained-notices during a plain refresh: the shared data-state
      // contract reports refreshing-with-data as `ok` + `isRefreshing` (never
      // `stale`), so OwnershipPanel stays quiet. The refresh state is pinned
      // via the drawer status above; retained values via the assertions here.
      expect(card('Where your energy actually landed').textContent).toBe(bands);
      expect(card('Evidence, quality, and limitations')).toHaveTextContent('Original replay provenance');
      expect(card('Evidence, quality, and limitations')).toHaveTextContent('Only recorded vehicle charging load is included.');
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'vehicle #7, 90 days, shiftable 35%', { contains: true });
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'switching fee 123 minor units, tariff IDs 2', { contains: true });
      assertOperationalBriefDisclosure(card('Arbitrage summary'), '180 days, shiftable 55%', { absent: true, contains: true });
      fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveTextContent('Submitted replay: vehicle #7, 90 days, shiftable 35%');
      expect(drawer).toHaveTextContent('switching fee 123 minor units, tariff IDs 2');
      expect(drawer).toHaveTextContent('Recorded bounds');
      expect(drawer).toHaveTextContent('Replay Nights');
      fireEvent.keyDown(drawer, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      if (outcome === 'error') {
        act(() => replay.requests[1].reject(new Error('replay unavailable')));
        await waitFor(() => expect(within(card('Ranked plan economics')).getByRole('status')).toHaveTextContent('Previously loaded data remains visible.'));
        assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Retained source', { contains: true });
        expect(screen.getByText('replay unavailable')).toBeVisible();
        expect(replayValues()).toEqual(values);
        expect(within(card('Ranked plan economics')).getByRole('table').textContent).toBe(economics);
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
      await waitFor(() => expect(run).toBeEnabled());
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source returned', { contains: true });
      expect(screen.queryByText(/The latest values are temporarily unavailable/)).not.toBeInTheDocument();
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'vehicle #7, 180 days, shiftable 55%', { contains: true });
      assertOperationalMetricUnavailable(card('Arbitrage summary'), 'Best-case annual saving');
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
      await waitFor(() => expect(replayValues().find(m => m.id === 'observed')?.value).toBeDefined());
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source returned', { contains: true });
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(2));
      fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      const selection = { vehicleId: 8, vehicle: null, vehicles: [], setVehicleId: vi.fn() };
      vi.mocked(useSelectedVehicle).mockReturnValue(selection);
      view.rerender(<TariffLabPage />);
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Not computed', { contains: true });
      expect(replayValues().every(metric => metric.state === 'missing')).toBe(true);
      expect(drawer).not.toBeInTheDocument();
      fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
      const currentDrawer = screen.getByRole('dialog');
      expect(currentDrawer).not.toHaveTextContent('Submitted replay: vehicle #7');
      expect(currentDrawer).not.toHaveTextContent('Replay Nights');
      fireEvent.keyDown(currentDrawer, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      vi.mocked(useSelectedVehicle).mockReturnValue({ ...selection, vehicleId: 7 });
      view.rerender(<TariffLabPage />);
      await act(async () => {
        if (outcome === 'success') replay.requests[1].resolve(makeSimulation());
        else replay.requests[1].reject(new Error('old vehicle replay failed'));
        await replay.requests[1].promise.catch(() => undefined);
      });
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Not computed', { contains: true });
      expect(card('Ranked plan economics')).not.toHaveTextContent('Replay Nights');
      expect(screen.queryByText('old vehicle replay failed')).not.toBeInTheDocument();
      vi.mocked(useSelectedVehicle).mockReturnValue({ ...selection, vehicleId: null });
      view.rerender(<TariffLabPage />);
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Selection required', { contains: true });
      expect(screen.getByRole('button', { name: 'Replay load against plans' })).toBeDisabled();
    });

    it('does not relabel retained source currency with an edited tariff draft', async () => {
      const replay = realReplay();
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      act(() => replay.requests[0].resolve(makeSimulation({ max_saving_minor: 0, results: null })));
      await waitFor(() => expect(replayValues().find(m => m.id === 'observed')?.value).toBeDefined());
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source returned', { contains: true });
      fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'ISO currency code required' }), { target: { value: 'JPY' } });
      // Unknown saving stays off the brief face (never $0.00, never relabelled
      // with the draft currency); the drawer records it as a hidden field.
      assertOperationalMetricUnavailable(card('Arbitrage summary'), 'Best-case annual saving');
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Plan name required' })).toBeVisible());
    });

    it('shows an initial replay failure without claiming a retained result or hiding the controls', async () => {
      const replay = realReplay();
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      await waitFor(() => expect(replay.requests).toHaveLength(1));
      act(() => replay.requests[0].reject(new Error('initial replay unavailable')));
      await waitFor(() => expect(replayValues()).toHaveLength(0));
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source unavailable', { contains: true });
      assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Retained source', { absent: true, contains: true });
      expect(replayValues().every(metric => metric.state === 'missing')).toBe(true);
      expect(screen.getByText('initial replay unavailable')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Replay load against plans' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add plan' })).toBeEnabled();
      expect(screen.getByRole('heading', { name: 'Annualised cost by plan' })).toBeVisible();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Where your energy actually landed' })).toBeVisible());
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Keep real theme/chart providers; isolate their settings read from the network.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
    headers: { 'Content-Type': 'application/json' },
  }));
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
  it('keeps the independent plan library and pre-replay prompts available without a vehicle', () => {
    mockSelected.mockReturnValue({
      vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn(),
    });
    renderPage();
    assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Selection required', { contains: true });
    expect(card('Arbitrage summary')).toHaveTextContent('Run a replay to see how much your plan choice is worth.');
    expect(screen.getByRole('button', { name: 'Replay load against plans' })).toBeDisabled();
    expect(within(card('Your rate plan library')).getByText('EV Nights')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    expect(screen.getByRole('textbox', { name: 'Plan name required' })).toBeVisible();
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the real initial replay state (paused: %s) without inferring empty results', paused => {
    mockSimulate.mockReturnValue({
      ...makeMutation(), data: undefined, isPending: true, isPaused: paused,
      variables: {
        vehicle_id: 7, window_days: 90, tariff_ids: [], shiftable_pct: 35,
        switch_fee_minor: 0, confirmed: true,
      },
    });
    renderPage();
    for (const title of ['Arbitrage summary', 'Annualised cost by plan', 'Ranked plan economics', 'Where your energy actually landed', 'Evidence, quality, and limitations']) {
      const status = within(card(title)).getByRole('status');
      if (paused) {
        expect(status).toHaveTextContent('The initial query is paused while the network is unavailable; no empty response is inferred.');
        expect(within(card(title)).queryByLabelText(`Loading ${title}`)).not.toBeInTheDocument();
      } else {
        expect(status).toHaveAccessibleName(`Loading ${title}`);
      }
      expect(card(title).querySelector('[data-empty-state]')).toBeNull();
    }
    assertOperationalBriefDisclosure(card('Arbitrage summary'), paused ? 'Source paused' : 'Loading source', { contains: true });
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No plan produced a priced result — check that your plans have at least one price band.')).not.toBeInTheDocument();
    expect(within(card('Your rate plan library')).getByText('EV Nights')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeEnabled();
  });

  it('renders authoritative empty replay results and measured zeros after success', () => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({
        results: [], session_count: 0, observed_energy_wh: 0, shiftable_pct: 0,
        evidence: [],
      }),
    });
    renderPage();
    assertOperationalBriefDisclosure(card('Arbitrage summary'), 'Source returned', { contains: true });
    for (const id of ['observed', 'plans', 'shift']) {
      expect(summaryMetric('Arbitrage summary', id)).toHaveAttribute('data-value-state', 'value');
      expect(summaryMetric('Arbitrage summary', id)).toHaveTextContent('0');
    }
    for (const title of ['Annualised cost by plan', 'Ranked plan economics', 'Where your energy actually landed']) {
      expect(card(title).querySelector('[data-empty-state]')).not.toBeNull();
      // EmptyState itself carries role="status"; only stray (non-empty-state)
      // notices would indicate a retained/stale leak.
      const stray = within(card(title)).queryAllByRole('status').filter(el => el.closest('[data-empty-state]') == null);
      expect(stray).toHaveLength(0);
    }
    expect(card('Evidence, quality, and limitations')).toHaveTextContent('No supporting evidence was returned.');
    expect(within(card('Your rate plan library')).getByText('EV Nights')).toBeVisible();
  });

  it('uses the real replay brief without promoting an unknown saving to zero or running another replay', () => {
    mockSimulate.mockReturnValue({ ...makeMutation(), data: makeSimulation() });
    renderPage();
    expectOperationalBand('Arbitrage summary', ['observed', 'plans', 'shift']);
    assertOperationalMetricUnavailable(card('Arbitrage summary'), 'Best-case annual saving');
    expect(summaryMetric('Arbitrage summary', 'plans')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Arbitrage summary', 'shift')).toHaveTextContent(/25(?:\.0+)?%/);
    fireEvent.click(within(card('Arbitrage summary')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    // The best-result name is the saving metric's context; unavailable
    // metrics (unknown saving here) have no drawer group, so the name now
    // surfaces only in the ranked-results table.
    expect(within(card('Ranked plan economics')).getByText('Replay Nights')).toBeInTheDocument();
    // Metric context (session counts, units) moved off the brief face into
    // the drawer's per-metric groups.
    expect(within(drawer).getByRole('group', { name: 'Observed energy' })).toHaveTextContent('8 sessions');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    assertOperationalMetricUnavailable(card('Arbitrage summary'), 'Best-case annual saving');
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
    expect(mutate).toHaveBeenCalledWith(2, { onSuccess: expect.any(Function) });
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

  it.each(['success', 'error'] as const)(
    'removes only success-confirmed deleted IDs and preserves selection on %s',
    async outcome => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const deletion = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      function useDeleteMutation() {
        return useMutation({ mutationFn: (_id: number) => deletion });
      }
      vi.mocked(useDeleteTariff).mockImplementation(useDeleteMutation);
      const mutate = vi.fn();
      mockSimulate.mockReturnValue({ ...makeMutation({ mutate }), data: undefined });
      renderPage();
      for (const name of ['EV Nights', 'Flat Saver']) {
        const row = screen.getByText(name).closest('tr');
        if (!row) throw new Error(`Missing selectable row: ${name}`);
        fireEvent.click(within(row).getByRole('switch'));
      }
      fireEvent.click(removeButton('Flat Saver'));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(removeButton('Flat Saver')).toBeDisabled());
      expect(screen.getByText('2 plans selected')).toBeVisible();
      if (outcome === 'success') {
        await act(async () => resolve());
        await waitFor(() => expect(screen.getByText('1 plans selected')).toBeVisible());
      } else {
        await act(async () => reject(new Error('delete unavailable')));
        await waitFor(() => expect(screen.getByText('delete unavailable')).toBeVisible());
        expect(screen.getByText('2 plans selected')).toBeVisible();
      }
      fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
      expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
        tariff_ids: outcome === 'success' ? [1] : [1, 2],
      }));
    },
  );

  it('retains selections across unloaded and partial library pages until explicitly cleared', () => {
    const mutate = vi.fn();
    mockSimulate.mockReturnValue({ ...makeMutation({ mutate }), data: undefined });
    const view = renderPage();
    const row = screen.getByText('Flat Saver').closest('tr');
    if (!row) throw new Error('Missing selectable row');
    fireEvent.click(within(row).getByRole('switch'));
    mockTariffs.mockReturnValue({
      ...makeQuery(undefined), isLoading: true, isFetching: true,
    });
    view.rerender(<TariffLabPage />);
    expect(screen.getByText('1 plans selected')).toBeVisible();
    mockTariffs.mockReturnValue(makeQuery({
      items: [makeTariff()], total: 150, limit: 100, offset: 0,
    }));
    view.rerender(<TariffLabPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ tariff_ids: [2] }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('No plans selected — every stored plan will be evaluated.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ tariff_ids: [] }));
  });
});


describe('TariffLabPage — server-paged plan library', () => {
  it('requests server pages without slicing loaded rows and retains cross-page replay selection', () => {
    const first = makeTariff();
    const second = makeTariff({ id: 101, name: 'Later plan', is_current: false });
    mockTariffs.mockImplementation((limit = 50, offset = 0) => makeQuery({
      items: offset === 0 ? [first] : [second], total: 150, limit, offset,
    }));
    const mutate = vi.fn();
    mockSimulate.mockReturnValue({ ...makeMutation({ mutate }), data: undefined });
    renderPage();

    const library = card('Your rate plan library');
    expect(mockTariffs).toHaveBeenLastCalledWith(100, 0);
    expect(within(library).getByText('Showing 1–100 of 150')).toBeVisible();
    expect(within(library).getByText('1 matching / 1 loaded rows')).toBeVisible();
    fireEvent.click(within(library).getByRole('switch', { name: 'Compare EV Nights' }));
    fireEvent.click(within(library).getByRole('button', { name: 'Next page' }));

    expect(mockTariffs).toHaveBeenLastCalledWith(100, 100);
    expect(within(library).queryByText('EV Nights')).not.toBeInTheDocument();
    expect(within(library).getByText('Later plan')).toBeVisible();
    expect(within(library).getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(within(library).getByRole('switch', { name: 'Compare Later plan' }));
    expect(screen.getByText('2 plans selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ tariff_ids: [1, 101] }));

    fireEvent.change(within(library).getByRole('combobox', { name: 'Rows per page' }), {
      target: { value: '25' },
    });
    expect(mockTariffs).toHaveBeenLastCalledWith(25, 0);
    expect(within(library).getByRole('switch', { name: 'Compare EV Nights' })).toBeChecked();
    expect(screen.getByText('2 plans selected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ tariff_ids: [] }));
  });

  it('does not invent a server total or next page from a full loaded page', () => {
    mockTariffs.mockReturnValue(makeQuery({
      items: Array.from({ length: 100 }, (_, index) => makeTariff({
        id: index + 1, name: `Loaded plan ${index + 1}`,
      })),
    }));
    renderPage();

    const library = card('Your rate plan library');
    expect(within(library).getByText('Loaded plan 100')).toBeVisible();
    expect(within(library).getByText('Page 1 of Unknown')).toBeVisible();
    expect(within(library).queryByText(/Showing .* of 100/)).not.toBeInTheDocument();
    expect(within(library).getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('returns to a valid server page when the total shrinks without discarding selection', async () => {
    let total = 101;
    mockTariffs.mockImplementation((limit = 50, offset = 0) => makeQuery({
      items: offset === 0 ? [makeTariff()] : total > 100
        ? [makeTariff({ id: 101, name: 'Last plan' })] : [],
      total, limit, offset,
    }));
    const view = renderPage();
    fireEvent.click(within(card('Your rate plan library')).getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Compare Last plan' }));
    total = 100;
    view.rerender(<TariffLabPage />);

    await waitFor(() => expect(mockTariffs).toHaveBeenLastCalledWith(100, 0));
    expect(within(card('Your rate plan library')).getByText('EV Nights')).toBeVisible();
    expect(screen.getByText('1 plans selected')).toBeVisible();
  });
});

describe('TariffLabPage — supplied monetary values', () => {
  function resultCell(plan: string, column: string) {
    const economics = card('Ranked plan economics');
    const headers = within(economics).getAllByRole('columnheader');
    const index = headers.findIndex(header => header.textContent?.includes(column));
    expect(index).toBeGreaterThanOrEqual(0);
    const row = within(economics).getByText(plan).closest('tr');
    if (!row) throw new Error(`Missing result row: ${plan}`);
    return within(row).getAllByRole('cell')[index];
  }

  it.each([
    { currency: 'USD', value: 123, expected: '$1.23' },
    { currency: 'JPY', value: 123, expected: '¥123' },
    { currency: 'KWD', value: 1234.5, expected: 'KWD 1.235' },
    { currency: 'JPY', value: 0, expected: '¥0' },
    { currency: 'USD', value: -123, expected: '-$1.23' },
    { currency: '', value: 123, expected: '—' },
  ])('keeps $currency chart values in raw minor units and labels their denomination', ({ currency, value, expected }) => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({ results: [
        makeResult(),
        makeResult({ tariff_id: 2, name: 'Denomination regression', currency, annual_cost_minor: value, rank: 2 }),
      ] }),
    });
    renderPage();

    const bars = chartProbe.bars.mock.lastCall?.[0];
    expect(bars.data[1]).toMatchObject({ annual: value, currency });
    const axis = chartProbe.axis.mock.lastCall?.[0];
    expect(axis.label.value).toContain('Cost (minor units)');
    expect(axis.label.value).toContain('USD');
    if (currency) expect(axis.label.value).toContain(currency);
    const chart = card('Annualised cost by plan');
    const row = within(chart).getByText('Denomination regression').closest('tr');
    expect(row).toHaveTextContent(expected);
    expect(row).toHaveTextContent(currency || '—');
    expect(within(chart).getByRole('columnheader', { name: 'ISO currency code' })).toBeInTheDocument();
    expect(within(chart).getByRole('columnheader', { name: 'Cost (minor units)' })).toBeInTheDocument();
    if (!row) throw new Error('Missing chart data row');
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent(String(value));

    const tooltip = chartProbe.tooltip.mock.lastCall?.[0];
    if (!isValidElement<ComponentProps<typeof import('@/components/charts').ChartTooltip>>(tooltip.content)) {
      throw new Error('Missing shared chart tooltip');
    }
    const payload = [{ name: 'Annual cost', value, payload: { currency } }];
    // ChartTooltip renders inline, so scope to the cloned render: the page
    // itself also renders tooltips after the icon-button conversion.
    const probe = render(cloneElement(tooltip.content, {
      active: true,
      label: 'Denomination regression',
      formatter: tooltip.formatter,
      payload,
    }));
    expect(within(probe.container).getByRole('tooltip')).toHaveTextContent(expected);
    expect(within(probe.container).getByRole('tooltip')).toHaveTextContent(currency ? `Annual cost (${currency})` : 'Annual cost');
    expect(resultCell('Denomination regression', 'Annualised cost')).toHaveTextContent(expected);
  });

  it.each([
    { value: 0, currency: 'USD', expected: '$0.00' },
    { value: -123, currency: 'USD', expected: '-$1.23' },
    { value: 123, currency: 'USD', expected: '$1.23' },
    { value: 123.5, currency: 'USD', expected: '$1.24' },
    { value: -123.5, currency: 'USD', expected: '-$1.24' },
    { value: 0, currency: 'JPY', expected: '¥0' },
    { value: 1234.5, currency: 'KWD', expected: 'KWD 1.235' },
  ])('renders $value minor units in $currency without discarding sign or zero', ({ value, currency, expected }) => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({
        max_saving_minor: value,
        results: [makeResult({
          currency, annual_cost_minor: value, delta_vs_current_minor: value,
          load_shift_saving_minor: value, energy_cost_minor: value,
          standing_cost_minor: value, demand_cost_minor: value,
          bands: [{ label: 'Measured band', energy_wh: 0, share_pct: 0, price_minor_per_wh: 0, cost_minor: value }],
        })],
      }),
    });
    renderPage();

    for (const column of ['Annualised cost', 'vs current', 'Load-shift upside']) {
      expect(resultCell('Replay Nights', column)).toHaveTextContent(expected);
    }
    expect(resultCell('Replay Nights', 'Energy / standing / demand'))
      .toHaveTextContent(`${expected} · ${expected} · ${expected}`);
    expect(summaryMetric('Arbitrage summary', 'saving')).toHaveTextContent(expected);
    expect(card('Where your energy actually landed')).toHaveTextContent(expected);
  });

  it.each(['missing', 'null', 'nan', 'infinite', 'negative-infinite'] as const)(
    'keeps %s monetary inputs unknown rather than measured zero',
    input => {
      const result = makeResult({ load_shift_saving_minor: 0, delta_vs_current_minor: null });
      const simulation = makeSimulation({ max_saving_minor: null, results: [result] });
      const tariff = makeTariff({ demand_charge_minor_per_w: 0 });
      if (input === 'missing') {
        Reflect.deleteProperty(result, 'load_shift_saving_minor');
        Reflect.deleteProperty(simulation, 'max_saving_minor');
        Reflect.deleteProperty(tariff, 'demand_charge_minor_per_w');
      } else {
        const value = input === 'null' ? null
          : input === 'nan' ? NaN : input === 'infinite' ? Infinity : -Infinity;
        Object.assign(result, { load_shift_saving_minor: value, delta_vs_current_minor: value });
        Object.assign(tariff, { demand_charge_minor_per_w: value });
        simulation.max_saving_minor = value;
      }
      mockTariffs.mockReturnValue(makeQuery({ items: [tariff] }));
      mockSimulate.mockReturnValue({ ...makeMutation(), data: simulation });
      renderPage();

      expect(resultCell('Replay Nights', 'Load-shift upside')).toHaveTextContent(/^—$/);
      expect(resultCell('Replay Nights', 'vs current')).toHaveTextContent(/^—$/);
      assertOperationalMetricUnavailable(card('Arbitrage summary'), 'Best-case annual saving');
      const row = within(card('Your rate plan library')).getByText('EV Nights').closest('tr');
      expect(row).not.toHaveTextContent('/kW');
    },
  );

  it.each([
    { value: 0, expected: '$0.00/kW' },
    { value: -0.012345, expected: '-$0.12/kW' },
    { value: 0.012345, expected: '$0.12/kW' },
  ])('renders a finite demand charge of $value without a positivity gate', ({ value, expected }) => {
    mockTariffs.mockReturnValue(makeQuery({ items: [makeTariff({ demand_charge_minor_per_w: value })] }));
    renderPage();
    const row = within(card('Your rate plan library')).getByText('EV Nights').closest('tr');
    expect(row).toHaveTextContent(expected);
  });

  it('uses each returned plan denomination instead of the first result or editor currency', () => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({
        results: [
          makeResult(),
          makeResult({
            tariff_id: 2, name: 'Yen plan', currency: 'JPY', rank: 2,
            annual_cost_minor: 123, delta_vs_current_minor: -123,
            load_shift_saving_minor: 0,
          }),
          makeResult({ tariff_id: 3, name: 'Unknown denomination', currency: '', rank: 3, load_shift_saving_minor: 0 }),
        ],
      }),
    });
    renderPage();
    expect(resultCell('Yen plan', 'Annualised cost')).toHaveTextContent('¥123');
    expect(resultCell('Yen plan', 'vs current')).toHaveTextContent('-¥123');
    expect(resultCell('Yen plan', 'Load-shift upside')).toHaveTextContent('¥0');
    expect(resultCell('Unknown denomination', 'Load-shift upside')).toHaveTextContent(/^—$/);
  });
});

describe('TariffLabPage — restrained page adoption', () => {
  it('names each comparison switch with its plan without changing selected IDs', () => {
    const mutate = vi.fn();
    mockSimulate.mockReturnValue({ ...makeMutation({ mutate }), data: undefined });
    renderPage();
    expect(screen.getByRole('switch', { name: 'Compare EV Nights' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Compare Flat Saver' }));
    expect(screen.getByRole('switch', { name: 'Compare Flat Saver' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
    expect(mutate).toHaveBeenCalledWith({
      vehicle_id: 7, window_days: 90, tariff_ids: [2], shiftable_pct: 35,
      switch_fee_minor: 0, confirmed: true,
    });
  });
    describe('TariffLabPage — complete mobile tables', () => {
      const observers: Array<{ element: Element; callback: ResizeObserverCallback }> = [];
      beforeEach(() => {
        observers.length = 0;
        vi.stubGlobal('ResizeObserver', class {
          constructor(private callback: ResizeObserverCallback) {}
          observe(element: Element) { observers.push({ element, callback: this.callback }); }
          unobserve() {}
          disconnect() {}
        });
      });
      afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.removeItem('teslasync-mode');
      });

      function resize(width: number) {
        act(() => observers.forEach(({ element, callback }) => callback(
          [{ target: element, contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )));
      }

      it.each(['light', 'dark'])('preserves every plan field, selection ID and confirmed action in %s mode', async mode => {
        localStorage.setItem('teslasync-mode', mode);
        const mutate = vi.fn();
        const replay = vi.fn();
        mockRemove.mockReturnValue(makeMutation({ mutate }));
        mockSimulate.mockReturnValue({ ...makeMutation({ mutate: replay }), data: undefined });
        renderPage();
        resize(375);
        const library = card('Your rate plan library');
        expect(library.querySelector('[data-mobile-table]')).not.toBeNull();
        const plan = within(library).getByRole('button', { name: 'Flat Saver' });
        expect(plan).toHaveAttribute('data-row-key', '2');
        fireEvent.click(within(library).getByRole('switch', { name: 'Compare Flat Saver' }));
        fireEvent.click(screen.getByRole('button', { name: 'Replay load against plans' }));
        expect(replay).toHaveBeenCalledWith(expect.objectContaining({ tariff_ids: [2] }));
        plan.focus();
        fireEvent.keyDown(plan, { key: 'Enter' });
        const detail = screen.getByRole('dialog', { name: 'Flat Saver' });
        for (const label of ['Compare', 'Plan', 'Structure', 'Price bands', 'Standing charge', 'Demand charge', 'Current', 'Actions']) {
          expect(within(detail).getByText(label)).toBeVisible();
        }
        expect(detail).toHaveTextContent('GridCo');
        expect(within(detail).getByRole('button', { name: 'Remove' })).toHaveClass('h-9', 'w-9');
        // The detail modal renders both a header dismiss and a footer Close.
        fireEvent.click(within(detail).getAllByRole('button', { name: 'Close' })[0]);
        // Row actions render in a [data-mobile-row-actions] sibling of the row
        // itself (both under the row's flex column), not inside the row.
        const rowContainer = plan.closest('[data-row-key]')?.parentElement?.parentElement?.parentElement;
        const actions = rowContainer instanceof HTMLElement ? rowContainer.querySelector('[data-mobile-row-actions]') : null;
        if (!(actions instanceof HTMLElement)) throw new Error('Missing mobile plan actions');
        fireEvent.click(within(actions).getByRole('button', { name: 'Remove' }));
        expect(mutate).not.toHaveBeenCalled();
        const confirmation = screen.getByRole('dialog', { name: 'Delete this tariff?' });
        expect(confirmation).toHaveTextContent('Flat Saver');
        fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(mutate).toHaveBeenCalledWith(2, { onSuccess: expect.any(Function) }));
        resize(1440);
        expect(within(library).getByRole('table')).toBeVisible();
        expect(within(library).getAllByRole('columnheader')).toHaveLength(8);
      });

      it('opens every replay economics column from a keyboard-operated mobile summary', () => {
        mockSimulate.mockReturnValue({ ...makeMutation(), data: makeSimulation() });
        renderPage();
        resize(375);
        const economics = card('Ranked plan economics');
        const summary = within(economics).getByRole('button', { name: 'Replay Nights' });
        expect(summary).toHaveAttribute('data-row-key', '1');
        fireEvent.keyDown(summary, { key: ' ' });
        const detail = screen.getByRole('dialog', { name: 'Replay Nights' });
        for (const label of ['Rank', 'Plan', 'Annualised cost', 'vs current', 'Effective price', 'Load-shift upside', 'Break-even', 'Peak demand', 'Energy / standing / demand']) {
          expect(within(detail).getByText(label)).toBeVisible();
        }
        expect(detail).toHaveTextContent('#1');
        expect(detail).toHaveTextContent('$150.35');
        // The detail modal renders both a header dismiss and a footer Close.
        fireEvent.click(within(detail).getAllByRole('button', { name: 'Close' })[0]);
        resize(1440);
        expect(within(economics).getAllByRole('columnheader')).toHaveLength(9);
      });
    });

  it('keeps all independent sections visible with an authoritatively empty library and no replay', () => {
    mockTariffs.mockReturnValue(makeQuery({ items: [] }));
    renderPage();
    for (const title of [
      'Comparison parameters', 'Arbitrage summary', 'Annualised cost by plan',
      'Ranked plan economics', 'Where your energy actually landed',
      'Your rate plan library', 'Evidence, quality, and limitations',
    ]) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(card('Your rate plan library')).toHaveTextContent('No plans yet');
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeEnabled();
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('retains signed replay economics and exposes measured band share without relying on hue', () => {
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: makeSimulation({ results: [makeResult({ delta_vs_current_minor: -123 })] }),
    });
    renderPage();
    const row = within(card('Ranked plan economics')).getByText('Replay Nights').closest('tr');
    expect(row).toHaveTextContent('-$1.23');
    const meter = within(card('Where your energy actually landed')).getByRole('meter', { name: 'Observed overnight band' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringMatching(/^100(?:\.0+)?%$/));
    expect(meter.firstElementChild).toHaveStyle({ width: '100%' });
    expect(meter.firstElementChild).toHaveClass('bg-[var(--text-secondary)]');
    expect(meter.closest('article')).toHaveClass('bg-[var(--surface-1)]', 'border-[var(--border-subtle)]');
    expect(card('Where your energy actually landed')).toHaveTextContent('$123.45');
  });

  it('round-trips end-of-day and ordinary business clock intervals without timezone conversion', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name required' }), { target: { value: 'Clock plan' } });
    const start = screen.getByLabelText('Starts');
    const end = screen.getByRole('textbox', { name: 'Ends required' });
    expect(end).toHaveValue('24:00');
    expect(end).toBeValid();
    fireEvent.change(start, { target: { value: '17:45' } });
    fireEvent.change(end, { target: { value: '23:59' } });
    expect(end).toBeValid();
    fireEvent.click(screen.getByRole('button', { name: 'Save rate plan' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      rates: [expect.objectContaining({ start_minute: 1065, end_minute: 1439 })],
    }), expect.any(Object));
    fireEvent.change(end, { target: { value: '24:' } });
    expect(end).toHaveValue('24:');
    expect(end).toBeInvalid();
    fireEvent.click(screen.getByRole('button', { name: 'Save rate plan' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    fireEvent.change(end, { target: { value: '24:00' } });
    expect(end).toBeValid();
    fireEvent.click(screen.getByRole('button', { name: 'Save rate plan' }));
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      rates: [expect.objectContaining({ start_minute: 1065, end_minute: 1440 })],
    }), expect.any(Object));
    expect(mutate.mock.calls[1][0].rates[0]).not.toHaveProperty('endClock');
    for (const value of ['', '24:01', '25:00', '12:60']) {
      fireEvent.change(end, { target: { value } });
      expect(end).toBeInvalid();
      fireEvent.click(screen.getByRole('button', { name: 'Save rate plan' }));
    }
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('retains raw tariff rate precision and success-only editor completion', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name required' }), { target: { value: 'Precise plan' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price (minor per Wh)' }), { target: { value: '0.012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate plan' }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Precise plan', currency: 'USD', structure: 'tou',
      standing_charge_minor_per_day: 0, demand_charge_minor_per_w: 0,
      export_price_minor_per_wh: 0, is_current: false,
      rates: [expect.objectContaining({
        day_mask: 127, start_minute: 0, end_minute: 1440,
        price_minor_per_wh: 0.012345, tier_upper_wh: null,
        season_start_month: 1, season_end_month: 12,
      })],
    }), expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(screen.getByRole('textbox', { name: 'Plan name required' })).toHaveValue('Precise plan');
    act(() => mutate.mock.calls[0][1].onSuccess());
    expect(screen.queryByRole('textbox', { name: 'Plan name required' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeInTheDocument();
  });
});
