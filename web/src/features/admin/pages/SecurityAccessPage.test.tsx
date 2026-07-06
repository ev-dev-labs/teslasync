/**
 * SecurityAccessPage — behaviour + regression tests.
 *
 * The page is a pure orchestrator: it fans a selected vehicle out into a
 * polled `/security/latest` query + a `/security` history query, derives the
 * page-level `isSecure` posture / range-filtered history / digital-twin
 * view-model, and hands those down to nine presentational panels (each with
 * its own loading/error/empty state and tested separately).
 *
 * These tests isolate the ORCHESTRATION seam: the nine panels + the two
 * action controls (VehicleSelect / RangePicker) + PageContainer + FadeIn are
 * stubbed so every derived prop the page computes is observable, while the
 * real helpers (`isSecure`, `buildTwinStateFromAdmin`, the client-side range
 * filter), the real `AlertBanner`, and the real TanStack Query wiring for the
 * inline latest query all execute.
 *
 * Coverage:
 *   1. Happy/secure path — every section renders, the summary reports the
 *      filtered event count + a "secure" posture, no warning banner shows,
 *      the twin receives the vehicle id + derived twin-state, and the latest
 *      query hits the snake_case `/security/latest?vehicle_id=` URL (NO
 *      `/api/v1` prefix) with an AbortSignal.
 *   2. Insecure latest → the contextual warning banner appears and the
 *      summary flips to "unsecure".
 *   3. A fleet-list load failure surfaces the top-of-page danger banner.
 *   4. No selected vehicle → the latest query is DISABLED (request never
 *      fires) and the panels honestly show "no data".
 *   5+6. The client-side range filter narrows / widens the history handed to
 *      the summary + tables.
 *   7. Loading fans out to the summary + panels.
 *   8. Errors fan out, and retry is wired to the CORRECT refetch (latest vs
 *      history).
 *   9. RangePicker reflects the active range and forwards changes to
 *      `setRange`; VehicleSelect renders in the actions row; the page title
 *      is registered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SecurityEvent } from '@/types/admin';

/* ------------------------------------------------------------------ */
/*  Props observed by the stubbed panels (serialized into the DOM).    */
/* ------------------------------------------------------------------ */
interface StubProps {
  isSecure?: boolean;
  lastLockChange?: string;
  sentryUptime?: number;
  totalEvents?: number;
  isLoading?: boolean;
  latest?: SecurityEvent;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  twinState?: { locked?: boolean | null; sentryMode?: boolean | null };
  vehicleId?: number;
  hasData?: boolean;
  sentryBuckets?: unknown[];
  securityStats?: { total?: number } | null;
  history?: unknown[];
  timelineEvents?: unknown[];
}

/* ── i18n: return the English fallback, interpolating {{vars}}. ────── */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const interpolate = (tpl: string, vars?: Record<string, unknown>) => {
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      };
      if (typeof second === 'string') {
        return interpolate(
          second,
          third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
        );
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

/* ── PageContainer: faithful, lightweight shell (title/subtitle/actions). */
vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      <div data-testid="page-actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

/* ── FadeIn: passthrough (strips the framer-motion dependency). ────── */
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

/* ── Action controls: observable stubs. ───────────────────────────── */
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: (p: {
    value?: { start: string; end: string };
    onChange?: (r: { start: string; end: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="range-picker"
      data-start={p.value?.start}
      data-end={p.value?.end}
      onClick={() => p.onChange?.({ start: '2020-02-01', end: '2020-02-28' })}
    >
      range
    </button>
  ),
}));

/* ── The nine presentational panels: serialize the derived props. ─── */
vi.mock('../components/security-access', () => ({
  SummaryStatsRow: (p: StubProps) => (
    <div
      data-testid="sum-row"
      data-secure={String(p.isSecure)}
      data-total={String(p.totalEvents)}
      data-uptime={String(p.sentryUptime)}
      data-loading={String(p.isLoading)}
    />
  ),
  DigitalTwinPanel: (p: StubProps) => (
    <div
      data-testid="twin"
      data-hasdata={String(p.hasData)}
      data-vehicleid={String(p.vehicleId)}
      data-locked={String(p.twinState?.locked)}
      data-sentry={String(p.twinState?.sentryMode)}
      data-loading={String(p.isLoading)}
      data-haserror={String(!!p.error)}
    >
      <button type="button" data-testid="twin-retry" onClick={() => p.onRetry?.()}>
        retry
      </button>
    </div>
  ),
  SecurityStatusCards: (p: StubProps) => (
    <div
      data-testid="status-cards"
      data-haslatest={String(!!p.latest)}
      data-loading={String(p.isLoading)}
      data-haserror={String(!!p.error)}
    />
  ),
  LiveVehicleState: (p: StubProps) => (
    <div data-testid="live-state" data-haslatest={String(!!p.latest)} data-loading={String(p.isLoading)} />
  ),
  WindowStatusDetail: (p: StubProps) => (
    <div data-testid="window-detail" data-haslatest={String(!!p.latest)} data-loading={String(p.isLoading)} />
  ),
  SentryModeChart: (p: StubProps) => (
    <div
      data-testid="sentry-chart"
      data-buckets={String(p.sentryBuckets?.length ?? 0)}
      data-loading={String(p.isLoading)}
      data-haserror={String(!!p.error)}
    />
  ),
  SecurityStatistics: (p: StubProps) => (
    <div
      data-testid="security-stats"
      data-total={String(p.securityStats?.total ?? 0)}
      data-uptime={String(p.sentryUptime)}
    />
  ),
  EventHistoryTable: (p: StubProps) => (
    <div data-testid="history-table" data-count={String(p.history?.length ?? 0)} data-haserror={String(!!p.error)}>
      <button type="button" data-testid="history-retry" onClick={() => p.onRetry?.()}>
        retry
      </button>
    </div>
  ),
  EventTimeline: (p: StubProps) => (
    <div data-testid="timeline" data-count={String(p.timelineEvents?.length ?? 0)} data-haserror={String(!!p.error)} />
  ),
}));

/* ── Hooks the page reads directly (deterministic control). ───────── */
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useAdmin', () => ({ useSecurityEvents: vi.fn() }));

/* ── API client: keep everything real except `request`. ───────────── */
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSecurityEvents } from '@/api/hooks/useAdmin';
import SecurityAccessPage from './SecurityAccessPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockedUsePageTitle = vi.mocked(usePageTitle);
const mockedUseSelectedVehicle = vi.mocked(useSelectedVehicle);
const mockedUseRangeState = vi.mocked(useRangeState);
const mockedUseVehicles = vi.mocked(useVehicles);
const mockedUseSecurityEvents = vi.mocked(useSecurityEvents);

/* ------------------------------------------------------------------ */
/*  Fixtures + control helpers                                         */
/* ------------------------------------------------------------------ */

/** A fully-secure security event: locked, doors closed, all windows closed. */
function makeLatest(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 's1',
    locked: true,
    sentryMode: 'SentryModeStateArmed',
    doorState: 'Closed',
    fdWindow: 'Closed',
    fpWindow: 'Closed',
    rdWindow: 'Closed',
    rpWindow: 'Closed',
    homelinkNearby: false,
    guestMode: false,
    homelinkDeviceCount: null,
    guestModeMobileAccessState: null,
    driverSeatOccupied: null,
    centerDisplay: null,
    speedLimitMode: null,
    valetModeEnabled: null,
    serviceMode: null,
    pairedPhoneKeyCount: null,
    lightsHazardsActive: null,
    lightsHighBeams: null,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: '2020-01-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(id: string, createdAt: string, overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return makeLatest({ id, createdAt, ...overrides });
}

function setVehicle(vehicleId: number | null) {
  mockedUseSelectedVehicle.mockReturnValue({
    vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  });
}

let setRangeSpy: ReturnType<typeof vi.fn>;
function setRange(start: string, end: string) {
  mockedUseRangeState.mockReturnValue({
    start,
    end,
    setRange: setRangeSpy,
  } as unknown as ReturnType<typeof useRangeState>);
}

function setVehiclesError(error: unknown) {
  mockedUseVehicles.mockReturnValue({ error } as unknown as ReturnType<typeof useVehicles>);
}

function setHistory(opts: {
  data?: SecurityEvent[];
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => void;
}) {
  mockedUseSecurityEvents.mockReturnValue({
    data: opts.data ?? [],
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
    refetch: opts.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useSecurityEvents>);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SecurityAccessPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setRangeSpy = vi.fn();
  setVehicle(1);
  setRange('2015-01-01', '2035-01-01'); // wide by default
  setVehiclesError(null);
  setHistory({ data: [] });
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(makeLatest());
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('SecurityAccessPage — secure happy path', () => {
  it('renders every section, a secure summary, and queries the snake_case latest URL with an abort signal', async () => {
    setHistory({
      data: [makeEvent('e1', '2020-01-10T00:00:00Z'), makeEvent('e2', '2020-01-12T00:00:00Z')],
    });
    mockedRequest.mockResolvedValue(makeLatest());

    renderPage();

    // Latest query resolves → twin flips to has-data.
    await waitFor(() => expect(screen.getByTestId('twin')).toHaveAttribute('data-hasdata', 'true'));

    // Page chrome + a11y landmarks (each bento section is a labelled region).
    expect(screen.getByRole('heading', { name: 'Security & Access' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Security posture' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live vehicle state' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Security analytics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Security event history' })).toBeInTheDocument();

    // Every panel mounted.
    for (const id of [
      'sum-row',
      'twin',
      'status-cards',
      'live-state',
      'window-detail',
      'sentry-chart',
      'security-stats',
      'history-table',
      'timeline',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    // Summary reports the (filtered) event count + secure posture.
    expect(screen.getByTestId('sum-row')).toHaveAttribute('data-total', '2');
    expect(screen.getByTestId('sum-row')).toHaveAttribute('data-secure', 'true');

    // No insecure warning on a secure vehicle.
    expect(screen.queryByText('Vehicle may not be secure')).toBeNull();

    // Twin gets the numeric vehicle id + the derived (locked / armed) state.
    expect(screen.getByTestId('twin')).toHaveAttribute('data-vehicleid', '1');
    expect(screen.getByTestId('twin')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByTestId('twin')).toHaveAttribute('data-sentry', 'true');

    // URL contract: snake_case param, NO double /api/v1 prefix, real AbortSignal.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/security/latest?vehicle_id=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const calledUrl = mockedRequest.mock.calls[0][0] as string;
    expect(calledUrl).toContain('vehicle_id=1');
    expect(calledUrl).not.toContain('/api/v1');

    // Document title registered.
    expect(mockedUsePageTitle).toHaveBeenCalledWith('Security & Access');
  });
});

describe('SecurityAccessPage — insecure posture', () => {
  it('shows the contextual warning banner and flips the summary to unsecure when the vehicle is unlocked', async () => {
    // Unlocked, but everything else closed → isSecure === false.
    mockedRequest.mockResolvedValue(makeLatest({ locked: false }));
    setHistory({ data: [makeEvent('e1', '2020-01-10T00:00:00Z')] });

    renderPage();

    expect(await screen.findByText('Vehicle may not be secure')).toBeInTheDocument();
    expect(screen.getByText('Check lock, door, and window status.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('sum-row')).toHaveAttribute('data-secure', 'false'));
    expect(screen.getByTestId('twin')).toHaveAttribute('data-locked', 'false');
  });

  it('keeps a door-open (but locked) vehicle flagged as unsecure', async () => {
    mockedRequest.mockResolvedValue(makeLatest({ locked: true, doorState: 'DriverFrontOpen' }));

    renderPage();

    expect(await screen.findByText('Vehicle may not be secure')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('sum-row')).toHaveAttribute('data-secure', 'false'));
  });
});

describe('SecurityAccessPage — fleet-list failure', () => {
  it('surfaces the top-of-page danger banner when useVehicles errors', async () => {
    setVehiclesError(new Error('network down'));

    renderPage();

    // The banner interpolates the fallback label + the normalised error message.
    expect(await screen.findByText(/Failed to load data:\s*network down/)).toBeInTheDocument();
    // It does not swallow the rest of the page.
    expect(screen.getByTestId('sum-row')).toBeInTheDocument();
  });
});

describe('SecurityAccessPage — no vehicle selected', () => {
  it('disables the latest query and reports "no data" without a warning banner', async () => {
    setVehicle(null);

    renderPage();

    await screen.findByTestId('twin');

    // enabled:!!activeId is false → the query function never runs.
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId('twin')).toHaveAttribute('data-hasdata', 'false');
    expect(screen.getByTestId('status-cards')).toHaveAttribute('data-haslatest', 'false');
    // No latest → isSecure defaults to true → no false-positive warning.
    expect(screen.queryByText('Vehicle may not be secure')).toBeNull();
  });
});

describe('SecurityAccessPage — client-side range filter', () => {
  const events = [
    makeEvent('e1', '2020-01-05T00:00:00Z'),
    makeEvent('e2', '2020-02-10T00:00:00Z'),
    makeEvent('e3', '2020-03-20T00:00:00Z'),
  ];

  it('narrows the history handed to the summary + table to the selected window', async () => {
    setHistory({ data: events });
    setRange('2020-02-01', '2020-02-28'); // only e2 falls inside

    renderPage();

    await screen.findByTestId('sum-row');
    expect(screen.getByTestId('sum-row')).toHaveAttribute('data-total', '1');
    expect(screen.getByTestId('history-table')).toHaveAttribute('data-count', '1');
  });

  it('passes the whole history through when the window spans every event', async () => {
    setHistory({ data: events });
    setRange('2019-01-01', '2021-01-01');

    renderPage();

    await screen.findByTestId('sum-row');
    expect(screen.getByTestId('sum-row')).toHaveAttribute('data-total', '3');
    expect(screen.getByTestId('history-table')).toHaveAttribute('data-count', '3');
  });
});

describe('SecurityAccessPage — loading state', () => {
  it('fans the loading flag out to the summary and the live panels', async () => {
    setHistory({ data: [], isLoading: true });
    mockedRequest.mockReturnValue(new Promise<SecurityEvent>(() => undefined)); // never settles

    renderPage();

    await screen.findByTestId('sum-row');
    expect(screen.getByTestId('sum-row')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('status-cards')).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('live-state')).toHaveAttribute('data-loading', 'true');
  });
});

describe('SecurityAccessPage — error + retry wiring', () => {
  it('routes retry to the correct refetch: history panels → history, live panels → latest', async () => {
    const historyRefetch = vi.fn();
    setHistory({ data: [], error: new Error('hist boom'), refetch: historyRefetch });
    mockedRequest.mockRejectedValue(new Error('latest boom'));

    renderPage();

    // History error fans out to the history-driven panels.
    await waitFor(() => expect(screen.getByTestId('history-table')).toHaveAttribute('data-haserror', 'true'));
    expect(screen.getByTestId('sentry-chart')).toHaveAttribute('data-haserror', 'true');
    expect(screen.getByTestId('timeline')).toHaveAttribute('data-haserror', 'true');

    // Retrying a history panel calls the history refetch — NOT the latest query.
    fireEvent.click(screen.getByTestId('history-retry'));
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    // The latest query errored → twin shows the error and its retry refetches it.
    await waitFor(() => expect(screen.getByTestId('twin')).toHaveAttribute('data-haserror', 'true'));
    const callsBefore = mockedRequest.mock.calls.length;
    fireEvent.click(screen.getByTestId('twin-retry'));
    await waitFor(() => expect(mockedRequest.mock.calls.length).toBeGreaterThan(callsBefore));
    // The history refetch was not touched by the latest retry.
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('SecurityAccessPage — action controls', () => {
  it('reflects the active range in RangePicker, forwards changes to setRange, and renders VehicleSelect', async () => {
    setRange('2021-05-01', '2021-05-31');

    renderPage();

    const picker = await screen.findByTestId('range-picker');
    expect(picker).toHaveAttribute('data-start', '2021-05-01');
    expect(picker).toHaveAttribute('data-end', '2021-05-31');
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();

    fireEvent.click(picker);
    expect(setRangeSpy).toHaveBeenCalledWith({ start: '2020-02-01', end: '2020-02-28' });
  });
});
