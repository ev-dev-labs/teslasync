/**
 * AlertsListPage — behaviour + hardening tests.
 *
 * AlertsListPage is a data-dense list shell: it reads the alert feed
 * (`useAlerts`), the rule registry (`useAlertRules`), pinned rules
 * (`usePinned`) and an on-demand audit timeline (`useAlertDetail`), then
 * derives KPI counts, a 7-day severity trend, a type distribution, filter
 * tabs, a debounced search + paginated list, and acknowledge / reopen /
 * mark-read / open-detail actions.
 *
 * The data hooks are mocked at the hook boundary so every orchestration
 * branch — loading, error, empty, and the fully-populated happy path — is
 * exercised deterministically. `AlertCard` is stubbed with a prop-capturing
 * marker so interaction assertions target THE PAGE'S own wiring (which
 * mutation fires, with what argument) rather than card presentation, and the
 * ack dialog / timeline are stubbed to keep the action flows focused. Network
 * never touches the real backend — `@/api/client`'s `request` seam is
 * neutralised so peripheral queries (SavedViewMenu, RangePicker) stay
 * benignly pending.
 *
 * The two exported pure helpers (`loadQuietHours`, `isQuietHoursActive`) are
 * unit-tested directly, including the regression for the corrupted-payload
 * crash: a literal `"null"` in localStorage previously leaked through as
 * `null` and crashed `isQuietHoursActive`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (
        opts && typeof opts === 'object'
          ? opts
          : fb && typeof fb === 'object'
            ? fb
            : undefined
      ) as Record<string, unknown> | undefined;
      let base: string;
      if (typeof fb === 'string') base = fb;
      else if (fb && typeof fb === 'object' && typeof (fb as { defaultValue?: unknown }).defaultValue === 'string')
        base = (fb as { defaultValue: string }).defaultValue;
      else base = key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Network kill-switch: neutralise the shared fetch seam so any peripheral query
// (SavedViewMenu's saved views) stays benignly pending instead of hitting the
// real backend.
vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn(() => new Promise(() => {})) };
});

// Shared mutation spies, hoisted so the useNotifications mock factory can close
// over them (vi.mock is hoisted above module init).
const mutations = vi.hoisted(() => ({
  markRead: vi.fn(),
  bulkSetRead: vi.fn(),
  ack: vi.fn(),
  reopen: vi.fn(),
}));
const selectedVehicle = vi.hoisted(() => ({
  vehicleId: null as number | null,
  vehicle: null as { display_name: string; vin: string } | null,
}));
const bulkReadState = vi.hoisted(() => ({
  isPending: false,
}));
const markReadState = vi.hoisted(() => ({
  isPending: false,
}));
const lifecycleMutationState = vi.hoisted(() => ({
  acknowledgePending: false,
  reopenPending: false,
}));

vi.mock('@/api/hooks/useNotifications', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useNotifications')>();
  return {
    ...actual,
    useAlerts: vi.fn(),
    useAlertRules: vi.fn(),
    useAlertDetail: vi.fn(),
    useMarkAlertRead: () => ({
      mutate: mutations.markRead,
      isPending: markReadState.isPending,
    }),
    useBulkSetAlertsRead: () => ({
      mutate: mutations.bulkSetRead,
      mutateAsync: mutations.bulkSetRead,
      isPending: bulkReadState.isPending,
    }),
    useAcknowledgeAlert: () => ({
      mutate: mutations.ack,
      isPending: lifecycleMutationState.acknowledgePending,
    }),
    useReopenAlert: () => ({
      mutate: mutations.reopen,
      isPending: lifecycleMutationState.reopenPending,
    }),
  };
});

vi.mock('@/api/hooks/usePinned', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/usePinned')>();
  return { ...actual, usePinned: () => ({ data: [] }) };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    ...selectedVehicle,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// Prop-capturing stub for each alert row. Renders the title plus four
// aria-labelled buttons so interaction tests can drive the page's real
// callbacks without depending on AlertCard's presentation.
vi.mock('../components/AlertCard', () => {
  const AlertCard = ({
    alert,
    onMarkRead,
    onAcknowledge,
    onReopen,
    onOpenDetail,
    selected,
    onToggleSelect,
  }: {
    alert: { id: number; title: string };
    onMarkRead: () => void;
    onAcknowledge: () => void;
    onReopen: () => void;
    onOpenDetail: () => void;
    selected?: boolean;
    onToggleSelect?: (selected: boolean) => void;
  }) => (
    <div data-testid={`alert-card-${alert.id}`}>
      <span>{alert.title}</span>
      <button
        type="button"
        aria-label={`select-${alert.id}`}
        aria-pressed={selected}
        onClick={() => onToggleSelect?.(!selected)}
      >
        select
      </button>
      <button type="button" aria-label={`mark-read-${alert.id}`} onClick={onMarkRead}>mr</button>
      <button type="button" aria-label={`ack-${alert.id}`} onClick={onAcknowledge}>ack</button>
      <button type="button" aria-label={`reopen-${alert.id}`} onClick={onReopen}>reopen</button>
      <button type="button" aria-label={`detail-${alert.id}`} onClick={onOpenDetail}>detail</button>
    </div>
  );
  return { AlertCard, default: AlertCard };
});

// Stub the acknowledge dialog to a minimal, controllable surface so the
// acknowledge flow test asserts the page's submit wiring, not the dialog UI.
vi.mock('@/features/admin/components/AcknowledgeAlertDialog', () => ({
  AcknowledgeAlertDialog: ({ open, onSubmit, onClose, alertTitle }: {
    open: boolean;
    onSubmit: (note: string) => void;
    onClose: () => void;
    alertTitle?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="acknowledge-alert">
        <p>{alertTitle}</p>
        <button type="button" onClick={() => onSubmit('looks handled')}>confirm-ack</button>
        <button type="button" onClick={onClose}>cancel-ack</button>
      </div>
    ) : null,
}));

vi.mock('@/features/admin/components/AlertDetailTimeline', () => ({
  AlertDetailTimeline: ({ events }: { events?: unknown[] }) => (
    <div data-testid="alert-timeline">{`${events?.length ?? 0} events`}</div>
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { ToastProvider } from '@/components/feedback/Toast';
import AlertsListPage, { loadQuietHours, isQuietHoursActive } from './AlertsListPage';
import { useAlerts, useAlertRules, useAlertDetail } from '@/api/hooks/useNotifications';
import type { Alert, AlertRule } from '@/api/types';

const mockAlerts = vi.mocked(useAlerts);
const mockRules = vi.mocked(useAlertRules);
const mockDetail = vi.mocked(useAlertDetail);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

// Two hours ago: safely inside the "all time" range window AND the trailing
// 7-day trend window, regardless of the wall-clock time the suite runs at.
const RECENT = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const ALERTS: Alert[] = [
  { id: 1, vehicle_id: 1, type: 'battery_low', severity: 'critical', title: 'Battery critically low', message: 'Pack at 2%', is_read: false, created_at: RECENT },
  {
    id: 2,
    vehicle_id: 1,
    type: 'tire_pressure_low',
    severity: 'warning',
    title: 'Tire pressure warning',
    message: 'Front-left soft',
    is_read: true,
    created_at: RECENT,
    acknowledged_at: RECENT,
    acknowledged_by: 'fleet.operator',
    rule_signal: 'TpmsPressureFl',
  },
  { id: 3, vehicle_id: 2, type: 'software_update', severity: 'info', title: 'Software update available', message: 'v2025 is ready', is_read: false, created_at: RECENT },
];

const RULES = [
  { id: 10, name: 'Speeding', enabled: true, signal_name: 'VehicleSpeed', op: '>', value_num: 120, severity: 'warn', cooldown_min: 10, trigger_mode: 'repeat', kind: 'signal' },
  { id: 11, name: 'Low battery', enabled: true, signal_name: 'Soc', op: '<', value_num: 10, severity: 'critical', cooldown_min: 30, trigger_mode: 'once', kind: 'signal' },
] as unknown as AlertRule[];

const DETAIL = { ...ALERTS[0], events: [{ id: 0, kind: 'created', created_at: RECENT }] };

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const page = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications/alerts']}>
        <ToastProvider>
          <AlertsListPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(page());
  return {
    ...result,
    rerenderPage: () => result.rerender(page()),
  };
}

beforeEach(() => {
  localStorage.clear();
  selectedVehicle.vehicleId = null;
  selectedVehicle.vehicle = null;
  bulkReadState.isPending = false;
  markReadState.isPending = false;
  lifecycleMutationState.acknowledgePending = false;
  lifecycleMutationState.reopenPending = false;
  mutations.markRead.mockClear();
  mutations.bulkSetRead.mockReset();
  mutations.bulkSetRead.mockResolvedValue({ updated: 1 });
  mutations.ack.mockClear();
  mutations.reopen.mockClear();
  mockAlerts.mockReturnValue(qr({ data: ALERTS }));
  mockRules.mockReturnValue(qr({ data: RULES }));
  mockDetail.mockReturnValue(qr({ data: undefined }));
});

describe('loadQuietHours', () => {
  it('returns the default window when nothing is stored', () => {
    expect(loadQuietHours()).toEqual({ start: '22:00', end: '07:00', enabled: false });
  });

  it('parses a valid stored payload', () => {
    localStorage.setItem(
      'teslasync-quiet-hours',
      JSON.stringify({ start: '08:00', end: '20:00', enabled: true }),
    );
    expect(loadQuietHours()).toEqual({ start: '08:00', end: '20:00', enabled: true });
  });

  it('falls back to the default (never null) for a literal "null" payload — regression', () => {
    localStorage.setItem('teslasync-quiet-hours', 'null');
    const qh = loadQuietHours();
    expect(qh).toEqual({ start: '22:00', end: '07:00', enabled: false });
    // Pre-fix, loadQuietHours returned `null` here, crashing isQuietHoursActive.
    expect(() => isQuietHoursActive(qh)).not.toThrow();
    expect(isQuietHoursActive(qh)).toBe(false);
  });

  it('falls back to the default for malformed JSON', () => {
    localStorage.setItem('teslasync-quiet-hours', '{not valid json');
    expect(loadQuietHours()).toEqual({ start: '22:00', end: '07:00', enabled: false });
  });

  it('coerces a partial object, ignoring a non-boolean enabled', () => {
    localStorage.setItem('teslasync-quiet-hours', JSON.stringify({ enabled: 'yes' }));
    expect(loadQuietHours()).toEqual({ start: '22:00', end: '07:00', enabled: false });
  });
});

describe('isQuietHoursActive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when disabled or given a nullish argument', () => {
    expect(isQuietHoursActive({ start: '22:00', end: '07:00', enabled: false })).toBe(false);
    expect(isQuietHoursActive(null)).toBe(false);
    expect(isQuietHoursActive(undefined)).toBe(false);
  });

  it('detects an active same-day window and excludes times outside it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 13, 30));
    expect(isQuietHoursActive({ start: '09:00', end: '17:00', enabled: true })).toBe(true);
    expect(isQuietHoursActive({ start: '14:00', end: '17:00', enabled: true })).toBe(false);
  });

  it('handles a midnight-wrapping window (start > end)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 23, 30));
    expect(isQuietHoursActive({ start: '22:00', end: '07:00', enabled: true })).toBe(true);
    vi.setSystemTime(new Date(2025, 0, 1, 12, 0));
    expect(isQuietHoursActive({ start: '22:00', end: '07:00', enabled: true })).toBe(false);
  });
});

describe('AlertsListPage — rendering branches', () => {
  it('renders the KPI overview, filter tabs, insights, and every alert row', () => {
    renderPage();

    // KPI overview labels + the derived read-rate (1 read of 3 = 33%).
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Read rate')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();

    // Filter tabs carry live counts derived from the data.
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledged (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Critical (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open critical (1)' })).toBeInTheDocument();
    expect(mockAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
        fetchAll: true,
      }),
    );

    // Every row renders (via the stub).
    expect(screen.getByTestId('alert-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-card-2')).toBeInTheDocument();
    expect(screen.getByTestId('alert-card-3')).toBeInTheDocument();

    // Insights section is a labelled landmark; type distribution lists names.
    expect(screen.getByRole('region', { name: 'Alert insights' })).toBeInTheDocument();
    expect(screen.getByText('tire pressure low')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-operational-brief')).toBeInTheDocument();
    expect(screen.getByText('Immediate triage')).toBeInTheDocument();
  });

  it('surfaces a critical callout when unacknowledged critical alerts exist', () => {
    renderPage();
    expect(screen.getByText('1 critical alert needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View critical/ })).toBeInTheDocument();
  });

  it('triages only open critical alerts and excludes acknowledged critical rows', async () => {
    mockAlerts.mockReturnValue(
      qr({
        data: [
          ...ALERTS,
          {
            ...ALERTS[0],
            id: 4,
            title: 'Acknowledged critical alert',
            acknowledged_at: RECENT,
            acknowledged_by: 'fleet.operator',
          },
        ],
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /View critical/ }));

    await waitFor(() =>
      expect(screen.queryByTestId('alert-card-4')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('alert-card-1')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-3')).not.toBeInTheDocument();
  });

  it('shows a spinner and suppresses the body while loading', () => {
    mockAlerts.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    renderPage();
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Read rate')).not.toBeInTheDocument();
  });

  it('renders the error message and no rows on a failed fetch', () => {
    mockAlerts.mockReturnValue(
      qr({ isLoading: false, isError: true, error: new Error('Failed to load alerts'), data: undefined }),
    );
    renderPage();
    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-1')).not.toBeInTheDocument();
  });

  it('renders an empty state (never a blank panel) when there are no alerts', () => {
    mockAlerts.mockReturnValue(qr({ data: [] }));
    renderPage();
    expect(screen.getAllByText('No alerts').length).toBeGreaterThan(0);
    expect(
      screen.getByText('No alerts in this range. Your fleet is running smoothly.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Alert rules continue monitoring new telemetry/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage rules' }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('alert-card-1')).not.toBeInTheDocument();
  });
});

describe('AlertsListPage — filtering', () => {
  it('narrows the list to critical alerts when the Critical tab is chosen', async () => {
    renderPage();
    expect(screen.getByTestId('alert-card-2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Critical (1)' }));

    await waitFor(() => expect(screen.queryByTestId('alert-card-2')).not.toBeInTheDocument());
    expect(screen.getByTestId('alert-card-1')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-3')).not.toBeInTheDocument();
  });

  it('filters by the debounced search box across title/message', async () => {
    renderPage();
    const input = screen.getByPlaceholderText('Search by title or message…');
    fireEvent.change(input, { target: { value: 'Tire' } });

    await waitFor(() => expect(screen.queryByTestId('alert-card-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('alert-card-2')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-3')).not.toBeInTheDocument();
  });

  it('explains an unmatched search and clears it from the empty-state action', async () => {
    renderPage();
    const input = screen.getByPlaceholderText('Search by title or message…');
    fireEvent.change(input, { target: { value: 'not-a-real-alert' } });

    expect(await screen.findByText('No alerts match your search.')).toBeInTheDocument();
    expect(screen.getByText(/Try a broader title or message search/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => expect(screen.getByTestId('alert-card-1')).toBeInTheDocument());
  });

  it('filters by acknowledgement lifecycle without conflating read state', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledged (1)' }));

    await waitFor(() => expect(screen.queryByTestId('alert-card-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('alert-card-2')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-3')).not.toBeInTheDocument();
  });

  it('inherits the global vehicle selection while retaining fleet-wide system alerts', () => {
    selectedVehicle.vehicleId = 1;
    selectedVehicle.vehicle = { display_name: 'Model Y', vin: 'VIN-1' };
    renderPage();

    expect(screen.getByTestId('alert-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-card-2')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-card-3')).not.toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument();
  });
});

describe('AlertsListPage — row actions', () => {
  it('marks a row read through the mutation with the stringified id', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'mark-read-1' }));
    expect(mutations.markRead).toHaveBeenCalledTimes(1);
    expect(mutations.markRead.mock.calls[0][0]).toBe('1');
  });

  it('reopens a row through the mutation with the numeric id', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'reopen-2' }));
    expect(mutations.reopen).toHaveBeenCalledTimes(1);
    expect(mutations.reopen).toHaveBeenCalledWith(2);
  });

  it('marks selected alerts read in bulk and offers an undo action', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'select-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    await waitFor(() =>
      expect(mutations.bulkSetRead).toHaveBeenCalledWith({
        ids: [1],
        read: true,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(mutations.bulkSetRead).toHaveBeenLastCalledWith({
      ids: [1],
      read: false,
    });
  });

  it('preserves alerts selected after an in-flight bulk request started', async () => {
    let resolveBulk: ((value: { updated: number }) => void) | undefined;
    mutations.bulkSetRead.mockReturnValueOnce(
      new Promise<{ updated: number }>((resolve) => {
        resolveBulk = resolve;
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'select-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    fireEvent.click(screen.getByRole('button', { name: 'select-3' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await act(async () => {
      resolveBulk?.({ updated: 1 });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'select-1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'select-3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('retains selection while an optimistic unread-row update is pending and after rollback', () => {
    const page = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'select-1' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    bulkReadState.isPending = true;
    mockAlerts.mockReturnValue(qr({ data: ALERTS.filter((alert) => alert.id !== 1) }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    bulkReadState.isPending = false;
    mockAlerts.mockReturnValue(qr({ data: ALERTS }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('retains selection through a failed optimistic row-level mark-read update', () => {
    const page = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'select-1' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    markReadState.isPending = true;
    mockAlerts.mockReturnValue(qr({ data: ALERTS.filter((alert) => alert.id !== 1) }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    markReadState.isPending = false;
    mockAlerts.mockReturnValue(qr({ data: ALERTS }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('retains selection while an optimistic lifecycle update is pending', () => {
    const page = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'select-1' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    lifecycleMutationState.acknowledgePending = true;
    mockAlerts.mockReturnValue(qr({ data: ALERTS.filter((alert) => alert.id !== 1) }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    lifecycleMutationState.acknowledgePending = false;
    mockAlerts.mockReturnValue(qr({ data: ALERTS }));
    page.rerenderPage();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('opens the acknowledge dialog and submits the note to the mutation', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ack-1' }));

    const dialog = await screen.findByRole('dialog', { name: 'acknowledge-alert' });
    expect(within(dialog).getByText('Battery critically low')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm-ack' }));
    expect(mutations.ack).toHaveBeenCalledTimes(1);
    expect(mutations.ack.mock.calls[0][0]).toEqual({ id: 1, note: 'looks handled' });
  });

  it('opens the audit-timeline modal and renders the detail payload', async () => {
    mockDetail.mockReturnValue(qr({ data: DETAIL }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'detail-1' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pack at 2%')).toBeInTheDocument();
    expect(within(dialog).getByTestId('alert-timeline')).toHaveTextContent('1 events');
  });
});
