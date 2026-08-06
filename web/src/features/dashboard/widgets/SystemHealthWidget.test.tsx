/**
 * SystemHealthWidget — behaviour + hardening coverage.
 *
 * The widget summarises the platform's health inside a WidgetShell. It fans
 * three admin hooks (`useSystemHealth`, `useDBStats`, `useConnectionPool`) into
 * a compact overall badge + label + healthy-service count at 1×N, and a
 * per-service status-dot grid + a stat grid (DB Size / Active Conns / Memory /
 * Goroutines) at 2×N. All three hooks are mocked so the network is never hit.
 *
 * It exposes a default component plus three pure helpers — `statusTier`,
 * `overallLabel`, `overallBadgeStatus`.
 *
 * Facets covered:
 *   - statusTier: the four-tier normalisation of the open-ended backend status
 *     vocabulary, including the R-fix that `warning` shares the amber
 *     `degraded` tier (NOT red) and `unknown`/unset stays neutral grey; plus
 *     case-insensitivity and null-safety (null/undefined → down).
 *   - overallLabel / overallBadgeStatus: the healthy/degraded/else branches.
 *   - standard (2×N): title, four service rows with accessible status dots
 *     (role="img" + "<service>: <status>" label), tier→colour mapping proven
 *     through the rendered className, the missing-component default, and all
 *     four stat cards with formatted values.
 *   - null-safety hardening: an empty-string databaseSize falls through to the
 *     dbStats size then to an em-dash (`||`, not `??`); absent runtime
 *     memory/goroutines render em-dashes; a zero pool max drops the "/max".
 *   - compact (1×N): overall badge + label + "healthy/total services" count,
 *     with the title + dot grid + stat grid withheld; degraded flips the tone.
 *   - empty / loading / error states (EmptyState role="status", Skeleton,
 *     QueryError role="alert").
 *   - refresh wiring: the accessible freshness control refetches system health.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string | Record<string, unknown>) =>
      typeof def === 'string' ? def : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The three admin hooks, driven per test. ──
vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: vi.fn(),
  useDBStats: vi.fn(),
  useConnectionPool: vi.fn(),
}));

import { useSystemHealth, useDBStats, useConnectionPool } from '@/api/hooks/useAdmin';
import SystemHealthWidget, {
  statusTier,
  overallLabel,
  overallBadgeStatus,
} from './SystemHealthWidget';

const mockHealth = useSystemHealth as unknown as ReturnType<typeof vi.fn>;
const mockDb = useDBStats as unknown as ReturnType<typeof vi.fn>;
const mockPool = useConnectionPool as unknown as ReturnType<typeof vi.fn>;

const t = (_k: string, def: string) => def;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function comp(status: string) {
  return { status, consecutiveFailures: 0, lastError: null, details: {} };
}

 
function makeHealth(over: Record<string, unknown> = {}): any {
  return {
    status: 'healthy',
    components: {
      database: comp('healthy'),
      mqtt: comp('healthy'),
      tesla_api: comp('healthy'),
      fleet_telemetry: comp('healthy'),
    },
    databaseSize: '2.4 GB',
    tableCount: 42,
    ...over,
  };
}

 
function makeDbStats(over: Record<string, unknown> = {}): any {
  return { tables: [], tableCount: 42, databaseSize: '2.4 GB', ...over };
}

 
function makePool(over: Record<string, unknown> = {}): any {
  return {
    maxOpen: 25,
    open: 10,
    inUse: 5,
    idle: 5,
    waitCount: 0,
    waitDurationMs: 0,
    goroutines: 87,
    memoryMB: 512,
    ...over,
  };
}

interface SetupOpts {
   
  health?: any;
   
  db?: any;
   
  pool?: any;
}

function setup(opts: SetupOpts = {}) {
  mockHealth.mockReturnValue(opts.health ?? makeQuery({ data: makeHealth() }));
  mockDb.mockReturnValue(opts.db ?? makeQuery({ data: makeDbStats() }));
  mockPool.mockReturnValue(opts.pool ?? makeQuery({ data: makePool() }));
}

const COMPACT = { cols: 1, rows: 2 };
const STANDARD = { cols: 2, rows: 4 };

function renderWidget(size: { cols: number; rows: number }) {
  return render(
    <MemoryRouter>
      <SystemHealthWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('statusTier', () => {
  it('collapses the healthy/ok family to the ok tier', () => {
    expect(statusTier('ok')).toBe('ok');
    expect(statusTier('healthy')).toBe('ok');
    expect(statusTier('HEALTHY')).toBe('ok');
  });

  it('treats degraded AND the recoverable "warning" as the same degraded tier', () => {
    // R-fix: a recoverable `warning` must not render as the alarming red
    // `down` tier — it shares amber `degraded` with an explicit `degraded`.
    expect(statusTier('degraded')).toBe('degraded');
    expect(statusTier('warning')).toBe('degraded');
    expect(statusTier('Warning')).toBe('degraded');
  });

  it('keeps unknown / unset / null neutral rather than red', () => {
    expect(statusTier('unknown')).toBe('unknown');
    expect(statusTier('')).toBe('unknown');
    // A null/undefined status carries no info → neutral, not an alarmist red.
    expect(statusTier(null)).toBe('unknown');
    expect(statusTier(undefined)).toBe('unknown');
  });

  it('maps broken states and any unrecognised value to down', () => {
    expect(statusTier('unhealthy')).toBe('down');
    expect(statusTier('offline')).toBe('down');
    expect(statusTier('failed')).toBe('down');
    expect(statusTier('gibberish')).toBe('down');
  });
});

describe('overallLabel / overallBadgeStatus', () => {
  it('labels the three overall states, defaulting unhealthy to Down', () => {
    expect(overallLabel('healthy', t)).toBe('Healthy');
    expect(overallLabel('degraded', t)).toBe('Degraded');
    expect(overallLabel('unhealthy', t)).toBe('Down');
  });

  it('maps overall status onto a StatusBadge presence tone', () => {
    expect(overallBadgeStatus('healthy')).toBe('online');
    expect(overallBadgeStatus('degraded')).toBe('away');
    expect(overallBadgeStatus('unhealthy')).toBe('offline');
  });
});

describe('SystemHealthWidget — standard layout (2×4)', () => {
  it('renders the title, four labelled service dots, and all four stat cards', () => {
    setup();
    renderWidget(STANDARD);

    expect(screen.getByText('System Health')).toBeInTheDocument();

    // Service rows carry human labels derived from the service keys.
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Mqtt')).toBeInTheDocument();
    expect(screen.getByText('Tesla Api')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument();

    // Each status is exposed to assistive tech, not colour-only.
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Database: Healthy' })).toBeInTheDocument();

    // Stat grid: DB size, active/max conns, memory, goroutines.
    expect(screen.getByText('DB Size')).toBeInTheDocument();
    expect(screen.getByText('2.4 GB')).toBeInTheDocument();
    expect(screen.getByText('Active Conns')).toBeInTheDocument();
    expect(screen.getByText('5/25')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText('Goroutines')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('maps each status tier to the right dot colour (warning→amber, unknown→grey)', () => {
    setup({
      health: makeQuery({
        data: makeHealth({
          components: {
            database: comp('healthy'),
            mqtt: comp('warning'),
            tesla_api: comp('unknown'),
            fleet_telemetry: comp('down'),
          },
        }),
      }),
    });
    renderWidget(STANDARD);

    expect(screen.getByRole('img', { name: 'Database: Healthy' }).className).toContain('bg-green-500');
    // The whole point: `warning` is amber, not red.
    expect(screen.getByRole('img', { name: 'Mqtt: Degraded' }).className).toContain('bg-amber-400');
    expect(screen.getByRole('img', { name: 'Tesla Api: Unknown' }).className).toContain('bg-gray-400');
    expect(screen.getByRole('img', { name: 'Fleet Telemetry: Down' }).className).toContain('bg-red-500');
  });

  it('defaults a service missing from the components map to the down tier', () => {
    setup({
      health: makeQuery({
        data: makeHealth({ components: { database: comp('ok') } }),
      }),
    });
    renderWidget(STANDARD);

    // 'ok' is a healthy alias → green.
    expect(screen.getByRole('img', { name: 'Database: Healthy' }).className).toContain('bg-green-500');
    // Absent component → default 'unhealthy' → down → red.
    expect(screen.getByRole('img', { name: 'Mqtt: Down' }).className).toContain('bg-red-500');
  });

  it('falls back past an empty databaseSize to the dbStats size', () => {
    setup({
      health: makeQuery({ data: makeHealth({ databaseSize: '' }) }),
      db: makeQuery({ data: makeDbStats({ databaseSize: '1.0 GB' }) }),
    });
    renderWidget(STANDARD);

    expect(screen.getByText('1.0 GB')).toBeInTheDocument();
  });

  it('renders an em-dash for the database size when none is available anywhere', () => {
    setup({
      health: makeQuery({ data: makeHealth({ databaseSize: '' }) }),
      db: makeQuery({ data: makeDbStats({ databaseSize: '' }) }),
    });
    renderWidget(STANDARD);

    // Memory + goroutines are present, so the only em-dash is the DB size.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders em-dashes for runtime memory and goroutines when the pool omits them', () => {
    setup({ pool: makeQuery({ data: makePool({ goroutines: undefined, memoryMB: undefined }) }) });
    renderWidget(STANDARD);

    // Both memory and goroutines fall back to the placeholder.
    expect(screen.getAllByText('—')).toHaveLength(2);
    // DB size is still real, proving the em-dashes are the runtime stats.
    expect(screen.getByText('2.4 GB')).toBeInTheDocument();
  });

  it('drops the "/max" when the pool max is zero/unknown', () => {
    setup({ pool: makeQuery({ data: makePool({ inUse: 3, maxOpen: 0 }) }) });
    renderWidget(STANDARD);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('3/0')).not.toBeInTheDocument();
  });
});

describe('SystemHealthWidget — compact layout (1×2)', () => {
  it('renders the badge + overall label + healthy-service count, without the title/grid', () => {
    setup({
      health: makeQuery({
        data: makeHealth({
          status: 'healthy',
          components: {
            database: comp('healthy'),
            mqtt: comp('healthy'),
            tesla_api: comp('healthy'),
            fleet_telemetry: comp('unhealthy'),
          },
        }),
      }),
    });
    renderWidget(COMPACT);

    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // 3 of 4 services are in the ok tier.
    expect(screen.getByText('3/4 services')).toBeInTheDocument();

    // Compact is title-less and omits the dot grid + stat cards.
    expect(screen.queryByText('System Health')).not.toBeInTheDocument();
    expect(screen.queryByText('DB Size')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('flips the badge tone + label when the system is degraded', () => {
    setup({ health: makeQuery({ data: makeHealth({ status: 'degraded' }) }) });
    renderWidget(COMPACT);

    expect(screen.getByText('away')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });
});

describe('SystemHealthWidget — states & interaction', () => {
  it('shows the empty state (role="status") when health returns no data', () => {
    setup({ health: makeQuery({ data: null }) });
    renderWidget(STANDARD);

    expect(screen.getByText('No system health data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Standard keeps its header, but the stat cards are gated behind data.
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.queryByText('DB Size')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds the header + content while loading', () => {
    setup({ health: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('System Health')).not.toBeInTheDocument();
    expect(screen.queryByText('No system health data')).not.toBeInTheDocument();
  });

  it('renders the error branch (role="alert") instead of the widget body on failure', () => {
    setup({ health: makeQuery({ data: undefined, error: new Error('boom'), isError: true }) });
    renderWidget(STANDARD);

    // A non-ApiError falls through QueryError to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('System Health')).not.toBeInTheDocument();
  });

  it('refetches system health when the accessible Refresh control is clicked', () => {
    const refetch = vi.fn();
    setup({ health: makeQuery({ data: makeHealth(), refetch }) });
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
