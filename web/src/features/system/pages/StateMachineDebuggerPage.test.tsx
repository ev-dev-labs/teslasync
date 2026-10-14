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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getStateColor } from '@/types/fsm';

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

describe('StateMachineDebuggerPage — mobile field access', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens all transition fields with the keyboard at a 375px table width', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{
          target, contentRect: new DOMRect(0, 0, 375, 44),
          borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
        }], this);
      }
      unobserve() {}
      disconnect() {}
    });
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [{ id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
        to_state: 'driving', trigger: 'drive_evidence', ts: '2026-01-07T12:00:00Z',
        details: { guard: 'safe_guard', nested: { reason: 'full evidence' } } }],
      total: 1,
    } }));
    renderPage();

    const log = await screen.findByRole('group', { name: 'Transition log' });
    const row = within(log).getByRole('button', { name: '2026-01-07T12:00:00Z' });
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: 'Enter' });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('drive_evidence')).toBeInTheDocument();
    expect(within(dialog).getByText('Transition ID')).toBeInTheDocument();
    expect(within(dialog).getByText('42')).toBeInTheDocument();
    expect(within(dialog).getByText('Vehicle ID')).toBeInTheDocument();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
    expect(within(dialog).getByText(/"reason": "full evidence"/)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(row).toHaveFocus();

    const detail = within(log).getByRole('button', { name: 'View detail' });
    expect(detail).toHaveClass('min-h-11', 'min-w-11');
    const detailRegion = screen.getByRole('region', { name: 'Transition detail' });
    expect(detail).toHaveAttribute('aria-controls', detailRegion.id);
    detail.focus();
    await user.keyboard('{Enter}');
    expect(detail).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(detail.getAttribute('aria-controls')!)).toHaveTextContent('safe_guard');
    await user.keyboard(' ');
    expect(detail).toHaveAttribute('aria-expanded', 'false');
    expect(detailRegion).toHaveTextContent('Select a transition to inspect its snapshot');
    expect(detail).toHaveFocus();
  });
});

describe('StateMachineDebuggerPage — timeline detail association', () => {
  it('shares a stable named detail region between timeline selection and log disclosure', async () => {
    const user = userEvent.setup();
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [
        { id: 41, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
          to_state: 'driving', trigger: 'start_drive', ts: new Date(Date.now() - 120_000).toISOString() },
        { id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'driving',
          to_state: 'parked', trigger: 'end_drive', ts: new Date(Date.now() - 60_000).toISOString() },
      ],
      total: 2,
    } }));
    renderPage();
    const region = screen.getByRole('region', { name: 'Transition detail' });
    const first = screen.getByTestId('state-timeline-tick-41');
    const second = screen.getByTestId('state-timeline-tick-42');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-controls', region.id);
    second.focus();
    await user.keyboard('{Enter}');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(region).toHaveTextContent('end_drive');
    const disclosures = screen.getAllByRole('button', { name: 'View detail' });
    expect(disclosures[1]).toHaveAttribute('aria-expanded', 'true');
    expect(disclosures[0]).toHaveAttribute('aria-expanded', 'false');
    disclosures[0].focus();
    await user.keyboard(' ');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(region).toHaveTextContent('start_drive');
    expect(screen.getByRole('region', { name: 'Transition detail' })).toBe(region);
    expect(disclosures[0]).toHaveAttribute('aria-controls', region.id);
  });
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
import { useFSMStats, useFSMTransitions, fsmKeys, buildTransitionsPath } from '@/api/hooks/useFSM';
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

function UrlEvidence() {
  const location = useLocation();
  return <output aria-label="URL evidence">{location.search}</output>;
}

function renderPage(entry = '/system/fsm') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <StateMachineDebuggerPage />
        <UrlEvidence />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(page);
  return { ...result, rerenderPage: () => result.rerender(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <StateMachineDebuggerPage />
        <UrlEvidence />
      </QueryClientProvider>
    </MemoryRouter>,
  ) };
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
    expect(screen.getByTestId('fsm-summary')).toHaveAttribute('aria-busy', 'true');
    expect(kpis.querySelectorAll('[data-operational-value]')).toHaveLength(0);
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
    expect(screen.getByText('Transition log')).toBeInTheDocument();
  });

  it('renders honest zeros and empty states (no retries) when the queries succeed empty', () => {
    renderPage();

    expect(screen.getByText('Transitions (Page)')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByTestId('fsm-health-all-clear')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});


describe('StateMachineDebuggerPage — shared presentation and preservation', () => {
  it('preserves linked evidence and time scope through loading, failure and an absent server-page row until resolution', () => {
    const at = '2026-01-07T12:00:00Z';
    const entry = `/system/fsm?selected=42&at=${at}&from=2026-01-01&to=2026-01-07&time_scope=custom`;
    mockTrans.mockReturnValue(makeQuery({ isLoading: true }));
    const { rerenderPage } = renderPage(entry);
    const params = () => new URLSearchParams(screen.getByLabelText('URL evidence').textContent ?? '');
    expect(params().get('at')).toBe(at);
    expect(params().get('selected')).toBe('42');
    expect(params().get('time_scope')).toBe('custom');
    expect(mockSnapshot).toHaveBeenCalledWith(7, '', '', { enabled: false });

    mockTrans.mockReturnValue(makeQuery({ isError: true, error: new Error('offline'), status: 'error' }));
    rerenderPage();
    expect(params().get('at')).toBe(at);
    mockTrans.mockReturnValue(makeQuery({ data: { data: [], total: 233 } }));
    rerenderPage();
    expect(params().get('at')).toBe(at);

    const resolvedAt = '2026-01-07T12:01:00Z';
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [{ id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
        to_state: 'driving', trigger: 'start', ts: resolvedAt }], total: 233,
    } }));
    rerenderPage();
    expect(params().get('at')).toBe(resolvedAt);
    expect(params().get('from')).toBe('2026-01-01');
    expect(params().get('to')).toBe('2026-01-07');
    expect(mockSnapshot).toHaveBeenCalledWith(7, resolvedAt, '', { enabled: true });
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('retains a timestamp-only link until the user explicitly resumes live mode', () => {
    renderPage('/system/fsm?at=2026-01-07T12:00:00Z');
    expect(screen.getByLabelText('URL evidence')).toHaveTextContent('at=');
    fireEvent.click(screen.getByRole('button', { name: /Live/ }));
    expect(screen.getByLabelText('URL evidence')).not.toHaveTextContent('at=');
    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(screen.getByLabelText('URL evidence')).not.toHaveTextContent('at=');
  });

  it('rejects invalid incoming evidence identifiers, timestamps and FSM types', () => {
    renderPage('/system/fsm?selected=-3&at=not-a-time&fsm=unsupported');
    expect(screen.getByLabelText('URL evidence')).not.toHaveTextContent('selected=');
    expect(screen.getByLabelText('URL evidence')).not.toHaveTextContent('at=');
    expect(mockTrans).toHaveBeenCalledWith('7', 'all', 168, 1, 50,
      '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
  });

  it('serializes a stored calendar range even when the incoming URL has no range', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Share permalink' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const params = new URL(String(writeText.mock.calls[0][0])).searchParams;
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-01-08');
    expect(params.get('time_scope')).toBe('custom');
  });

  it('labels and serializes rolling permalink bounds as a preset rather than an exact historical replay', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockRange.mockReturnValue({
      start: '2026-01-07', end: '2026-01-08', presetId: '24h',
      startInstant: '2026-01-07T12:00:00Z', endInstantExclusive: '2026-01-08T12:00:00Z',
    });
    renderPage();
    expect(screen.getByText('The link reopens the rolling preset, not these exact time bounds.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share permalink' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(new URL(String(writeText.mock.calls[0][0])).searchParams.get('time_scope')).toBe('24h');
  });

  it('does not declare the matching range empty when only the loaded page is empty', () => {
    mockTrans.mockReturnValue(makeQuery({ data: { data: [], total: 233 } }));
    renderPage();
    expect(screen.getByText('0 / 233')).toBeInTheDocument();
    expect(screen.getByTestId('live-controls-counter')).toHaveTextContent(
      '0 in window · 0 in filtered buffer · 0 loaded · 233 matching',
    );
    expect(screen.getAllByText('No transitions on the loaded server page.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No transitions in 2026-01/)).not.toBeInTheDocument();
  });

  it('clears only the filtered buffer while preserving the loaded page and matching total', () => {
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [{ id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
        to_state: 'driving', trigger: 'start', ts: '2026-01-07T12:00:00Z' }],
      total: 233,
    } }));
    renderPage();
    expect(screen.getByTestId('live-controls-counter')).toHaveTextContent(
      '0 in window · 1 in filtered buffer · 1 loaded · 233 matching',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear buffer' }));
    expect(screen.getByTestId('live-controls-counter')).toHaveTextContent(
      '0 in window · 0 in filtered buffer · 1 loaded · 233 matching',
    );
    expect(screen.getByText('1 / 233')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View detail' })).toBeInTheDocument();
    expect(screen.getAllByText('Loaded transition page only').length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ['rolling', '2026-06-14T12:07:12.345Z', '2026-06-15T12:07:12.345Z', 24],
    ['custom DST', '2026-03-08T00:00:00-08:00', '2026-03-09T00:00:00-07:00', 23],
    ['all time', '', '', 0],
  ])('passes exact %s instants and duration to the transition query', (_name, startInstant, endInstantExclusive, hours) => {
    mockRange.mockReturnValue({
      start: '2026-03-08', end: '2026-03-08', startInstant, endInstantExclusive,
      setRange: vi.fn(),
    });
    renderPage();
    expect(mockTrans).toHaveBeenCalledWith('7', 'all', hours, 1, 50, startInstant, endInstantExclusive);
    const path = buildTransitionsPath('7', 'all', hours, 1, 50, startInstant, endInstantExclusive);
    const params = new URL(path, 'https://example.test').searchParams;
    expect(params.get('end')).toBe(endInstantExclusive || null);
    expect(params.get('start')).toBe(startInstant || null);
  });

  it('changes the query key when rolling bounds move without changing the calendar dates', () => {
    const initial = {
      start: '2026-06-14', end: '2026-06-15',
      startInstant: '2026-06-14T12:07:12.345Z',
      endInstantExclusive: '2026-06-15T12:07:12.345Z',
      setRange: vi.fn(),
    };
    mockRange.mockReturnValue(initial);
    const { rerender } = renderPage();
    const firstArgs = mockTrans.mock.calls.at(-1)!;
    const firstKey = fsmKeys.transitions(...firstArgs as Parameters<typeof fsmKeys.transitions>);
    mockRange.mockReturnValue({
      ...initial, startInstant: '2026-06-14T12:08:12.345Z',
      endInstantExclusive: '2026-06-15T12:08:12.345Z',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<MemoryRouter><QueryClientProvider client={client}>
      <StateMachineDebuggerPage />
    </QueryClientProvider></MemoryRouter>);
    const nextArgs = mockTrans.mock.calls.at(-1)!;
    expect(nextArgs[2]).toBe(24);
    expect(fsmKeys.transitions(...nextArgs as Parameters<typeof fsmKeys.transitions>)).not.toEqual(firstKey);
  });

  it('threads independent selected and previous snapshot loading, retries, retention and recovery', () => {
    const previousAt = '2026-01-07T11:00:00Z';
    const selectedAt = '2026-01-07T12:00:00Z';
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [
        { id: 41, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'driving',
          to_state: 'parked', trigger: 'stop', ts: previousAt },
        { id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
          to_state: 'driving', trigger: 'start', ts: selectedAt },
      ], total: 2,
    } }));
    const selectedRetry = vi.fn();
    const previousRetry = vi.fn();
    let selected = makeQuery({ isFetching: true, refetch: selectedRetry });
    let previous = makeQuery({ fetchStatus: 'paused', refetch: previousRetry });
    mockSnapshot.mockImplementation((_id: number, at: string) =>
      at === selectedAt ? selected : previous);
    const { rerender } = renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'View detail' })[1]);
    fireEvent.click(screen.getByRole('switch', { name: 'Diff vs previous' }));
    expect(screen.getByTestId('snapshot-inspector-comparison-status')).toHaveTextContent('Refresh paused');
    expect(screen.queryByTestId('snapshot-inspector-no-signals')).toBeNull();
    fireEvent.click(within(screen.getByTestId('snapshot-inspector-comparison-status'))
      .getByRole('button', { name: 'Retry' }));
    expect(previousRetry).toHaveBeenCalledTimes(1);
    expect(selectedRetry).not.toHaveBeenCalled();

    const snapshot = { vehicle_id: 7, at: selectedAt, count: 1,
      signals: { speed: { value: 0, source: 'log' } } };
    selected = makeQuery({ data: snapshot, error: new Error('selected refresh'), refetch: selectedRetry });
    previous = makeQuery({ data: { ...snapshot, at: previousAt },
      error: new Error('previous refresh'), refetch: previousRetry });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = () => <MemoryRouter><QueryClientProvider client={client}>
      <StateMachineDebuggerPage />
    </QueryClientProvider></MemoryRouter>;
    rerender(page());
    expect(screen.getByText('speed')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(selectedRetry).toHaveBeenCalledTimes(1);
    selected = makeQuery({ data: snapshot, refetch: selectedRetry });
    previous = makeQuery({ data: { ...snapshot, at: previousAt }, refetch: previousRetry });
    rerender(page());
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('speed')).toBeInTheDocument();
  });

  it.each(['driving', 'charging', 'unexpected_state'])('uses the canonical non-pulsing vehicle badge for %s', (state) => {
    mockState.mockReturnValue(makeQuery({
      data: { state: { state, since: '2026-01-01T00:00:00Z' } },
    }));
    renderPage();

    const overview = screen.getByRole('region', { name: 'Vehicle state overview' });
    const label = within(overview).getByText(state);
    expect(label).toHaveClass(...getStateColor('vehicle', state).text.split(' '));
    expect(overview.querySelector('.animate-pulse')).toBeNull();
    expect(within(overview).getByText('Mode:')).toBeInTheDocument();
    expect(within(overview).getByText('Since:')).toBeInTheDocument();
  });

  it('keeps the detail section visible before a transition is selected', () => {
    renderPage();

    const title = screen.getByRole('heading', { name: 'Transition detail' });
    expect(within(title.parentElement!).getByText('Select a transition to inspect its snapshot')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transition log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transition counts' })).toBeInTheDocument();
  });

  it('preserves selected transition identifiers, guard, rounded duration and arbitrary raw details', () => {
    mockTrans.mockReturnValue(makeQuery({ data: {
      data: [{ id: 42, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
        to_state: 'driving', trigger: 'drive_evidence', ts: '2026-01-07T12:00:00Z',
        details: { guard: 'safe_guard', duration_in_state_ms: 7199000, raw_speed: 12.345 } }],
      total: 1,
    } }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'View detail' }));

    const detail = screen.getByRole('heading', { name: 'Transition detail' }).parentElement!;
    expect(within(detail).getByText('42')).toBeInTheDocument();
    expect(within(detail).getByText('7')).toBeInTheDocument();
    expect(within(detail).getByText('safe_guard')).toBeInTheDocument();
    expect(within(detail).getByText('2h')).toBeInTheDocument();
    expect(within(detail).getByText('raw_speed: 12.345')).toBeInTheDocument();
    expect(mockSnapshot).toHaveBeenCalledWith(7, '2026-01-07T12:00:00Z', '', { enabled: true });
  });

  it('retains header-owned vehicle scope and half-open transition bounds', () => {
    renderPage();

    expect(mockState).toHaveBeenCalledWith('7');
    expect(mockStats).toHaveBeenCalledWith('7');
    expect(mockTrans).toHaveBeenCalledWith('7', 'all', expect.any(Number), 1, 50,
      '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
  });
});
