/**
 * JourneyPanel — behaviour coverage.
 *
 * Data hooks (`useJourneys` / `useJourney` / `useCreateJourney` /
 * `useTransitionJourney`) are mocked and driven per test; shared UI
 * (GlassPanel, DataTable, Badge, Select, Input, Button, QueryError,
 * EmptyState) is REAL so the render-boundary wiring is genuinely
 * exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';

const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), locale: datePreferences.locale }) };
});
vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return { ...actual, useTimezone: () => datePreferences.tz };
});

// ── i18n stub ──
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
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
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

// ── data hooks, driven per test ──
vi.mock('@/api/hooks/useJourney', () => ({
  useJourneys: vi.fn(),
  useJourney: vi.fn(),
  useCreateJourney: vi.fn(),
  useTransitionJourney: vi.fn(),
  useScoreStops: vi.fn(),
  useDeparture: vi.fn(),
  useChecklist: vi.fn(),
  useRefreshChecklist: vi.fn(),
  useJourneyLive: vi.fn(),
  useCheckIn: vi.fn(),
  useReplanAssessment: vi.fn(),
  useRequestReplan: vi.fn(),
  useArrival: vi.fn(),
  useReport: vi.fn(),
  useNudge: vi.fn(),
}));

// StopScorePanel mounts inside the detail view; its site directory stays
// inert here so these tests keep asserting only JourneyPanel behaviour.
vi.mock('@/api/hooks/useCharging', () => ({
  useWaitOracleSites: vi.fn(),
}));

import {
  type CreateJourneyRequest,
  useJourneys,
  useJourney,
  useCreateJourney,
  useTransitionJourney,
  useScoreStops,
  useDeparture,
  useChecklist,
  useRefreshChecklist,
  useJourneyLive,
  useCheckIn,
  useReplanAssessment,
  useRequestReplan,
  useArrival,
  useReport,
  useNudge,
} from '@/api/hooks/useJourney';
import { useWaitOracleSites } from '@/api/hooks/useCharging';
import { JourneyPanel } from './JourneyPanel';

const mockList = useJourneys as unknown as ReturnType<typeof vi.fn>;
const mockDetail = useJourney as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateJourney as unknown as ReturnType<typeof vi.fn>;
const mockTransition = useTransitionJourney as unknown as ReturnType<typeof vi.fn>;
const mockScore = useScoreStops as unknown as ReturnType<typeof vi.fn>;
const mockSites = useWaitOracleSites as unknown as ReturnType<typeof vi.fn>;
const mockDeparture = useDeparture as unknown as ReturnType<typeof vi.fn>;
const mockChecklist = useChecklist as unknown as ReturnType<typeof vi.fn>;
const mockRefreshChecklist = useRefreshChecklist as unknown as ReturnType<typeof vi.fn>;
const mockLive = useJourneyLive as unknown as ReturnType<typeof vi.fn>;
const mockCheckIn = useCheckIn as unknown as ReturnType<typeof vi.fn>;
const mockReplanAssess = useReplanAssessment as unknown as ReturnType<typeof vi.fn>;
const mockReplan = useRequestReplan as unknown as ReturnType<typeof vi.fn>;
const mockArrival = useArrival as unknown as ReturnType<typeof vi.fn>;
const mockReport = useReport as unknown as ReturnType<typeof vi.fn>;
const mockNudge = useNudge as unknown as ReturnType<typeof vi.fn>;

const sessions = [
  {
    id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
    origin_name: 'Home', origin_lat: null, origin_lng: null,
    dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
    status: 'planned', plan_version: 1,
    created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
    started_at: null, ended_at: null,
  },
  {
    id: 2, vehicle_id: 7, name: 'LA run',
    origin_name: '', origin_lat: null, origin_lng: null,
    dest_name: '', dest_lat: null, dest_lng: null,
    status: 'active', plan_version: 3,
    created_at: '2026-09-09T10:00:00Z', updated_at: '2026-09-11T08:00:00Z',
    started_at: '2026-09-11T08:00:00Z', ended_at: null,
  },
];

const detail = {
  session: sessions[0],
  plans: [
    { id: 11, session_id: 1, version: 1, plan: {}, note: 'initial', created_at: '2026-09-10T10:00:00Z' },
  ],
  next_statuses: ['active', 'aborted'],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

function renderPanel(vehicleId: number | null = 7) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: number | null) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <JourneyPanel vehicleId={id} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(view(vehicleId));
  return { ...rendered, rerenderVehicle: (id: number | null) => rendered.rerender(view(id)) };
}

beforeEach(() => {
  Object.assign(datePreferences, { locale: 'en-US', tz: 'UTC' });
  vi.clearAllMocks();
  mockList.mockReturnValue(idle({ data: sessions }));
  mockDetail.mockReturnValue(idle());
  mockCreate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockTransition.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockScore.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined });
  mockSites.mockReturnValue(idle({ data: [] }));
  mockDeparture.mockReturnValue(idle());
  mockChecklist.mockReturnValue(idle());
  mockRefreshChecklist.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockLive.mockReturnValue(idle());
  mockCheckIn.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockReplanAssess.mockReturnValue(idle());
  mockReplan.mockReturnValue({ mutate: vi.fn(), isPending: false, data: undefined });
  mockArrival.mockReturnValue(idle());
  mockReport.mockReturnValue(idle());
  mockNudge.mockReturnValue(idle());
});

describe('JourneyPanel', () => {
  it('updates journey and plan timestamps when display locale and timezone change', () => {
    const plan = { ...detail.plans[0], created_at: '2026-09-12T01:00:00Z' };
    mockDetail.mockReturnValue(idle({ data: { ...detail, plans: [plan] } }));
    const { rerenderVehicle } = renderPanel();
    expect(screen.getAllByText(formatDateTime(sessions[0].updated_at, datePreferences)).length).toBeGreaterThan(0);
    Object.assign(datePreferences, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    rerenderVehicle(7);
    expect(screen.getAllByText(formatDateTime(sessions[0].updated_at, datePreferences)).length).toBeGreaterThan(0);
    expect(screen.getByText(formatDateTime(plan.created_at, datePreferences))).toBeInTheDocument();
    expect(screen.getAllByText(formatDateTime(sessions[1].updated_at, datePreferences)).length).toBeGreaterThan(0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens the correct journey from mobile cards and inline actions while retaining every quick-view column', async () => {
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    const user = userEvent.setup();
    renderPanel();
    act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width: 375 } } as ResizeObserverEntry], {} as ResizeObserver,
    )));
    const card = screen.getByRole('button', { name: 'LA run' });
    card.focus();
    await user.keyboard('{Enter}');
    expect(mockDetail).toHaveBeenLastCalledWith(2);
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    expect(mockDetail).toHaveBeenLastCalledWith(1);
    await user.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Tahoe ski trip' });
    for (const label of ['Journey', 'Status', 'Plan', 'Updated', 'Actions']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Home → Tahoe')).toBeInTheDocument();
    expect(within(dialog).getByText('v1')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width: 1200 } } as ResizeObserverEntry], {} as ResizeObserver,
    )));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
  });

  it('isolates pending creation on vehicle change and retains the new draft after rejection', async () => {
    let resolve!: (value: typeof sessions[number]) => void;
    let reject!: (reason: Error) => void;
    mockCreate.mockImplementation(() => useMutation({
      mutationFn: () => new Promise<typeof sessions[number]>((yes, no) => { resolve = yes; reject = no; }),
    }));
    const unrelated = [{ session_id: 99, recorded_at: '2026-09-10T10:00:00Z' }];
    localStorage.setItem('teslasync.journey.checkin-outbox', JSON.stringify(unrelated));
    const { rerenderVehicle } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Old draft' } });
    fireEvent.click(screen.getByText('Create journey'));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    mockList.mockReturnValue(idle({ data: [{ ...sessions[1], vehicle_id: 8 }] }));
    rerenderVehicle(8);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'New draft' } });
    await act(async () => resolve({ ...sessions[0], id: 99 }));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('New draft');
    expect(screen.getByRole('button', { name: 'Create journey' })).toBeEnabled();
    fireEvent.click(screen.getByText('Create journey'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create journey' })).toBeDisabled());
    await act(async () => reject(new Error('rejected')));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create journey' })).toBeEnabled());
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('New draft');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('teslasync.journey.checkin-outbox')!)).toEqual(unrelated);
    localStorage.removeItem('teslasync.journey.checkin-outbox');
  });

  it('does not let a stale create completion close or replace another vehicle draft', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    const { rerenderVehicle } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Old draft' } });
    fireEvent.click(screen.getByText('Create journey'));
    const completion = mutate.mock.calls[0][1].onSuccess;
    mockList.mockReturnValue(idle({ data: [{ ...sessions[1], vehicle_id: 8 }] }));
    rerenderVehicle(8);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'New draft' } });
    act(() => completion({ ...sessions[0], id: 99 }));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('New draft');
    expect(mockDetail).not.toHaveBeenCalledWith(99);
  });

  it('recovers the originating draft after a pending rejection in another vehicle scope', async () => {
    let reject!: (reason: Error) => void;
    const mutationFn = vi.fn((_request: CreateJourneyRequest) =>
      new Promise<typeof sessions[number]>((_, no) => { reject = no; }));
    mockCreate.mockImplementation(() => useMutation({ mutationFn, retry: false }));
    const { rerenderVehicle } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: ' Original draft ' } });
    fireEvent.change(screen.getByLabelText('Origin'), { target: { value: ' Home ' } });
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: ' Tahoe ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create journey' }));
    await waitFor(() => expect(mutationFn).toHaveBeenCalledOnce());
    expect(mutationFn.mock.calls[0][0]).toEqual({
      vehicle_id: 7, name: 'Original draft', origin_name: 'Home', dest_name: 'Tahoe',
    });
    rerenderVehicle(8);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Vehicle eight draft' } });
    await act(async () => reject(new Error('creation rejected')));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Vehicle eight draft');
    rerenderVehicle(7);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    expect(screen.getByLabelText(/Journey name/)).toHaveValue(' Original draft ');
    expect(screen.getByLabelText('Origin')).toHaveValue(' Home ');
    expect(screen.getByLabelText('Destination')).toHaveValue(' Tahoe ');
  });

  it('ignores a pre-switch completion even after returning to the originating vehicle', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    const { rerenderVehicle } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Retained draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create journey' }));
    const completion = mutate.mock.calls[0][1].onSuccess;
    rerenderVehicle(null);
    rerenderVehicle(7);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    act(() => completion({ ...sessions[0], id: 99 }));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Retained draft');
    expect(mockDetail).not.toHaveBeenCalledWith(99);
  });

  it('preserves an edited draft after old success and settles a matching successful creation', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Submitted' } });
    fireEvent.click(screen.getByText('Create journey'));
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Edited' } });
    act(() => mutate.mock.calls[0][1].onSuccess(sessions[0]));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Edited');
    fireEvent.click(screen.getByText('Create journey'));
    act(() => mutate.mock.calls[1][1].onSuccess(sessions[0]));
    expect(screen.queryByLabelText(/Journey name/)).not.toBeInTheDocument();
    expect(mockDetail).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('');
  });

  it('retains the draft when creation returns a session for a different vehicle', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Vehicle seven draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create journey' }));
    act(() => mutate.mock.calls[0][1].onSuccess({ ...sessions[0], vehicle_id: 8, id: 99 }));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Vehicle seven draft');
    expect(mockDetail).not.toHaveBeenCalledWith(99);
  });

  it('does not replace a newly selected session when pending creation succeeds', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Keep draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create journey' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);
    expect(mockDetail).toHaveBeenLastCalledWith(2);
    act(() => mutate.mock.calls[0][1].onSuccess({ ...sessions[0], id: 99 }));
    expect(mockDetail).toHaveBeenLastCalledWith(2);
    expect(mockDetail).not.toHaveBeenCalledWith(99);
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Keep draft');
  });

  it('does not settle a cancelled and reopened draft after a status scope change', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Keep draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create journey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), {
      target: { value: 'active' },
    });
    act(() => mutate.mock.calls[0][1].onSuccess({ ...sessions[0], id: 99 }));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Keep draft');
    expect(mockDetail).not.toHaveBeenCalledWith(99);
  });

  it('hides mismatched detail and preserves the draft after create rejection', () => {
    mockCreate.mockReturnValue({ mutate: vi.fn(), isPending: false, error: new Error('creation rejected') });
    mockDetail.mockReturnValue(idle({ data: { ...detail, session: sessions[1] } }));
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByText('Create journey'));
    expect(screen.getByLabelText(/Journey name/)).toHaveValue('Keep me');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
  it.each([
    { status: 'planned', mounted: ['Leave now?'], absent: ['Live trip', 'Replan', 'Arrival', 'Trip report'] },
    { status: 'active', mounted: ['Live trip', 'Replan', 'Arrival'], absent: ['Leave now?', 'Trip report'] },
    { status: 'paused', mounted: ['Live trip', 'Replan', 'Arrival'], absent: ['Leave now?', 'Trip report'] },
    { status: 'completed', mounted: ['Trip report'], absent: ['Leave now?', 'Live trip', 'Replan', 'Arrival'] },
    { status: 'aborted', mounted: ['Trip report'], absent: ['Leave now?', 'Live trip', 'Replan', 'Arrival'] },
  ])('preserves $status lifecycle presenters and both independent preparation panels', ({ status, mounted, absent }) => {
    mockDetail.mockReturnValue(idle({
      data: { ...detail, session: { ...detail.session, status }, next_statuses: [] },
    }));
    renderPanel();
    for (const title of ['Score stops', 'When to leave', 'Ready to roll', ...mounted]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    for (const title of absent) {
      expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    }
    expect(mockDeparture).toHaveBeenCalledWith(1, expect.any(String), expect.any(String), { enabled: false });
    expect(mockChecklist).toHaveBeenCalledWith(1);
    expect(mockTransition.mock.results[0].value.mutate).not.toHaveBeenCalled();
  });

  it('lists sessions with routes and statuses', () => {
    renderPanel();
    expect(mockList).toHaveBeenCalledWith(7, '');
    expect(screen.getByText('Tahoe ski trip')).toBeInTheDocument();
    expect(screen.getByText('Home → Tahoe')).toBeInTheDocument();
    expect(screen.getAllByText('Planned').length).toBeGreaterThan(0);
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and an empty state without data', () => {
    mockList.mockReturnValue(idle({ data: undefined, isLoading: true }));
    const { unmount } = renderPanel();
    expect(screen.getByRole('status', { name: 'Loading journeys…' })).toBeInTheDocument();
    unmount();

    mockList.mockReturnValue(idle({ data: [] }));
    renderPanel();
    expect(screen.getByText(/No journeys yet/)).toBeInTheDocument();
  });

  it('creates a journey from the form', () => {
    const mutate = vi.fn();
    mockCreate.mockReturnValue({ mutate, isPending: false });
    renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan journey' })[0]);
    fireEvent.change(screen.getByLabelText(/Journey name/), {
      target: { value: 'Vegas weekend' },
    });
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'Las Vegas' },
    });
    fireEvent.click(screen.getByText('Create journey'));
    expect(mutate).toHaveBeenCalledWith(
      { vehicle_id: 7, name: 'Vegas weekend', origin_name: undefined, dest_name: 'Las Vegas' },
      expect.anything(),
    );
  });

  it('opens a session and offers only server-provided transitions', () => {
    mockDetail.mockReturnValue(idle({ data: detail }));
    renderPanel();
    fireEvent.click(screen.getAllByText('Open')[0]);
    expect(mockDetail).toHaveBeenCalledWith(1);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Abort')).toBeInTheDocument();
    expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    expect(screen.getByText(/v1 · initial/)).toBeInTheDocument();
  });

  it('fires the transition mutation with the session id and action', () => {
    const mutate = vi.fn();
    mockTransition.mockReturnValue({ mutate, isPending: false });
    mockDetail.mockReturnValue(idle({ data: detail }));
    renderPanel();
    fireEvent.click(screen.getAllByText('Open')[0]);
    fireEvent.click(screen.getByText('Start'));
    expect(mutate).toHaveBeenCalledWith({ id: 1, action: 'start' });
  });

  it('surfaces list failures with a retry path', () => {
    const refetch = vi.fn();
    mockList.mockReturnValue(idle({ error: new Error('list down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps retained sessions, plan versions and server transitions during refresh failures', () => {
    const listRetry = vi.fn();
    const detailRetry = vi.fn();
    mockList.mockReturnValue(idle({ data: sessions, isError: true, error: new Error('list refresh failed'), refetch: listRetry }));
    mockDetail.mockReturnValue(idle({ data: detail, isError: true, error: new Error('detail refresh failed'), refetch: detailRetry }));
    const { rerenderVehicle } = renderPanel();

    expect(screen.getByText('Home → Tahoe')).toBeInTheDocument();
    expect(screen.getByText(/v1 · initial/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    fireEvent.click(retries[0]);
    expect(listRetry).toHaveBeenCalledOnce();
    expect(detailRetry).not.toHaveBeenCalled();
    fireEvent.click(retries[1]);
    expect(detailRetry).toHaveBeenCalledOnce();

    mockList.mockReturnValue(idle({ data: sessions }));
    rerenderVehicle(7);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(screen.getByText(/v1 · initial/)).toBeInTheDocument();

    mockDetail.mockReturnValue(idle({ data: detail }));
    rerenderVehicle(7);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it.each(['idle', 'fetching'] as const)('does not report unresolved %s list data as empty', (fetchStatus) => {
    mockList.mockReturnValue(idle({ isPending: true, fetchStatus, isFetching: fetchStatus === 'fetching' }));
    renderPanel();
    expect(screen.getByRole('status', { name: 'Loading journeys…' })).toBeInTheDocument();
    expect(screen.queryByText(/No journeys yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('shows paused initial list recovery without an empty result or active skeleton', () => {
    const refetch = vi.fn();
    mockList.mockReturnValue(idle({ isPending: true, fetchStatus: 'paused', refetch }));
    renderPanel();
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Refresh paused'))).toBe(true);
    expect(screen.queryByRole('status', { name: 'Loading journeys…' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No journeys yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes fetching, paused and successfully empty selected detail', () => {
    mockDetail.mockReturnValue(idle({ isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    const { rerenderVehicle } = renderPanel();
    expect(screen.getByRole('status', { name: 'Loading journey…' })).toBeInTheDocument();
    expect(screen.queryByText(/Select a journey to manage/)).not.toBeInTheDocument();

    const refetch = vi.fn();
    mockDetail.mockReturnValue(idle({ isPending: true, fetchStatus: 'paused', refetch }));
    rerenderVehicle(7);
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Refresh paused'))).toBe(true);
    expect(screen.queryByRole('status', { name: 'Loading journey…' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a journey to manage/)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    mockDetail.mockReturnValue(idle({ data: null, isSuccess: true }));
    rerenderVehicle(7);
    expect(screen.getByText(/Select a journey to manage/)).toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
  });

  it('retains paused payload and real zero values, then recovers without resetting selection', () => {
    const zeroSessions = [{ ...sessions[0], plan_version: 0 }];
    const zeroDetail = { session: zeroSessions[0], plans: [], next_statuses: [] };
    mockList.mockReturnValue(idle({ data: zeroSessions, fetchStatus: 'paused' }));
    mockDetail.mockReturnValue(idle({ data: zeroDetail, fetchStatus: 'paused' }));
    const { rerenderVehicle } = renderPanel();
    expect(screen.getAllByText('Refresh paused')).toHaveLength(2);
    expect(screen.getByText('v0')).toBeInTheDocument();
    expect(screen.getByText(/No plans saved yet/)).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    mockList.mockReturnValue(idle({ data: zeroSessions }));
    mockDetail.mockReturnValue(idle({ data: zeroDetail }));
    rerenderVehicle(7);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByText('v0')).toBeInTheDocument();
    expect(mockDetail).toHaveBeenLastCalledWith(1);
  });

  it('keeps authoritative empty list content during refresh failure and recovers', () => {
    mockList.mockReturnValue(idle({ data: [], error: new Error('refresh failed'), isError: true }));
    const { rerenderVehicle } = renderPanel();
    expect(screen.getByText(/No journeys yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    mockList.mockReturnValue(idle({ data: [], isSuccess: true }));
    rerenderVehicle(7);
    expect(screen.getByText(/No journeys yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('surfaces an initial detail failure instead of the misleading selection-empty state', () => {
    const refetch = vi.fn();
    mockDetail.mockReturnValue(idle({ isError: true, error: new Error('detail failed'), refetch }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('Select a journey to manage its lifecycle and plans.')).not.toBeInTheDocument();
  });

  it('renders when Go sends null slices on a planned journey', () => {
    mockDetail.mockReturnValue(
      idle({
        data: { session: sessions[0], plans: null, next_statuses: null },
      }),
    );
    mockNudge.mockReturnValue(
      idle({
        data: {
          session_id: 1,
          verdict: 'unknown',
          slot_at: null,
          blockers: null,
          evidence: null,
        },
      }),
    );
    mockChecklist.mockReturnValue(
      idle({
        data: {
          id: 1,
          session_id: 1,
          run_at: '2026-09-10T10:00:00Z',
          items: null,
        },
      }),
    );
    mockList.mockReturnValue(idle({ data: null }));
    const { unmount } = renderPanel();
    expect(screen.getByText(/No journeys yet/)).toBeInTheDocument();
    unmount();

    mockList.mockReturnValue(idle({ data: sessions }));
    renderPanel();
    fireEvent.click(screen.getAllByText('Open')[0]);
    expect(screen.getAllByText('Tahoe ski trip').length).toBeGreaterThan(0);
    expect(screen.getByText(/No plans saved yet/)).toBeInTheDocument();
    expect(screen.getByText('Leave now?')).toBeInTheDocument();
  });
});
