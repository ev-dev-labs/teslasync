/**
 * UptimeMonitorWidget tests.
 *
 * UptimeMonitorWidget projects the fleet's system-health payload
 * (`useSystemHealth()` → `/system/health`) into two responsive layouts. Its
 * behaviour surface — the thing under test:
 *
 *   1. Two layouts driven by `size.cols`:
 *        - compact  (cols <= 1): a title-less shell with the Overall badge + a
 *          single "healthy / total" count (role="img" with an accessible
 *          "services healthy" label). The widget's registered minSize is 1×2, so
 *          this branch MUST be reachable at one column (the hardened bug: the
 *          previous `cols === 1 && rows === 1` guard was unreachable and a
 *          1-wide widget wrongly rendered the full per-service list).
 *        - standard (cols >= 2): a titled shell with the Overall badge + a row
 *          per service; a tall (rows >= 2) standard widget also shows the DB
 *          size / table-count detail strip.
 *   2. `classifyStatus` — the backend-contract status → visual kind mapping:
 *        - 'healthy'/'ok'                          → success (OK badge, green dot)
 *        - 'degraded'/'warning'                    → warning (Degraded, amber)
 *          ('warning' → warning is the hardened bug: the old statusVariant
 *          collapsed it to danger and leaked the raw status string.)
 *        - 'unhealthy'/'offline'/'down'/'failed'   → danger (Down, red)
 *        - 'unknown'                               → unknown (Unknown, gray)
 *   3. Consecutive-failure + last-error surfacing: a service with failures > 0
 *      renders an accessible "N consecutive failures" indicator and hangs the
 *      `lastError` off the row's title (previously computed but never shown).
 *   4. The four query states every data source must handle: loading (skeleton),
 *      initial error (full-panel QueryError — only when there is no cached
 *      payload), empty (EmptyState — never a blank panel), and data.
 *   5. Null-safety: a partial `{}` payload degrades to per-service defaults and
 *      em-dash detail values without throwing.
 *   6. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *   7. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached status — the widget keeps
 *      rendering and surfaces the failure through the freshness indicator's
 *      error dot instead of the full-panel QueryError.
 *
 * `@/api/hooks/useAdmin` is mocked so the network is never touched and every
 * query state is driven deterministically. `react-i18next` is stubbed with a
 * passthrough `t(key, default)` so assertions read the English defaults. The
 * shared WidgetShell / DataFreshness / Badge / EmptyState primitives all run for
 * real, so the assertions exercise the true rendered DOM. `<MemoryRouter>` wraps
 * every render because the error branch's <QueryError> reaches for react-router.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SystemHealth, SystemHealthComponent } from '@/types/admin';
import UptimeMonitorWidget from './UptimeMonitorWidget';

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

const { useSystemHealthMock } = vi.hoisted(() => ({
  useSystemHealthMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: () => useSystemHealthMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeComponent(overrides: Partial<SystemHealthComponent> = {}): SystemHealthComponent {
  return {
    status: 'healthy',
    consecutiveFailures: 0,
    lastError: null,
    details: {},
    ...overrides,
  };
}

function makeHealth(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    status: 'healthy',
    components: {
      database: makeComponent(),
      mqtt: makeComponent(),
      tesla_api: makeComponent(),
      fleet_telemetry: makeComponent(),
    },
    databaseSize: '128 MB',
    tableCount: 42,
    ...overrides,
  };
}

interface QueryState {
  data: SystemHealth | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<QueryState> = {}): QueryState {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: { cols: number; rows: number } = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <UptimeMonitorWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Always provide a valid default so a test that forgets to seed the hook
  // still renders rather than crashing on a destructure of `undefined`.
  useSystemHealthMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('UptimeMonitorWidget — standard layout', () => {
  it('renders the titled shell, the Overall "All OK" badge, and a row per service', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ data: makeHealth() }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Uptime Monitor')).toBeInTheDocument();
    expect(screen.getByText('Overall')).toBeInTheDocument();
    expect(screen.getByText('All OK')).toBeInTheDocument();
    // Service labels derive from the key when the i18n default falls through.
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Mqtt')).toBeInTheDocument();
    expect(screen.getByText('Tesla Api')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument();
    // All four services healthy → four "OK" status badges.
    expect(screen.getAllByText('OK')).toHaveLength(4);
  });

  it('shows the DB size / table-count detail strip for a tall standard widget', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({ data: makeHealth({ databaseSize: '512 MB', tableCount: 87 }) }),
    );

    renderWidget({ cols: 2, rows: 3 });

    expect(screen.getByText('DB Size')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('renders a zero table-count as "0" (not an em dash) but blanks an empty DB size', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({ data: makeHealth({ databaseSize: '', tableCount: 0 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // `tableCount ?? '—'` keeps a legitimate 0; `databaseSize || '—'` replaces ''.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget — status classification', () => {
  it('maps a "degraded" service to a Degraded badge + amber dot', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: makeComponent({ status: 'degraded' }),
            mqtt: makeComponent(),
            tesla_api: makeComponent(),
            fleet_telemetry: makeComponent(),
          },
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Degraded')).toBeInTheDocument();
    // Fresh (not stale) so the only amber dot is the degraded service dot.
    expect(container.querySelector('.bg-amber-400')).toBeTruthy();
  });

  it('maps a "warning" service to Degraded (not danger) and never leaks the raw status (regression)', () => {
    // Pre-fix, statusVariant collapsed 'warning' to 'danger' and the badge
    // rendered the raw "warning" string. The classifyStatus contract now routes
    // 'warning' to the recoverable/warning kind.
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: makeComponent({ status: 'warning' }),
            mqtt: makeComponent(),
            tesla_api: makeComponent(),
            fleet_telemetry: makeComponent(),
          },
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Down')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-amber-400')).toBeTruthy();
  });

  it('collapses the whole broken family (unhealthy/offline/down/failed) to a single "Down" label', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: makeComponent({ status: 'unhealthy' }),
            mqtt: makeComponent({ status: 'offline' }),
            tesla_api: makeComponent({ status: 'down' }),
            fleet_telemetry: makeComponent({ status: 'failed' }),
          },
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Four broken services, overall still "All OK" → exactly four "Down" badges.
    expect(screen.getAllByText('Down')).toHaveLength(4);
    // None of the raw backend status strings leak into the DOM.
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-500')).toBeTruthy();
  });

  it('maps an "unknown" service to a neutral Unknown badge + gray dot', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: makeComponent({ status: 'unknown' }),
            mqtt: makeComponent(),
            tesla_api: makeComponent(),
            fleet_telemetry: makeComponent(),
          },
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.querySelector('.bg-gray-400')).toBeTruthy();
  });
});

describe('UptimeMonitorWidget — overall status badge', () => {
  it('translates a degraded overall status to "Degraded"', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ data: makeHealth({ status: 'degraded' }) }));

    renderWidget({ cols: 2, rows: 2 });

    // Services are healthy → the only non-"OK" badge is the overall one.
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('All OK')).not.toBeInTheDocument();
  });

  it('translates an unhealthy overall status to "Down"', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ data: makeHealth({ status: 'unhealthy' }) }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.queryByText('unhealthy')).not.toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget — failure + last-error surfacing', () => {
  it('surfaces consecutive failures as an accessible indicator and hangs lastError off the row title', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'degraded',
          components: {
            database: makeComponent({
              status: 'degraded',
              consecutiveFailures: 3,
              lastError: 'connection refused',
            }),
            mqtt: makeComponent(),
            tesla_api: makeComponent(),
            fleet_telemetry: makeComponent(),
          },
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // The failure count is exposed to assistive tech, not just as a "×3" glyph.
    expect(screen.getByRole('img', { name: '3 consecutive failures' })).toBeInTheDocument();
    // lastError is reachable as the row's native tooltip.
    const row = screen.getByText('Database').closest('[title]');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('title', 'connection refused');
  });

  it('omits the failure indicator for a healthy service with zero failures', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ data: makeHealth() }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.queryByRole('img', { name: /consecutive failures/i })).not.toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget — compact layout', () => {
  it('renders the healthy/total count at the widget minSize (1×2) instead of the full list', () => {
    // Regression guard for the unreachable-compact bug: minSize is 1×2, so a
    // one-column placement MUST hit the compact branch.
    useSystemHealthMock.mockReturnValue(makeQuery({ data: makeHealth() }));

    renderWidget({ cols: 1, rows: 2 });

    // Compact drops the title and the per-service rows …
    expect(screen.queryByText('Uptime Monitor')).not.toBeInTheDocument();
    expect(screen.queryByText('Database')).not.toBeInTheDocument();
    // … and shows the accessible count + the Overall badge.
    expect(screen.getByText('4/4')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4/4 services healthy' })).toBeInTheDocument();
    expect(screen.getByText('All OK')).toBeInTheDocument();
    // The tall detail strip is suppressed in compact mode.
    expect(screen.queryByText('DB Size')).not.toBeInTheDocument();
  });

  it('reflects the number of healthy services in the compact count', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: makeComponent({ status: 'degraded' }),
            mqtt: makeComponent(),
            tesla_api: makeComponent(),
            fleet_telemetry: makeComponent(),
          },
        }),
      }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '3/4 services healthy' })).toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget — query states', () => {
  it('renders a skeleton while loading, with no title or content', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Uptime Monitor')).not.toBeInTheDocument();
    expect(screen.queryByText('No system health data')).not.toBeInTheDocument();
  });

  it('renders the full-panel QueryError on an initial load failure (no cached data)', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Uptime Monitor')).not.toBeInTheDocument();
    expect(screen.queryByText('Overall')).not.toBeInTheDocument();
  });

  it('renders the EmptyState placeholder (never a blank panel) when data is absent', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('Uptime Monitor')).toBeInTheDocument();
    expect(screen.getByText('No system health data')).toBeInTheDocument();
    expect(screen.queryByText('Overall')).not.toBeInTheDocument();
  });

  it('degrades a partial {} payload to per-service defaults without throwing (null-safety)', () => {
    useSystemHealthMock.mockReturnValue(makeQuery({ data: {} as SystemHealth }));

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Uptime Monitor')).toBeInTheDocument();
    // Missing components default to danger → four "Down" badges; the missing
    // overall status resolves to the neutral "Unknown".
    expect(screen.getAllByText('Down')).toHaveLength(4);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});

describe('UptimeMonitorWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useSystemHealthMock.mockReturnValue(
      makeQuery({ data: makeHealth(), isFetching: false, refetch }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useSystemHealthMock.mockReturnValue(
      makeQuery({ data: makeHealth(), isFetching: true, refetch }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('UptimeMonitorWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached status and flags the freshness dot instead of blanking out', () => {
    useSystemHealthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({ status: 'healthy' }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Content is still on screen …
    expect(screen.getByText('Uptime Monitor')).toBeInTheDocument();
    expect(screen.getByText('All OK')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
