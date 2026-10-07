/**
 * StateMachineDebuggerPage — query-state branches.
 *
 * The debugger owns three queries (live state, sub-FSM stats, transition
 * log). Every section must surface its query's failure with retry: on error
 * the page previously rendered zeros, "No state data", and — worst — an
 * "All FSMs healthy" verdict. Only the query + environment hooks, the form
 * row, and the AI narrator are mocked; sections, FSM panels, charts, and
 * error surfaces render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; chart containers read it on mount.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

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
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));
vi.mock('@/api/hooks/useAdmin', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAdmin')>('@/api/hooks/useAdmin');
  return { ...actual, useVehicleStateMachine: vi.fn() };
});
vi.mock('@/api/hooks/useFSM', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useFSM')>('@/api/hooks/useFSM');
  return { ...actual, useFSMStats: vi.fn(), useFSMTransitions: vi.fn() };
});
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useTelemetry')>('@/api/hooks/useTelemetry');
  return { ...actual, useSignalSnapshot: vi.fn() };
});
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({ value }: { value: { start: string; end: string } }) => (
    <div data-testid="range-picker">{`${value.start}|${value.end}`}</div>
  ),
}));
vi.mock('@/components/ai/AIStateMachineDebuggerNarrator', () => ({
  AIStateMachineDebuggerNarrator: () => null,
}));

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useSignalSnapshot } from '@/api/hooks/useTelemetry';
import StateMachineDebuggerPage from './StateMachineDebuggerPage';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockRange = useRangeState as unknown as ReturnType<typeof vi.fn>;
const mockState = useVehicleStateMachine as unknown as ReturnType<typeof vi.fn>;
const mockStats = useFSMStats as unknown as ReturnType<typeof vi.fn>;
const mockTrans = useFSMTransitions as unknown as ReturnType<typeof vi.fn>;
const mockSnapshot = useSignalSnapshot as unknown as ReturnType<typeof vi.fn>;

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

const EMPTY_TRANS = { data: [], total: 0 };
const EMPTY_STATS = { active_subs: [] };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StateMachineDebuggerPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockRange.mockReturnValue({
    start: '2026-01-01',
    end: '2026-01-08',
    startInstant: '2026-01-01T00:00:00Z',
    endInstantExclusive: '2026-01-08T00:00:00Z',
    setRange: vi.fn(),
  });
  mockState.mockReturnValue(makeQuery({ data: undefined }));
  mockStats.mockReturnValue(makeQuery({ data: EMPTY_STATS }));
  mockTrans.mockReturnValue(makeQuery({ data: EMPTY_TRANS }));
  mockSnapshot.mockReturnValue({ data: undefined, isFetching: false });
});

describe('StateMachineDebuggerPage — query branches', () => {
  it('shows skeletons (not zeroed cards) while the queries are in flight', () => {
    mockState.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    mockTrans.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    const { container } = renderPage();

    const kpis = screen.getByRole('region', { name: 'FSM summary metrics' });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(within(kpis).queryByText('Transitions (Page)')).not.toBeInTheDocument();
  });

  it('surfaces the transitions failure in every dependent section with working retries', () => {
    const refetchTrans = vi.fn();
    const refetchState = vi.fn();
    mockState.mockReturnValue(makeQuery({ data: undefined, refetch: refetchState }));
    mockTrans.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('trans down'), status: 'error', refetch: refetchTrans }),
    );
    renderPage();

    // The health band must never declare "All FSMs healthy" on a failed feed.
    expect(screen.queryByTestId('fsm-health-all-clear')).not.toBeInTheDocument();
    expect(screen.queryByText(/All FSMs healthy/)).not.toBeInTheDocument();

    // KPI band, health band, timeline panel, donut, counts, timeline chart,
    // and transition log each carry a retry.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(6);

    // The KPI retry refetches both sources the band mixes.
    const kpiRetry = within(
      screen.getByRole('region', { name: 'FSM summary metrics' }),
    ).getByRole('button', { name: 'Retry' });
    fireEvent.click(kpiRetry);
    expect(refetchTrans).toHaveBeenCalled();
    expect(refetchState).toHaveBeenCalled();
  });

  it('surfaces the live-state failure in the state panel and the KPI band', () => {
    const refetchState = vi.fn();
    mockState.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('state down'), status: 'error', refetch: refetchState }),
    );
    renderPage();

    const overview = screen.getByRole('region', { name: 'Vehicle state overview' });
    const retry = within(overview).getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetchState).toHaveBeenCalledTimes(1);

    // The KPI band mixes in the live-state card, so it errors too.
    expect(
      within(screen.getByRole('region', { name: 'FSM summary metrics' })).getByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument();
  });

  it('surfaces the stats failure in the sub-FSM panel without touching the rest', () => {
    const refetchStats = vi.fn();
    mockStats.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('stats down'), status: 'error', refetch: refetchStats }),
    );
    renderPage();

    const overview = screen.getByRole('region', { name: 'Vehicle state overview' });
    const retry = within(overview).getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetchStats).toHaveBeenCalledTimes(1);
    // KPI band and transition sections stay healthy on a stats-only failure.
    expect(
      within(screen.getByRole('region', { name: 'FSM summary metrics' })).queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('retains prior transitions and state when a background refresh fails', () => {
    mockState.mockReturnValue(makeQuery({
      data: { state: { state: 'parked', since: '2026-01-01T00:00:00Z' } },
      isError: true, error: new Error('state refresh failed'), status: 'error',
    }));
    mockTrans.mockReturnValue(makeQuery({
      data: EMPTY_TRANS,
      isError: true, error: new Error('transitions refresh failed'), status: 'error',
    }));
    renderPage();

    expect(screen.getByText('Transitions (Page)')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'FSM summary metrics' })).queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Transition Log')).toBeInTheDocument();
  });

  it('renders honest zeros and empty states (no retries) when the queries succeed empty', () => {
    renderPage();

    expect(screen.getByText('Transitions (Page)')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByTestId('fsm-health-all-clear')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
