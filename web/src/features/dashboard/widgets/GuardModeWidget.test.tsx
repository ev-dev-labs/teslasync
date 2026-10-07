/**
 * GuardModeWidget tests.
 *
 * The widget projects a vehicle's Guard Mode configuration (`useGuardConfig`)
 * plus its recent security event feed (`useGuardEvents`) into two responsive
 * layouts. Its behaviour surface — the thing under test:
 *
 *   1. Two layouts driven by `size.cols`:
 *        - compact (cols <= 1): an Armed/Disarmed status badge + an event-count
 *          badge (variant flips to `warning` once there are events).
 *        - standard (cols >= 2): an Armed/Disarmed status line with the
 *          sensitivity + optional auto-panic caption, an ON/OFF badge, and the
 *          scrollable event feed.
 *   2. `mapEventToFeedItem` — the event-type → visual lookup:
 *        - known types resolve to their mapped label/icon;
 *        - unknown types fall back to the neutral shield + the raw event_type
 *          as the label;
 *        - a free-form event_type that collides with an `Object.prototype`
 *          member (e.g. "hasOwnProperty") must STILL resolve to the neutral
 *          fallback — not an inherited method — so the title never degrades to
 *          the raw i18n key (the hardened bug);
 *        - the acknowledged/unacknowledged subtitle is derived from
 *          `acknowledged_at` via the real `isGuardEventAcknowledged` helper.
 *   3. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel — only when there is no cached config),
 *      empty (EmptyState — never a blank panel), and data.
 *   4. Null-safety: a present config with an absent events payload renders the
 *      feed's own empty state rather than throwing on `.map`/`.length`.
 *   5. Vehicle resolution: an explicit `vehicleId` wins, else the first vehicle;
 *      a missing vehicle falls back to id 0 (which disables the queries).
 *   6. The freshness control: clicking refetches BOTH queries, but only when a
 *      fetch is not already in flight.
 *   7. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached config — the widget keeps
 *      rendering and surfaces the failure through the freshness indicator's
 *      error dot instead of the full-panel QueryError.
 *
 * `@/api/hooks/useGuard` is partially mocked (real `isGuardEventAcknowledged`
 * kept via importOriginal; only the two query hooks are stubbed) and
 * `@/api/hooks/useVehicles` is fully mocked, so the network is never touched
 * and every query state is driven deterministically. `react-i18next` is stubbed
 * with a passthrough `t(key, default)` so assertions read the English defaults.
 * The shared WidgetShell / DataFreshness / Badge / EmptyState / WidgetEventFeed
 * primitives all run for real, so assertions exercise the true rendered DOM.
 * `<MemoryRouter>` wraps every render because the event-feed rows and the error
 * branch's <QueryError> reach for react-router.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GuardConfig, GuardEvent } from '@/api/hooks/useGuard';
import GuardModeWidget from './GuardModeWidget';

// jsdom lacks matchMedia; DataFreshness → useMotionPreference (framer-motion's
// useReducedMotion) reads it during render. Install a benign stub before any
// component mounts.
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

const { useVehiclesMock, useGuardConfigMock, useGuardEventsMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useGuardConfigMock: vi.fn(),
  useGuardEventsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

// Keep the real `isGuardEventAcknowledged` (and types / query keys) — only the
// two data hooks are stubbed so query state is deterministic.
vi.mock('@/api/hooks/useGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useGuard')>();
  return {
    ...actual,
    useGuardConfig: (vehicleId: number) => useGuardConfigMock(vehicleId),
    useGuardEvents: (vehicleId: number) => useGuardEventsMock(vehicleId),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return {
    vehicle_id: 1,
    enabled: true,
    home_geofence_id: null,
    sensitivity: 'medium',
    auto_panic: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: 1,
    vehicle_id: 1,
    ts: new Date().toISOString(),
    event_type: 'vehicle_moved',
    from_state: null,
    to_state: null,
    details: null,
    acknowledged_at: null,
    acknowledged_by: null,
    ...overrides,
  };
}

interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeConfigQuery(overrides: Partial<QueryLike<GuardConfig>> = {}): QueryLike<GuardConfig> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeEventsQuery(overrides: Partial<QueryLike<GuardEvent[]>> = {}): QueryLike<GuardEvent[]> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  return render(
    <MemoryRouter>
      <GuardModeWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useGuardConfigMock.mockReturnValue(makeConfigQuery());
  useGuardEventsMock.mockReturnValue(makeEventsQuery());
});

afterEach(() => {
  cleanup();
});

describe('GuardModeWidget — standard layout', () => {
  it('renders the armed status line, the ON badge, and the sensitivity + auto-panic caption', () => {
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({ data: makeConfig({ enabled: true, sensitivity: 'high', auto_panic: true }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Guard Mode')).toBeInTheDocument();
    expect(screen.getByText('Armed')).toBeInTheDocument();
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.getByText(/Sensitivity:\s*high/)).toBeInTheDocument();
    expect(screen.getByText(/Auto-panic/)).toBeInTheDocument();
  });

  it('renders the disarmed status line + OFF badge and omits the auto-panic caption', () => {
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({ data: makeConfig({ enabled: false, sensitivity: 'low', auto_panic: false }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Disarmed')).toBeInTheDocument();
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.getByText(/Sensitivity:\s*low/)).toBeInTheDocument();
    expect(screen.queryByText(/Auto-panic/)).not.toBeInTheDocument();
  });
});

describe('GuardModeWidget — compact layout', () => {
  it('renders the armed badge and a warning-count badge when there are events', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig({ enabled: true }) }));
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({ data: [makeEvent({ id: 1 }), makeEvent({ id: 2 }), makeEvent({ id: 3 })] }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('Armed')).toBeInTheDocument();
    expect(screen.getByText('3 events')).toBeInTheDocument();
    // Compact mode does not render the standard status caption or the feed.
    expect(screen.queryByText(/Sensitivity:/)).not.toBeInTheDocument();
  });

  it('renders the disarmed badge and a zero-count badge when there are no events', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig({ enabled: false }) }));
    useGuardEventsMock.mockReturnValue(makeEventsQuery({ data: [] }));

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('Disarmed')).toBeInTheDocument();
    expect(screen.getByText('0 events')).toBeInTheDocument();
  });
});

describe('GuardModeWidget — event feed mapping', () => {
  it('maps a known event type to its label and an unacknowledged subtitle', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig() }));
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({
        data: [makeEvent({ id: 10, event_type: 'unauthorized_unlock', acknowledged_at: null })],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Unauthorized Unlock')).toBeInTheDocument();
    expect(screen.getByText('Unacknowledged')).toBeInTheDocument();
  });

  it('marks an event acknowledged when acknowledged_at is set (real isGuardEventAcknowledged)', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig() }));
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({
        data: [
          makeEvent({ id: 11, event_type: 'sentry_triggered', acknowledged_at: '2024-05-01T12:00:00Z' }),
        ],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Sentry Triggered')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.queryByText('Unacknowledged')).not.toBeInTheDocument();
  });

  it('falls back to the raw event_type as the label for an unknown type', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig() }));
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({ data: [makeEvent({ id: 12, event_type: 'mystery_event' })] }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('mystery_event')).toBeInTheDocument();
  });

  it('resolves a prototype-colliding event_type to the neutral fallback, not an inherited method', () => {
    // Regression guard: an unguarded `EVENT_TYPE_MAP[event_type]` lookup would
    // resolve "hasOwnProperty" to `Object.prototype.hasOwnProperty` (a truthy
    // function), yielding an `undefined` label and a title that degrades to the
    // raw i18n key. The hasOwnProperty-guarded lookup must render the event_type
    // itself as the label instead.
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig() }));
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({ data: [makeEvent({ id: 13, event_type: 'hasOwnProperty' })] }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('hasOwnProperty')).toBeInTheDocument();
    expect(screen.queryByText('widget.guardEvent.hasOwnProperty')).not.toBeInTheDocument();
  });

  it('shows the feed empty state (never a blank panel) when there are no events', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig() }));
    useGuardEventsMock.mockReturnValue(makeEventsQuery({ data: [] }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Guard Mode')).toBeInTheDocument();
    expect(screen.getByText('No guard events')).toBeInTheDocument();
  });
});

describe('GuardModeWidget — query states', () => {
  it('renders a skeleton while the config query is loading, with no title or content', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Guard Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('No guard data')).not.toBeInTheDocument();
  });

  it('enters the loading state when only the events query is still loading (OR aggregation)', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig({ enabled: true }) }));
    useGuardEventsMock.mockReturnValue(makeEventsQuery({ isLoading: true }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // isLoading = configLoading || eventsLoading → the shell shows the skeleton
    // and suppresses the content even though the config payload has landed.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Armed')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial config load failure (no cached config)', () => {
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Guard Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('No guard data')).not.toBeInTheDocument();
  });

  it('renders the titled shell with the "No guard data" empty state when config is absent (no error)', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: undefined }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Guard Mode')).toBeInTheDocument();
    expect(screen.getByText('No guard data')).toBeInTheDocument();
  });

  it('degrades a present config with an absent events payload without throwing (null-safety)', () => {
    useGuardConfigMock.mockReturnValue(makeConfigQuery({ data: makeConfig({ enabled: true }) }));
    useGuardEventsMock.mockReturnValue(makeEventsQuery({ data: undefined }));

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Armed')).toBeInTheDocument();
    expect(screen.getByText('No guard events')).toBeInTheDocument();
  });
});

describe('GuardModeWidget — vehicle resolution', () => {
  it('resolves the first vehicle id when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useGuardConfigMock).toHaveBeenCalledWith(42);
    expect(useGuardEventsMock).toHaveBeenCalledWith(42);
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useGuardConfigMock).toHaveBeenCalledWith(7);
    expect(useGuardEventsMock).toHaveBeenCalledWith(7);
  });

  it('falls back to id 0 (queries disabled) when there is no vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useGuardConfigMock).toHaveBeenCalledWith(0);
    expect(useGuardEventsMock).toHaveBeenCalledWith(0);
  });
});

describe('GuardModeWidget — freshness interaction', () => {
  it('refetches BOTH the config and events queries when the refresh control is clicked', () => {
    const refetchConfig = vi.fn();
    const refetchEvents = vi.fn();
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({ data: makeConfig(), refetch: refetchConfig, isFetching: false }),
    );
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({ data: [], refetch: refetchEvents, isFetching: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetchConfig).toHaveBeenCalledTimes(1);
    expect(refetchEvents).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetchConfig = vi.fn();
    const refetchEvents = vi.fn();
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({ data: makeConfig(), refetch: refetchConfig, isFetching: true }),
    );
    useGuardEventsMock.mockReturnValue(
      makeEventsQuery({ data: [], refetch: refetchEvents, isFetching: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetchConfig).not.toHaveBeenCalled();
    expect(refetchEvents).not.toHaveBeenCalled();
  });
});

describe('GuardModeWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached config and flags the freshness dot instead of blanking out', () => {
    useGuardConfigMock.mockReturnValue(
      makeConfigQuery({
        data: makeConfig({ enabled: true, sensitivity: 'high' }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Config is still on screen …
    expect(screen.getByText('Guard Mode')).toBeInTheDocument();
    expect(screen.getByText('Armed')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
