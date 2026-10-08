/**
 * SystemStatusPage — behaviour + hardening coverage.
 *
 * The page is the single export; every derivation, branch, and internal helper
 * (StatusDot / StatusBadge / resolveCompStatus / DetailLink / DefList /
 * SystemInfoRows) is exercised through it by driving the data sources it reads.
 *
 * Strategy:
 *   - The seven inline `useQuery(...)` devtools calls (extended-health, version,
 *     update-check, backup-stats, workers, errors) are controlled
 *     synchronously via a mocked `@tanstack/react-query.useQuery` keyed off
 *     `queryKey[1]`, so there is no async network flush.
 *   - The domain hooks (`useSystemHealth`, `useBackupRuns`, `useBackupConfigs`,
 *     `useMaintenanceState`, `useAuthStatus`, `useNotificationStats`,
 *     `useVehicles`) and the SSE hook are mocked directly.
 *   - The shared status PRIMITIVES (`StatusHero`, `HealthRow`, `ActionItem`,
 *     `ActionItemsPanel`, `ResourcesPanel`, `UptimeHeatmap`) stay REAL so the
 *     page's derived summaries/statuses/action-items are asserted on the real
 *     rendered output. The sticky chrome + the feature-level status cards
 *     (which fetch their own data) are stubbed to keep the page isolated.
 *
 * Facets covered: populated healthy view, per-source health-row derivation,
 * resource-row building + camelCase-alias filtering, the systems accordions,
 * the reliability band (30-day uptime + errors + empty action items), the full
 * operator action-item matrix, token-expired / not-connected / no-backup
 * branches, loading skeleton, staleness, error subline (incl. the non-Error
 * hardening), the missing-data placeholders, the `components ?? {}` crash guard,
 * refresh interactions (button + "r" shortcut + hero CTA), section scroll, and
 * the error-count severity ordering bug fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/feedback/Toast'
import { neonColorMap } from '@/lib/tokens'

// ── i18n: return the fallback/default string and interpolate {{vars}} ──
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const t = (key: string, second?: unknown, third?: unknown): string => {
    let template = key
    let vars: Record<string, unknown> | undefined
    if (typeof second === 'string') {
      template = second
      if (third && typeof third === 'object') vars = third as Record<string, unknown>
    } else if (second && typeof second === 'object') {
      vars = second as Record<string, unknown>
      const dv = (second as Record<string, unknown>).defaultValue
      if (typeof dv === 'string') template = dv
    }
    const v = vars
    if (v) {
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        name in v ? String(v[name]) : `{{${name}}}`,
      )
    }
    return template
  }
  return {
    ...actual,
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// ── react-query: the page's inline queries + its queryClient ──
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return { ...actual, useQuery: vi.fn(), useQueryClient: vi.fn() }
})

// devtools functions are passed as queryFns to the mocked useQuery (never
// invoked); stub them so the import chain stays inert.
vi.mock('@/api/devtools', () => ({
  getVersionInfo: vi.fn(),
  getExtendedHealth: vi.fn(),
  checkForUpdates: vi.fn(),
  getBackupStats: vi.fn(),
  getWorkersHealth: vi.fn(),
}))

vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: vi.fn(),
  useBackupRuns: vi.fn(),
  useBackupConfigs: vi.fn(),
  useMaintenanceState: vi.fn(),
}))
vi.mock('@/api/hooks/useSettings', () => ({ useAuthStatus: vi.fn() }))
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }))
vi.mock('../hooks/useStatusLiveSSE', () => ({ useStatusLiveSSE: vi.fn() }))

// Feature-level status cards fetch their own data — stub to prop-exposing
// stand-ins so the page runs end-to-end without a network.
vi.mock('../components/status', () => ({
  AccordionSection: ({
    title,
    description,
    badges,
    children,
  }: {
    title?: ReactNode
    description?: ReactNode
    badges?: ReactNode
    children?: ReactNode
  }) => (
    <div data-testid="accordion">
      <h3>{title}</h3>
      {description != null && <div data-testid="acc-desc">{description}</div>}
      {badges != null && <div data-testid="acc-badges">{badges}</div>}
      <div>{children}</div>
    </div>
  ),
  AnomalyInlineRow: () => null,
  BackgroundWorkersCard: ({ health }: { health?: { total?: number } }) => (
    <div data-testid="workers-card">{health ? `workers:${health.total}` : 'no-workers'}</div>
  ),
  TeslaAuthCard: ({ authenticated }: { authenticated?: boolean }) => (
    <div data-testid="tesla-auth-card">auth:{String(authenticated)}</div>
  ),
  TelemetryPipelineCard: ({ positionCount }: { positionCount?: number }) => (
    <div data-testid="telemetry-card">positions:{positionCount}</div>
  ),
  UpdateAvailableCallout: ({ current, latest }: { current?: string; latest?: string }) => (
    <div data-testid="update-callout">
      {current} to {latest}
    </div>
  ),
  StatusPageSkeleton: () => <div data-testid="status-skeleton" />,
  LiveStatusPill: ({ state }: { state?: string }) => <div data-testid="live-pill">{state}</div>,
  IncidentsCard: () => null,
  IncidentHistory: () => <div data-testid="incident-history" />,
  ScheduledMaintenanceCard: () => <div data-testid="scheduled-maintenance" />,
  SLOTrackingCard: () => <div data-testid="slo-card" />,
}))

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useSystemHealth,
  useBackupRuns,
  useBackupConfigs,
  useMaintenanceState,
} from '@/api/hooks/useAdmin'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useStatusLiveSSE } from '../hooks/useStatusLiveSSE'
import SystemStatusPage from './SystemStatusPage'

const mockUseQuery = vi.mocked(useQuery)
const mockUseQueryClient = vi.mocked(useQueryClient)
const mockSystemHealth = vi.mocked(useSystemHealth)
const mockBackupRuns = vi.mocked(useBackupRuns)
const mockBackupConfigs = vi.mocked(useBackupConfigs)
const mockMaintenance = vi.mocked(useMaintenanceState)
const mockAuthStatus = vi.mocked(useAuthStatus)
const mockVehicles = vi.mocked(useVehicles)
const mockLiveSSE = vi.mocked(useStatusLiveSSE)

const DAY = 24 * 60 * 60 * 1000

// ── fixtures (shapes mirror the real API / types) ──
function systemHealth(over: Record<string, unknown> = {}) {
  return {
    status: 'healthy',
    components: {
      database: { status: 'ok', consecutiveFailures: 0, lastError: null, details: {} },
      redis: { status: 'healthy', consecutiveFailures: 0, lastError: null, details: {} },
      // canonical snake_case survives the filter…
      tesla_api: { status: 'ok', consecutiveFailures: 0, lastError: null, details: {} },
      // …its camelCaseKeys() alias (has an uppercase letter) is dropped.
      teslaApi: { status: 'ok', consecutiveFailures: 0, lastError: null, details: {} },
    },
    databaseSize: '512 MB',
    tableCount: 42,
    ...over,
  }
}
function extHealth(over: Record<string, unknown> = {}) {
  return {
    status: 'healthy',
    components: {
      database: { status: 'ok', latency_ms: 12.4 },
      database_pool: {
        status: 'healthy',
        total_conns: 25,
        idle_conns: 20,
        acquired_conns: 5,
      },
      system: {
        status: 'healthy',
        goroutines: 150,
        go_version: 'go1.25',
        uptime_seconds: 3600,
      },
    },
    ...over,
  }
}
function versionInfo(over: Record<string, unknown> = {}) {
  return {
    app_version: '1.2.3',
    chart_version: '0.4.0',
    go_version: 'go1.25',
    os: 'linux',
    arch: 'amd64',
    uptime_seconds: 90061, // 1d 1h 1m
    goroutines: 150,
    ...over,
  }
}
function updateCheck(over: Record<string, unknown> = {}) {
  return { current: '1.2.3', latest: '1.2.3', update_available: false, ...over }
}
function backupStats(over: Record<string, unknown> = {}) {
  return {
    database_size: '512 MB',
    table_count: 42,
    row_counts: { positions: 1000, drives: 50, charging_sessions: 20, signal_log: 99999 },
    ...over,
  }
}
function workersHealth(over: Record<string, unknown> = {}) {
  return {
    workers: [
      { name: 'notif', host: 'h', status: 'healthy', latency_ms: 5 },
      { name: 'export', host: 'h', status: 'healthy', latency_ms: 5 },
    ],
    total: 2,
    healthy_count: 2,
    ...over,
  }
}
function maintenance(over: Record<string, unknown> = {}) {
  return { mode: 'ok', source: 'db', updated_at: new Date().toISOString(), ...over }
}
function authStatus(over: Record<string, unknown> = {}) {
  return { authenticated: true, ...over }
}
function backupRun(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    configId: 'c1',
    status: 'completed',
    backupType: 'full',
    fileSize: 5 * 1024 * 1024, // 5.0 MB
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1000,
    ...over,
  }
}
function backupConfig(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'daily',
    enabled: true,
    backupType: 'full',
    frequencyDays: 1,
    maxRetention: 7,
    provider: 'local',
    providerConfig: {},
    compress: true,
    encrypt: false,
    lastRunAt: null,
    nextRunAt: null,
    ...over,
  }
}

function q<T>(data: T, over: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isPending: false,
    isSuccess: true,
    isLoadingError: false,
    isRefetchError: false,
    isInitialLoading: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isRefetching: false,
    isPaused: false,
    isPlaceholderData: false,
    isEnabled: true,
    isStale: false,
    status: 'success' as const,
    fetchStatus: 'idle' as const,
    promise: Promise.resolve(data),
    ...over,
  }
}

// mutable per-test state driving the inline useQuery + refresh spies
let inline: Record<string, unknown>
let inlineOverrides: Record<string, Record<string, unknown>>
let refetchHealth: ReturnType<typeof vi.fn<() => void>>
let liveReconnect: ReturnType<typeof vi.fn<() => void>>
let invalidateQueries: ReturnType<typeof vi.fn<(options: { queryKey: string[] }) => void>>
let scrollSpy: ReturnType<typeof vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>>

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SystemStatusPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const healthRegion = () => within(screen.getByRole('region', { name: 'Health summary' }))
const resourcesRegion = () => within(screen.getByRole('region', { name: 'Server resources' }))
const actionsRegion = () => within(screen.getByRole('region', { name: 'Operator action items' }))

beforeEach(() => {
  vi.clearAllMocks()
  const NOW = Date.now()
  refetchHealth = vi.fn()
  liveReconnect = vi.fn()
  invalidateQueries = vi.fn()
  scrollSpy = vi.fn()
  // jsdom implements neither scrollIntoView nor Element.scrollTo.
  Element.prototype.scrollIntoView = scrollSpy
  Element.prototype.scrollTo = vi.fn()

  inline = {
    'extended-health': extHealth(),
    version: versionInfo(),
    'update-check': updateCheck(),
    'backup-stats': backupStats(),
    workers: workersHealth(),
  }
  inlineOverrides = {}
  mockUseQuery.mockImplementation(
    (opts: unknown) =>
      ({
        data: inline[String((opts as { queryKey: unknown[] }).queryKey[1])],
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
        ...inlineOverrides[String((opts as { queryKey: unknown[] }).queryKey[1])],
         
      }) as any,
  )
   
  mockUseQueryClient.mockReturnValue({ invalidateQueries } as any)

  mockSystemHealth.mockReturnValue(
     
    q(systemHealth(), { refetch: refetchHealth, dataUpdatedAt: NOW }) as any,
  )
   
  mockBackupRuns.mockReturnValue(q([backupRun({ completedAt: new Date(NOW - 3600_000).toISOString() })]) as any)
   
  mockBackupConfigs.mockReturnValue(q([backupConfig()]) as any)
   
  mockMaintenance.mockReturnValue(q(maintenance()) as any)
  mockAuthStatus.mockReturnValue(
     
    q(authStatus({ expires_at: new Date(NOW + 30 * DAY).toISOString() })) as any,
  )
   
   
  mockVehicles.mockReturnValue(q([{ id: 1 }, { id: 2 }]) as any)
  mockLiveSSE.mockReturnValue({
    snapshot: null,
    state: 'live',
    lastUpdateAt: NOW,
    reconnect: liveReconnect,
  })
})

describe('SystemStatusPage — healthy populated view', () => {
  it('renders the page scaffolding, hero, sticky chrome, chip bar and live pill', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'System status' })).toBeInTheDocument()
    // healthy + fresh → the real StatusHero shows its default headline.
    expect(screen.getByText('All systems operational')).toBeInTheDocument()
    // subline reports recency, not an error/stale banner.
    expect(screen.getByText(/^Last checked/)).toBeInTheDocument()
    expect(screen.getByText('Operator diagnostics')).toBeInTheDocument()
    expect(document.querySelector('#operator-details')).not.toHaveAttribute('open')
    expect(screen.getByTestId('live-pill')).toHaveTextContent('live')
  })

  it('derives every health-summary row from the live data sources', () => {
    renderPage()
    const r = healthRegion()

    expect(r.getByText('Services')).toBeInTheDocument()
    expect(r.getByText('3 / 3 healthy')).toBeInTheDocument() // database + redis + tesla_api
    expect(r.getByText('Database')).toBeInTheDocument()
    expect(r.getByText('12ms · 512 MB')).toBeInTheDocument() // round(12.4) + db size
    expect(r.getByText('Telemetry')).toBeInTheDocument()
    expect(r.getByText('2 vehicles · 1,000 positions')).toBeInTheDocument()
    expect(r.getByText('2 / 2 healthy')).toBeInTheDocument() // workers
    expect(r.getByText('Connected')).toBeInTheDocument() // tesla auth
  })

  it('builds resource rows and drops the camelCase component alias', () => {
    renderPage()
    const rr = resourcesRegion()

    expect(rr.getByText('DB connections')).toBeInTheDocument()
    expect(rr.getByText('Storage used')).toBeInTheDocument()
    expect(rr.getByText('512 MB')).toBeInTheDocument()
    expect(rr.getByText('Total rows')).toBeInTheDocument()
    expect(rr.getByText('101,069')).toBeInTheDocument() // 1000+50+20+99999
    expect(rr.getByText('Runtime threads')).toBeInTheDocument()

    // Component listing keeps the snake_case key and filters the alias.
    expect(screen.getByText('database')).toBeInTheDocument()
    expect(screen.getByText('redis')).toBeInTheDocument()
    expect(screen.getByText('tesla_api')).toBeInTheDocument()
    expect(screen.queryByText('teslaApi')).not.toBeInTheDocument()
  })

  it('threads real values into the systems accordions and cards', () => {
    renderPage()

    // Database accordion definition list.
    expect(screen.getByText('Latency')).toBeInTheDocument()
    expect(screen.getByText('12ms')).toBeInTheDocument()
    expect(screen.getByText('5 / 25')).toBeInTheDocument() // pool acquired / total
    // Prop-threaded feature cards.
    expect(screen.getByTestId('telemetry-card')).toHaveTextContent('positions:1000')
    expect(screen.getByTestId('workers-card')).toHaveTextContent('workers:2')
    expect(screen.queryByText('Tesla API usage')).not.toBeInTheDocument()
    expect(screen.getByTestId('tesla-auth-card')).toHaveTextContent('auth:true')
    expect(document.querySelector('#backups')).toBeNull()
    expect(document.querySelector('#notifications')).toBeNull()
    expect(document.querySelector('#subscribe')).toBeNull()
    expect(document.querySelector('#tesla-api')).toBeNull()
    expect(screen.queryByText('Get notified about incidents')).not.toBeInTheDocument()
    // System info rows (hardcoded labels, real values).
    expect(screen.getByText('App version')).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByText('linux/amd64')).toBeInTheDocument()
  })

  it('reports an unhealthy database as down rather than degraded', () => {
    const unhealthy = extHealth()
    unhealthy.components.database.status = 'unhealthy'
    inline['extended-health'] = unhealthy

    renderPage()

    const databaseSection = document.querySelector('#database')
    expect(databaseSection).not.toBeNull()
    expect(within(databaseSection as HTMLElement).getByText('down')).toBeInTheDocument()
  })

  it('shows real incident history instead of fabricated uptime and keeps action items', () => {
    renderPage()

    expect(screen.getByTestId('incident-history')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Daily status history' })).not.toBeInTheDocument()
    expect(document.querySelector('#errors')).toBeNull()

    // Everything healthy → the action list shows its explicit empty state.
    expect(document.querySelector('#action-items')).toBeNull()
  })
})

describe('SystemStatusPage — operator action items', () => {
  beforeEach(() => {
    const NOW = Date.now()
     
    mockMaintenance.mockReturnValue(q(maintenance({ mode: 'maintenance', maintenance_message: 'Upgrading DB' })) as any)
    inline['update-check'] = updateCheck({ update_available: true, current: '1.2.3', latest: '1.3.0' })
    inline.workers = workersHealth({
      total: 3,
      healthy_count: 1,
      workers: [
        { name: 'notif', host: 'h', status: 'healthy', latency_ms: 5 },
        { name: 'export', host: 'h', status: 'down', latency_ms: 0 },
        { name: 'geocode', host: 'h', status: 'down', latency_ms: 0 },
      ],
    })
    mockAuthStatus.mockReturnValue(
       
      q(authStatus({ expires_at: new Date(NOW + 3.5 * DAY).toISOString() })) as any,
    )
    mockBackupRuns.mockReturnValue(
       
      q([backupRun({ completedAt: new Date(NOW - 10.5 * DAY).toISOString() })]) as any,
    )
     
  })

  it('surfaces every actionable operator task with interpolated copy', () => {
    renderPage()
    const a = actionsRegion()

    expect(a.getByText('Maintenance mode is active')).toBeInTheDocument()
    expect(a.getByText('Upgrading DB')).toBeInTheDocument()
    expect(a.getByText('Update available — v1.3.0')).toBeInTheDocument()
    expect(a.getByText('Tesla token expires in 3 day(s)')).toBeInTheDocument()
    expect(a.getByText('Last backup is 10 days old')).toBeInTheDocument()
    expect(a.queryByText(/Tesla API Estimated cost/)).not.toBeInTheDocument()
    expect(a.getByText('2 of 3 workers unhealthy')).toBeInTheDocument()
    expect(a.getByText('export, geocode')).toBeInTheDocument()
  })

  it('reflects the degraded/maintenance states in the hero, rows and badges', () => {
    renderPage()

    // maintenance overall → StatusHero maintenance headline.
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
    // update callout renders above the chip bar with both versions.
    expect(screen.getByTestId('update-callout')).toHaveTextContent('1.2.3 to 1.3.0')

    const r = healthRegion()
    expect(r.getByText('1 / 3 healthy')).toBeInTheDocument() // workers degraded
    expect(r.getByText('Expires in 3d')).toBeInTheDocument() // tesla auth warn

  })
})

describe('SystemStatusPage — auth + backup edge branches', () => {
  it('shows the token-expired action + unhealthy tesla-auth summary', () => {
    const NOW = Date.now()
    mockAuthStatus.mockReturnValue(
       
      q(authStatus({ authenticated: true, expires_at: new Date(NOW - DAY).toISOString() })) as any,
    )
    renderPage()

    expect(actionsRegion().getByText('Tesla token expired')).toBeInTheDocument()
    expect(healthRegion().getByText('Token expired')).toBeInTheDocument()
  })

  it('shows not-connected + no-backup actions when auth is off and runs are empty', () => {
     
    mockAuthStatus.mockReturnValue(q(authStatus({ authenticated: false })) as any)
     
    mockBackupRuns.mockReturnValue(q([]) as any)
     
    mockBackupConfigs.mockReturnValue(q([backupConfig()]) as any)
    renderPage()

    const a = actionsRegion()
    expect(a.getByText('Tesla account not connected')).toBeInTheDocument()
    expect(a.getByText('No backups recorded')).toBeInTheDocument()
    expect(healthRegion().getByText('Not connected')).toBeInTheDocument()
  })
})

describe('SystemStatusPage — loading / stale / error', () => {
  it('shows the skeleton and no hero while the health query is loading', () => {
    mockSystemHealth.mockReturnValue(
       
      q(undefined, { isLoading: true, isFetching: true, dataUpdatedAt: 0 }) as any,
    )
    renderPage()

    expect(screen.getByTestId('status-skeleton')).toBeInTheDocument()
    // scaffolding stays, rich content does not.
    expect(screen.getByRole('heading', { level: 1, name: 'System status' })).toBeInTheDocument()
    expect(screen.queryByText('All systems operational')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sticky-compact-hero')).not.toBeInTheDocument()
  })

  it('marks the hero unknown + stale when the last check is older than 2 minutes', () => {
    const NOW = Date.now()
    mockSystemHealth.mockReturnValue(
       
      q(systemHealth(), { dataUpdatedAt: NOW - 3 * 60_000 }) as any,
    )
    renderPage()

    expect(screen.getByText('Status unknown')).toBeInTheDocument()
    expect(screen.getByText(/\(stale\)/)).toBeInTheDocument()
  })

  it('renders the health-check error in the hero subline', () => {
    mockSystemHealth.mockReturnValue(
       
      q(undefined, { error: new Error('db unreachable'), dataUpdatedAt: 0 }) as any,
    )
    renderPage()

    expect(screen.getByText('Status unknown')).toBeInTheDocument()
    expect(screen.getByText('Health check failed — db unreachable')).toBeInTheDocument()
  })

  it('stringifies a non-Error rejection instead of printing "undefined" (hardening)', () => {
    mockSystemHealth.mockReturnValue(
       
      q(undefined, { error: 'boom-string', dataUpdatedAt: 0 }) as any,
    )
    renderPage()

    expect(screen.getByText('Health check failed — boom-string')).toBeInTheDocument()
    expect(screen.queryByText('Health check failed — undefined')).not.toBeInTheDocument()
  })
})

describe('SystemStatusPage — missing data placeholders', () => {
  it('shows honest placeholders across the page when optional sources are absent', () => {
    // Every inline query + every hook returns undefined.
    inline = {}
     
    mockSystemHealth.mockReturnValue(q(undefined, { dataUpdatedAt: 0 }) as any)
     
    mockBackupRuns.mockReturnValue(q(undefined) as any)
     
    mockBackupConfigs.mockReturnValue(q(undefined) as any)
     
    mockMaintenance.mockReturnValue(q(undefined) as any)
     
    mockAuthStatus.mockReturnValue(q(undefined) as any)
     
     
    mockVehicles.mockReturnValue(q(undefined) as any)
    renderPage()

    expect(screen.getByText('Awaiting first check')).toBeInTheDocument()
    const r = healthRegion()
    expect(r.getByText('no data')).toBeInTheDocument() // services
    expect(r.queryByText('connected')).not.toBeInTheDocument() // absent database source is not connected
    expect(r.getByText('No vehicle telemetry to assess')).toBeInTheDocument()
    expect(r.getAllByText('unknown')).toHaveLength(3) // database, workers and Tesla auth
    expect(r.queryByText('Not connected')).not.toBeInTheDocument()

    // Errors + system-info honest fallbacks.
    expect(document.querySelector('#errors')).toBeNull()
    expect(within(document.getElementById('system')!).getByText('System info is unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Loading system info…')).not.toBeInTheDocument()
    // Infrastructure details are available in the operator disclosure.
    expect(document.querySelector('#operator-details #resources')).not.toBeNull()
    // Nothing actionable → empty action list.
    expect(document.querySelector('#action-items')).toBeNull()
  })

  it('does not crash and shows an empty component list when components is missing', () => {
    mockSystemHealth.mockReturnValue(
       
      q(systemHealth({ components: undefined })) as any,
    )
    renderPage()

    // The page still mounts (crash guard: Object.entries(health.components ?? {})).
    expect(screen.getByRole('heading', { level: 1, name: 'System status' })).toBeInTheDocument()
    expect(screen.getByText('Current component status is unavailable.')).toBeInTheDocument()
    expect(healthRegion().getByText('no data')).toBeInTheDocument()
  })
})

describe('SystemStatusPage — continuation source preservation', () => {
  it('keeps scalar Telemetry, independent sources and body recovery outside the refresh control', () => {
    inlineOverrides['backup-stats'] = { error: new Error('statistics refresh failed') }
    mockAuthStatus.mockReturnValue(
      q<ReturnType<typeof useAuthStatus>['data']>(undefined, { error: new Error('auth source unavailable') }) as ReturnType<typeof useAuthStatus>,
    )
    renderPage()
    expect(healthRegion().getByText('Telemetry')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-card')).toHaveTextContent('positions:1000')
    expect(resourcesRegion().getByText('101,069')).toBeInTheDocument()
    expect(screen.getByText('App version')).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    // The page source notice and both retained resource rows expose recovery.
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3)
    const refresh = screen.getByRole('button', { name: 'Refresh (r)' })
    expect(refresh).toHaveAttribute('title', 'Press r to refresh')
    expect(within(refresh).queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(within(refresh).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps extended runtime evidence when version info is unavailable rather than claiming it is loading', () => {
    inline.version = undefined
    inlineOverrides.version = { error: new Error('version unavailable') }
    renderPage()
    expect(screen.getByText('System info is unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Loading system info…')).not.toBeInTheDocument()
    const system = document.getElementById('system')!
    expect(within(system).getByText('Goroutines')).toBeInTheDocument()
    expect(within(system).getByText('150')).toBeInTheDocument()
    expect(within(system).getByText('App version').nextElementSibling).toHaveTextContent('—')
    expect(screen.getByTestId('workers-card')).toHaveTextContent('workers:2')
  })
})

describe('SystemStatusPage — interactions', () => {
  it('fans the header refresh button out to refetch + invalidate + reconnect', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh (r)' }))

    expect(refetchHealth).toHaveBeenCalledTimes(1)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['system-status'] })
    expect(liveReconnect).toHaveBeenCalledTimes(1)
  })

  it('refreshes on the "r" shortcut but ignores keystrokes while typing in a field', () => {
    renderPage()

    fireEvent.keyDown(document.body, { key: 'r' })
    expect(refetchHealth).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'r' })
    expect(refetchHealth).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('runs a health check from the hero CTA', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Run health check' }))
    expect(refetchHealth).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the target section when a health row is clicked', () => {
    renderPage()

    fireEvent.click(healthRegion().getByRole('button', { name: /Services/ }))
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('disables the refresh control and marks it busy while fetching', () => {
    mockSystemHealth.mockReturnValue(
       
      q(systemHealth(), { isFetching: true, refetch: refetchHealth }) as any,
    )
    renderPage()

    const btn = screen.getByRole('button', { name: 'Refresh (r)' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})

describe('SystemStatusPage — Resource source adoption', () => {
  function workerRow() {
    const row = resourcesRegion().getByText('Workers').closest('div.min-w-0.space-y-2')
    if (!(row instanceof HTMLElement)) throw new Error('Workers resource row missing')
    return within(row)
  }

  it.each([
    { healthy: 95, total: 100, status: 'Degraded', color: neonColorMap.amber.dot },
    { healthy: 100, total: 100, status: 'Healthy', color: neonColorMap.green.dot },
    { healthy: 0, total: 10, status: 'Critical', color: neonColorMap.red.dot },
  ])('uses raw worker health $healthy/$total rather than utilization', ({ healthy, total, status, color }) => {
    inline.workers = workersHealth({ healthy_count: healthy, total })
    renderPage()
    const row = workerRow()
    expect(row.getByText(`${healthy} / ${total}`)).toBeInTheDocument()
    expect(row.getByText(status)).toBeInTheDocument()
    const bar = row.getByRole('progressbar', { name: 'Workers health' })
    expect(bar).toHaveAttribute('aria-valuenow', String(Math.round(healthy / total * 100)))
    expect(bar.firstElementChild).toHaveClass(color)
    expect(bar.firstElementChild).toHaveStyle({ width: `${healthy / total * 100}%` })
  })

  it.each([
    { healthy: undefined, total: 10 },
    { healthy: 1, total: undefined },
    { healthy: null, total: 10 },
    { healthy: 0, total: 0 },
    { healthy: 11, total: 10 },
    { healthy: -1, total: 10 },
    { healthy: 1.5, total: 10 },
    { healthy: 1, total: 1.5 },
    { healthy: NaN, total: 10 },
    { healthy: 1, total: Infinity },
    { healthy: Infinity, total: 10 },
    { healthy: 1, total: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not invent health for invalid raw counts $healthy/$total', ({ healthy, total }) => {
    inline.workers = workersHealth({ healthy_count: healthy, total })
    renderPage()
    expect(workerRow().getByText('Unknown')).toBeInTheDocument()
    expect(workerRow().queryByRole('progressbar')).not.toBeInTheDocument()
    expect(resourcesRegion().getByRole('progressbar', { name: 'DB connections usage' })).toHaveAttribute('aria-valuenow', '20')
  })

  it.each([
    { acquired: 7, total: 10, status: 'Warning', color: neonColorMap.amber.dot },
    { acquired: 9, total: 10, status: 'Critical', color: neonColorMap.red.dot },
  ])('retains DB utilization at $acquired/$total independently of worker health', ({ acquired, total, status, color }) => {
    const extended = extHealth()
    extended.components.database_pool.acquired_conns = acquired
    extended.components.database_pool.total_conns = total
    inline['extended-health'] = extended
    renderPage()
    const bar = resourcesRegion().getByRole('progressbar', { name: 'DB connections usage' })
    expect(bar).toHaveAttribute('aria-valuenow', String(acquired / total * 100))
    expect(bar.firstElementChild).toHaveClass(color)
    const row = bar.closest('div.min-w-0.space-y-2')
    if (!(row instanceof HTMLElement)) throw new Error('DB resource row missing')
    expect(within(row).getByText(status)).toBeInTheDocument()
    expect(workerRow().getByText('Healthy')).toBeInTheDocument()
    expect(resourcesRegion().getByRole('heading', { name: 'Server resources' })).toBeInTheDocument()
  })

  it('retains the unresolved worker row without inventing zero or blanking neighbors', () => {
    inline.workers = undefined
    inlineOverrides.workers = { isLoading: true, isFetching: true }
    renderPage()
    expect(workerRow().getByText('Loading')).toBeInTheDocument()
    expect(workerRow().queryByText('0 / 0')).not.toBeInTheDocument()
    expect(workerRow().queryByRole('progressbar')).not.toBeInTheDocument()
    expect(resourcesRegion().getByText('512 MB')).toBeInTheDocument()
    expect(resourcesRegion().getByText('1d 1h 1m')).toBeInTheDocument()
  })

  it('limits a fatal worker error and its retry to that row', () => {
    const retry = vi.fn()
    inline.workers = undefined
    inlineOverrides.workers = { error: new Error('worker probes unavailable'), refetch: retry }
    renderPage()
    const row = workerRow()
    expect(row.queryByRole('progressbar')).not.toBeInTheDocument()
    fireEvent.click(row.getByRole('button'))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(resourcesRegion().getByText('101,069')).toBeInTheDocument()
    expect(resourcesRegion().getByRole('progressbar', { name: 'DB connections usage' })).toBeInTheDocument()
  })

  it('keeps healthy retained counts with nonblocking refresh recovery', () => {
    const retry = vi.fn()
    inlineOverrides.workers = { error: new Error('worker refresh failed'), refetch: retry, dataUpdatedAt: 1234 }
    renderPage()
    const row = workerRow()
    expect(row.getByText('2 / 2')).toBeInTheDocument()
    expect(row.getByText('Healthy')).toBeInTheDocument()
    expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(row.getByText('Workers may be out of date')).toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: 'Refresh' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(resourcesRegion().getByText('512 MB')).toBeInTheDocument()
  })

  it('keeps paused worker counts without claiming device offline or fabricating observation age', () => {
    inlineOverrides.workers = { fetchStatus: 'paused', dataUpdatedAt: 0 }
    renderPage()
    const row = workerRow()
    expect(row.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true')
    expect(row.getByText('2 / 2')).toBeInTheDocument()
    expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(row.queryByText(/ago|offline/i)).not.toBeInTheDocument()
  })

  it('threads independent refresh recovery to every existing backing resource row', () => {
    const extendedRetry = vi.fn()
    const backupRetry = vi.fn()
    const versionRetry = vi.fn()
    inlineOverrides['extended-health'] = { error: new Error('extended refresh failed'), refetch: extendedRetry }
    inlineOverrides['backup-stats'] = { error: new Error('backup refresh failed'), refetch: backupRetry }
    inlineOverrides.version = { error: new Error('version refresh failed'), refetch: versionRetry }
    renderPage()
    const notices = resourcesRegion().getAllByTestId('stale-refresh-warning')
    expect(notices).toHaveLength(5)
    for (const notice of notices) {
      fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }))
    }
    expect(extendedRetry).toHaveBeenCalledTimes(2)
    expect(backupRetry).toHaveBeenCalledTimes(2)
    expect(versionRetry).toHaveBeenCalledTimes(1)
    expect(workerRow().queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(workerRow().getByText('Healthy')).toBeInTheDocument()
  })

  it('assigns fallback uptime to extended recovery rather than failed version recovery', () => {
    const extendedRetry = vi.fn()
    const versionRetry = vi.fn()
    inline.version = undefined
    inlineOverrides.version = { error: new Error('version unavailable'), refetch: versionRetry }
    inlineOverrides['extended-health'] = { error: new Error('extended refresh failed'), refetch: extendedRetry }
    renderPage()
    const notices = resourcesRegion().getAllByTestId('stale-refresh-warning')
    expect(notices).toHaveLength(3)
    expect(resourcesRegion().getByText('1h 0m')).toBeInTheDocument()
    for (const notice of notices) {
      fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }))
    }
    expect(extendedRetry).toHaveBeenCalledTimes(3)
    expect(versionRetry).not.toHaveBeenCalled()
  })
})
