/**
 * SystemStatusPage — operator-grade health dashboard.
 *
 * Mobile-first single-column layout; answers in <5 seconds:
 *   1. Is my instance healthy?           — StatusHero
 *   2. If not, what's broken?            — Health rows + Action items
 *   3. What do I need to do?             — ActionItemsPanel CTAs
 *
 * Pulls live data from existing backend endpoints so every accordion
 *   shows real values (DB size, vehicle count, worker
 *   health and backup recency) instead of
 *   the generic "Operational" stub the first cut shipped with.
 *
 * Heavy panels that duplicated other pages remain link-outs to:
 *   - Detailed DB pool table → /db-health
 *   - Full component health table → /live-monitor
 *   - Telemetry pipeline detail → /admin/telemetry/coverage
 *   - Compression stats → /backup
 */

import { useCallback, useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Database, ShieldCheck, Cpu, Server,
  HardDrive, Package, Clock, RefreshCw, Boxes,
} from 'lucide-react'

import { PageLayout, SourceContent, Masonry } from '@/components/layout'
import { Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { GlassPanel, Button, Badge, PanelTitle, SectionTitle, Text, Caption } from '@/components/ui'
import { KVList } from '@/components/data-display'
import { FadeIn } from '@/components/motion'
import {
  StatusHero, type HeroStatus,
  HealthRow, ResourcesPanel, type ResourceRow,
  ActionItemsPanel, ActionItem,
} from '@/components/status'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useSystemHealth, useBackupRuns, useBackupConfigs, useMaintenanceState } from '@/api/hooks/useAdmin'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useVehicles } from '@/api/hooks/useVehicles'
import {
  getVersionInfo, getExtendedHealth, checkForUpdates,
  getBackupStats, getWorkersHealth,
} from '@/api/devtools'

import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

import { formatUptime } from '../components/status/helpers'
import {
  AccordionSection,
  AnomalyInlineRow,
  BackgroundWorkersCard,
  TeslaAuthCard,
  TelemetryPipelineCard,
  UpdateAvailableCallout,
  StatusPageSkeleton,
  LiveStatusPill,
  IncidentsCard,
  IncidentHistory,
  ScheduledMaintenanceCard,
  SLOTrackingCard,
} from '../components/status'
import { useStatusLiveSSE } from '../hooks/useStatusLiveSSE'
import { AiSpendWatch } from '../components/status/AiSpendWatch'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

// Shared cadence
const STATUS_REFRESH_MS = 30_000
const UPDATE_CHECK_MS = 60 * 60 * 1_000  // hourly — backend caches GitHub for 1h
const STALE_BACKUP_DAYS = 7

export default function SystemStatusPage() {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  usePageTitle(t('systemStatus.title', 'System status'))
  const qc = useQueryClient()
  const location = useLocation()
  const operatorDetails = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const section = location.hash ? document.getElementById(location.hash.slice(1)) : null
    if (section && operatorDetails.current?.contains(section)) {
      operatorDetails.current.open = true
    }
  }, [location.hash])

  // ── data sources ────────────────────────────────────────────────
  const healthQuery = useSystemHealth()
  const {
    data: health,
    isLoading,
    isFetching,
    error,
    refetch: refetchHealth,
    dataUpdatedAt,
  } = healthQuery
  const healthState = useDataState(healthQuery, { provenance: 'live', maxAgeMs: 2 * 60_000 })

  // SSE drops polling cost when connected; useQuery polling remains the
  // offline fallback.
  const { state: liveState, lastUpdateAt: liveLastUpdate, reconnect: liveReconnect } = useStatusLiveSSE()

  const extendedQuery = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const versionQuery = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  })

  const updateQuery = useQuery({
    queryKey: ['system-status', 'update-check'],
    queryFn: checkForUpdates,
    refetchInterval: UPDATE_CHECK_MS,
    staleTime: UPDATE_CHECK_MS,
  })

  const backupStatsQuery = useQuery({
    queryKey: ['system-status', 'backup-stats'],
    queryFn: getBackupStats,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const workersQuery = useQuery({
    queryKey: ['system-status', 'workers'],
    queryFn: getWorkersHealth,
    refetchInterval: STATUS_REFRESH_MS,
  })


  const authQuery = useAuthStatus()
  const backupRunsQuery = useBackupRuns()
  const backupConfigsQuery = useBackupConfigs()
  const maintenanceQuery = useMaintenanceState()
  const vehiclesQuery = useVehicles()
  const extHealth = extendedQuery.data
  const version = versionQuery.data
  const updateCheck = updateQuery.data
  const backupStats = backupStatsQuery.data
  const workers = workersQuery.data
  const auth = authQuery.data
  const backupRuns = backupRunsQuery.data
  const backupConfigs = backupConfigsQuery.data
  const maintenance = maintenanceQuery.data
  const vehicles = vehiclesQuery.data
  const extendedState = useDataState(extendedQuery, { provenance: 'live' })
  const versionState = useDataState(versionQuery)
  const updateState = useDataState(updateQuery)
  const backupStatsState = useDataState(backupStatsQuery, { provenance: 'historical' })
  const workersState = useDataState(workersQuery, { provenance: 'live' })
  const authState = useDataState(authQuery)
  const backupRunsState = useDataState(backupRunsQuery, { provenance: 'historical' })
  const backupConfigsState = useDataState(backupConfigsQuery)
  const maintenanceState = useDataState(maintenanceQuery)
  const vehiclesState = useDataState(vehiclesQuery)
  const sourceStates = [
    { id: 'health', label: t('systemStatus.health', 'Health'), state: healthState, loading: healthQuery.isLoading },
    { id: 'extended', label: t('systemStatus.dbConnections', 'Database & connections'), state: extendedState, loading: extendedQuery.isLoading },
    { id: 'version', label: t('systemStatus.systemInfo', 'System info'), state: versionState, loading: versionQuery.isLoading },
    { id: 'update', label: t('systemStatus.updateCheck', 'Update check'), state: updateState, loading: updateQuery.isLoading },
    { id: 'backup-stats', label: t('systemStatus.backupStatistics', 'Backup statistics'), state: backupStatsState, loading: backupStatsQuery.isLoading },
    { id: 'workers', label: t('systemStatus.bgWorkers', 'Background workers'), state: workersState, loading: workersQuery.isLoading },
    { id: 'auth', label: t('systemStatus.teslaAuth', 'Tesla auth'), state: authState, loading: authQuery.isLoading },
    { id: 'backup-runs', label: t('systemStatus.backupHistory', 'Backup history'), state: backupRunsState, loading: backupRunsQuery.isLoading },
    { id: 'backup-configs', label: t('systemStatus.backupConfiguration', 'Backup configuration'), state: backupConfigsState, loading: backupConfigsQuery.isLoading },
    { id: 'maintenance', label: t('systemStatus.scheduledMaintenance', 'Scheduled maintenance'), state: maintenanceState, loading: maintenanceQuery.isLoading },
    { id: 'vehicles', label: t('systemStatus.vehicles', 'Vehicles'), state: vehiclesState, loading: vehiclesQuery.isLoading },
  ]

  // ── derived overall status ──────────────────────────────────────
  const overallStatus: HeroStatus = useMemo(() => {
    if (maintenance?.mode === 'maintenance') return 'maintenance'
    if (!health) return 'unknown'
    const s = health.status as string
    const componentStatuses = Object.values(health.components ?? {}).map((component) => resolveCompStatus(component.status))
    if (s === 'unhealthy' || s === 'down' || s === 'offline' || componentStatuses.includes('unhealthy')) return 'unhealthy'
    if (extHealth?.components?.database?.status === 'unhealthy' ||
        extHealth?.components?.database?.status === 'down' ||
        (workers && workers.total > 0 && workers.healthy_count === 0)) return 'unhealthy'
    if (s === 'degraded' || s === 'warning' ||
        componentStatuses.some((status) => status !== 'healthy') ||
        auth?.authenticated === false) return 'degraded'
    if (extHealth?.components?.database?.status === 'degraded' ||
        (workers && workers.healthy_count < workers.total && workers.healthy_count > 0)) return 'degraded'
    if (s === 'healthy' || s === 'ok') return 'healthy'
    return 'unknown'
  }, [health, maintenance, extHealth, workers, auth])

  // ── live "last checked" tick (drives the subline + sticky bar) ─
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(id)
  }, [])
  const lastCheckedLabel = useMemo(() => {
    if (!dataUpdatedAt) return undefined
    const secs = Math.max(0, Math.floor((now - dataUpdatedAt) / 1000))
    if (secs < 60) return t('systemStatus.pipelineTime.secondsAgo', '{{count}}s ago', { count: secs })
    if (secs < 3600) return t('systemStatus.summary.minutesAgo', '{{count}}m ago', { count: Math.floor(secs / 60) })
    return t('systemStatus.pipelineTime.hoursAgo', '{{count}}h ago', { count: Math.floor(secs / 3600) })
  }, [now, dataUpdatedAt, t])

  // ── refresh action ──────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    refetchHealth()
    qc.invalidateQueries({ queryKey: ['system-status'] })
    liveReconnect()
  }, [refetchHealth, qc, liveReconnect])

  // Keyboard shortcuts.
  // R = refresh, ? = help, J/K = jump to next/previous chip section.
  // Ignored when the user is typing in an input.
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(e.target)) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRefresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRefresh])

  // ── in-page scroll for Health rows (matches StickyChipBar logic) ─
  // The app's primary scroll container is <main id="main-content">.
  // window.scrollY is always 0 here, so we have to scroll that element
  // directly. We use a fixed ~64px offset for the sticky chip bar.
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const scrollEl = document.getElementById('main-content')
    if (scrollEl) {
      const elTop = el.getBoundingClientRect().top
      const containerTop = scrollEl.getBoundingClientRect().top
      const target = scrollEl.scrollTop + (elTop - containerTop) - 76
      scrollEl.scrollTo({ top: target, behavior: 'smooth' })
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  // ── derived metrics ─────────────────────────────────────────────
  const teslaTokenWarn = useMemo(() => {
    if (!auth?.expires_at) return null
    const exp = new Date(auth.expires_at).getTime()
    const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000))
    if (days < 0) return { severity: 'error' as const, days }
    if (days <= 7) return { severity: 'warn' as const, days }
    return null
  }, [auth, now])

  const lastSuccessfulBackup = useMemo(() => {
    if (!backupRuns) return null
    return backupRuns.find((r) => r.status === 'completed') ?? null
  }, [backupRuns])

  const backupStaleDays = useMemo(() => {
    if (!lastSuccessfulBackup?.completedAt) return null
    return Math.floor((now - new Date(lastSuccessfulBackup.completedAt).getTime()) / (24 * 60 * 60 * 1000))
  }, [lastSuccessfulBackup, now])

  // camelCaseKeys() in lib/resilience.ts adds both snake_case and camelCase
  // aliases to every response. For component listings we only want the
  // canonical snake_case keys; the camelCase aliases are pure duplicates
  // that contain at least one uppercase letter.
  const components = health
    ? Object.entries(health.components ?? {}).filter(([k]) => !/[A-Z]/.test(k))
    : []
  const okCount = components.filter(([, c]) => c.status === 'ok' || c.status === 'healthy').length
  const totalCount = components.length

  const extendedComponents = extHealth?.components
  const extendedDatabase = extendedComponents?.database
  const extendedPool = extendedComponents?.database_pool
  const extendedSystem = extendedComponents?.system
  const dbStatus: HeroStatus = extendedDatabase?.status
    ? resolveCompStatus(extendedDatabase.status)
    : 'unknown'
  const dbLatency = extendedDatabase?.latency_ms

  const teslaAuthStatus: HeroStatus =
    teslaTokenWarn?.severity === 'error' ? 'unhealthy'
    : teslaTokenWarn?.severity === 'warn' ? 'degraded'
    : auth?.authenticated === false ? 'unhealthy'
    : auth?.authenticated ? 'healthy'
    : 'unknown'

  const teslaAuthSummary =
    teslaTokenWarn?.severity === 'error' ? t('systemStatus.summary.tokenExpired', 'Token expired')
    : teslaTokenWarn?.severity === 'warn' ? t('systemStatus.summary.tokenExpires', 'Expires in {{days}}d', { days: teslaTokenWarn.days })
    : auth?.authenticated ? t('systemStatus.summary.connected', 'Connected')
    : auth?.authenticated === false ? t('systemStatus.summary.notConnected', 'Not connected')
    : t('systemStatus.pipelineStates.unknown', 'unknown')

  const totalRows = useMemo(() => {
    if (!backupStats?.row_counts) return null
    return Object.values(backupStats.row_counts).reduce((a, b) => a + (b ?? 0), 0)
  }, [backupStats])

  const positionCount = backupStats?.row_counts?.positions
  const drivesCount = backupStats?.row_counts?.drives
  const vehicleCount = vehicles?.length ?? 0

  const workersStatus: HeroStatus = workers
    ? workers.total === 0 ? 'unknown'
      : workers.healthy_count === workers.total
      ? 'healthy'
      : workers.healthy_count > 0
        ? 'degraded'
        : 'unhealthy'
    : 'unknown'


  // ── resources rows ──────────────────────────────────────────────
  const resourceRows: ResourceRow[] = useMemo(() => {
    const rows: ResourceRow[] = []

    if (extendedPool) {
      const acquired = extendedPool.acquired_conns
      const idle = extendedPool.idle_conns
      const total = extendedPool.total_conns
      const max = total != null && total > 0
        ? total
        : acquired != null && idle != null ? acquired + idle : null
      rows.push({
        label: t('systemStatus.resourcesCopy.dbConnections', 'DB connections'),
        valueText: acquired != null ? `${acquired}` : '—',
        metaText: max != null && max > 0 ? t('systemStatus.resourcesCopy.inUse', 'of {{count}} in use', { count: max }) : undefined,
        percent: acquired != null && max != null && max > 0 ? (acquired / max) * 100 : undefined,
        sourceState: extendedState,
        icon: <Database className="h-4 w-4" />,
      })
    }

    if (backupStats?.database_size) {
      rows.push({
        label: t('systemStatus.storageUsed', 'Storage used'),
        valueText: backupStats.database_size,
        sourceState: backupStatsState,
        metaText: backupStats.table_count != null ? t('systemStatus.resourcesCopy.tables', 'across {{count}} tables', { count: backupStats.table_count }) : undefined,
        icon: <HardDrive className="h-4 w-4" />,
      })
    }

    if (totalRows != null) {
      rows.push({
        label: t('systemStatus.totalRows', 'Total rows'),
        valueText: fmtInt(totalRows),
        sourceState: backupStatsState,
        metaText: positionCount != null && positionCount > 0 ? t('systemStatus.resourcesCopy.positions', '{{displayCount}} positions', { count: positionCount, displayCount: fmtInt(positionCount) }) : undefined,
        icon: <Boxes className="h-4 w-4" />,
      })
    }

    if (extendedSystem?.goroutines != null) {
      rows.push({
        label: t('systemStatus.resourcesCopy.runtimeThreads', 'Runtime threads'),
        valueText: fmtInt(extendedSystem.goroutines),
        sourceState: extendedState,
        metaText: t('systemStatus.resourcesCopy.goroutines', 'goroutines'),
        icon: <Cpu className="h-4 w-4" />,
      })
    }

    rows.push({
      label: t('systemStatus.workers', 'Workers'),
      valueText: workers ? `${workers.healthy_count ?? '—'} / ${workers.total ?? '—'}` : '—',
      metaText: t('systemStatus.statusLabels.healthy', 'healthy'),
      metricKind: 'healthy-workers',
      healthyCount: workers?.healthy_count ?? null,
      totalCount: workers?.total ?? null,
      sourceState: workersState,
      icon: <Server className="h-4 w-4" />,
    })

    if (version?.uptime_seconds != null && version.uptime_seconds > 0) {
      rows.push({
        label: t('systemStatus.resourcesCopy.uptime', 'Uptime'),
        valueText: formatUptime(version.uptime_seconds),
        sourceState: versionState,
        icon: <Clock className="h-4 w-4" />,
      })
    } else if (extendedSystem?.uptime_seconds != null) {
      rows.push({
        label: t('systemStatus.resourcesCopy.uptime', 'Uptime'),
        valueText: formatUptime(extendedSystem.uptime_seconds),
        sourceState: extendedState,
        icon: <Clock className="h-4 w-4" />,
      })
    }

    return rows
  }, [
    backupStats,
    backupStatsState,
    extendedPool,
    extendedSystem,
    extendedState,
    positionCount,
    totalRows,
    version,
    versionState,
    workers, workersState, fmtInt, t,
  ])

  // Action item flags
  const hasUpdate = updateCheck?.update_available === true
  const hasStaleBackup = backupStaleDays != null && backupStaleDays > STALE_BACKUP_DAYS
  const hasNoBackup = backupRuns != null && backupRuns.length === 0 && (backupConfigs?.length ?? 0) > 0
  const hasMaintenance = maintenance?.mode === 'maintenance'
  const hasAttention = hasMaintenance || hasUpdate || hasStaleBackup || hasNoBackup ||
    teslaTokenWarn != null || auth?.authenticated === false ||
    (workers != null && workers.healthy_count < workers.total)

  // Health staleness — surface in hero subline if /health errored or
  // we haven't received fresh data in over 2 minutes.
  const healthStale = !!error || (dataUpdatedAt > 0 && now - dataUpdatedAt > 2 * 60_000)
  const heroSubline = error
    ? t('systemStatus.summary.healthFailed', 'Health check failed — {{error}}', { error: error instanceof Error ? error.message : String(error) })
    : healthStale
      ? t('systemStatus.summary.checkedStale', 'Last checked {{time}} (stale)', { time: lastCheckedLabel ?? t('systemStatus.pipelineStates.unknown', 'unknown') })
      : lastCheckedLabel
        ? t('systemStatus.summary.checked', 'Last checked {{time}}', { time: lastCheckedLabel })
        : t('systemStatus.summary.awaitingCheck', 'Awaiting first check')

  // Health-row contextual summaries
  const servicesSummary =
    totalCount === 0
      ? t('systemStatus.summary.noData', 'no data')
      : t('systemStatus.summary.healthy', '{{healthy}} / {{total}} healthy', { healthy: okCount, total: totalCount })
  const databaseSummary =
    dbLatency != null
      ? `${Math.round(dbLatency)}ms · ${backupStats?.database_size ?? '—'}`
      : backupStats?.database_size ?? (dbStatus === 'unknown'
        ? t('systemStatus.pipelineStates.unknown', 'unknown')
        : t('systemStatus.summary.databaseConnected', 'connected'))
  const telemetrySummary =
    vehicleCount > 0
      ? vehicleCount === 1
        ? t('systemStatus.summary.vehicleTelemetry', '{{count}} vehicle · {{positions}} positions', { count: vehicleCount, positions: positionCount != null ? fmtInt(positionCount) : '—' })
        : t('systemStatus.summary.vehiclesTelemetry', '{{count}} vehicles · {{positions}} positions', { count: vehicleCount, positions: positionCount != null ? fmtInt(positionCount) : '—' })
      : t('systemStatus.telemetryUnknown', 'No vehicle telemetry to assess')
  const workersSummary =
    workers
      ? t('systemStatus.summary.healthy', '{{healthy}} / {{total}} healthy', { healthy: workers.healthy_count, total: workers.total })
      : t('systemStatus.pipelineStates.unknown', 'unknown')

  return (
    <PageLayout
      title={t('systemStatus.title', 'System status')}
      subtitle={t('systemStatus.subtitle', 'At-a-glance health for your TeslaSync instance')}
      loading={false}
      error={null}
      metadataActions={<LiveStatusPill state={liveState} lastUpdateAt={liveLastUpdate} now={now} />}
      secondaryActions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-2"
            aria-label={t('systemStatus.refreshAria', 'Refresh (r)')}
            aria-busy={isFetching}
            title={t('systemStatus.refreshHint', 'Press r to refresh')}
            wrapLabel
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      }
    >
      {sourceStates.filter(({ state }) => state.status !== 'ok').map(({ id, label, state, loading }) => (
        <div key={id}>
          <StaleRefreshWarning state={state} label={label} />
          {(state.fatalError || !state.hasData) && (
            <SourceContent
              state={state.fatalError ? 'error' : loading ? 'loading' : 'empty'}
              label={label}
              emptyMessage={t('systemStatus.sourceUnavailable', '{{label}} is unavailable.', { label })}
              errorMessage={t('systemStatus.sourceLoadError', 'Unable to load {{label}}.', { label })}
              error={state.fatalError}
              errorRecovery={state.retry ? { onRetry: state.retry } : undefined}
              loadingContent={<Skeleton height={16} className="max-w-sm" />}
            >
              {null}
            </SourceContent>
          )}
        </div>
      ))}
      {/* Print stylesheet — clean printable status snapshot.
          Hides interactive scaffolding, expands accordions, drops the
          frosted-glass background for paper. */}
      <style>{`
        @media print {
          [data-status-print-hide] { display: none !important; }
          [data-status-accordion] details { open: true; }
          [data-status-accordion] summary svg { display: none; }
          .glass-panel, [class*="bg-white/"], [class*="bg-black/"] {
            background: #fff !important; color: #000 !important;
            box-shadow: none !important; backdrop-filter: none !important;
          }
          body, html { background: #fff !important; color: #000 !important; }
        }
      `}</style>

      {isLoading && !healthState.hasData ? (
        <StatusPageSkeleton />
      ) : (
        <>
          <div className="space-y-6 [&_section]:scroll-mt-24">
            {/* 1 ─ Hero ───────────────────────────────────────────── */}
            <FadeIn>
              <StatusHero
                id="status-hero"
                status={healthStale ? 'unknown' : overallStatus}
                subline={heroSubline}
                cta={{ label: t('systemStatus.runHealthCheck', 'Run health check'), onClick: handleRefresh, loading: isFetching }}
              />
            </FadeIn>

            {/* 1b ─ Update available callout (in-page) ───────────── */}
            {hasUpdate && (
              <FadeIn>
                <UpdateAvailableCallout
                  current={updateCheck?.current}
                  latest={updateCheck?.latest}
                  checkedAt={updateCheck?.checked_at}
                />
              </FadeIn>
            )}

            {/* 1c ─ Active incidents (only when present) ─────────── */}
            <FadeIn>
              <IncidentsCard now={now} />
            </FadeIn>

            <AiSpendWatch />

            <FadeIn>
              <section id="services" aria-label={t('systemStatus.currentComponents', 'Current component status')}>
                <GlassPanel className="p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <SectionTitle>{t('systemStatus.currentComponents', 'Current component status')}</SectionTitle>
                    <DetailLink to="/live-monitor" label={t('systemStatus.openLiveMonitor', 'Open live monitor')} />
                  </div>
                  {components.length > 0 ? (
                    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {components.map(([name, comp]) => (
                        <li key={name} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
                          <Text size="sm" weight="medium" color="primary" className="min-w-0 break-words">{name}</Text>
                          <StatusBadge status={resolveCompStatus(comp.status)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text as="p" variant="bodySm">{t('systemStatus.noComponents', 'Current component status is unavailable.')}</Text>
                  )}
                </GlassPanel>
              </section>
            </FadeIn>

            {hasAttention && (
              <FadeIn>
                <section id="action-items" aria-label={t('systemStatus.actionItems', 'Operator action items')}>
                  <ActionItemsPanel title={t('systemStatus.needsAttention', 'Needs your attention')}>
                    {hasMaintenance && (
                      <ActionItem
                        severity="info"
                        title={t('systemStatus.maintActive', 'Maintenance mode is active')}
                        description={maintenance?.maintenance_message || t('systemStatus.maintActiveDesc', 'System is in operator-set maintenance mode')}
                        cta={{ label: t('systemStatus.manage', 'Manage'), to: '/system-status#maintenance' }}
                      />
                    )}
                    {hasUpdate && (
                      <ActionItem
                        severity="info"
                        title={t('systemStatus.updateAvailable', 'Update available — v{{version}}', { version: updateCheck?.latest })}
                        description={t('systemStatus.updateCurrent', 'Current: v{{current}}', { current: updateCheck?.current })}
                        cta={{
                          label: t('systemStatus.releaseNotes', 'Release notes'),
                          to: 'https://github.com/ev-dev-labs/teslasync/releases/latest',
                          external: true,
                        }}
                      />
                    )}
                    {teslaTokenWarn?.severity === 'error' && (
                      <ActionItem
                        severity="error"
                        title={t('systemStatus.tokenExpired', 'Tesla token expired')}
                        description={t('systemStatus.tokenExpiredDesc', 'Sign in again to resume Tesla-backed features')}
                        cta={{ label: t('systemStatus.reauthenticate', 'Re-authenticate'), to: '/tesla-account' }}
                      />
                    )}
                    {teslaTokenWarn?.severity === 'warn' && (
                      <ActionItem
                        severity="warn"
                        title={t('systemStatus.tokenExpires', 'Tesla token expires in {{days}} day(s)', { days: teslaTokenWarn.days })}
                        description={t('systemStatus.tokenExpiresDesc', 'Refresh to avoid disruption')}
                        cta={{ label: t('systemStatus.reauthenticate', 'Re-authenticate'), to: '/tesla-account' }}
                      />
                    )}
                    {auth?.authenticated === false && !teslaTokenWarn && (
                      <ActionItem
                        severity="warn"
                        title={t('systemStatus.tokenNotConnected', 'Tesla account not connected')}
                        description={t('systemStatus.tokenNotConnectedDesc', 'Connect your Tesla account to fetch vehicle data')}
                        cta={{ label: t('systemStatus.connect', 'Connect'), to: '/tesla-account' }}
                      />
                    )}
                    {hasStaleBackup && (
                      <ActionItem
                        severity="warn"
                        title={t('systemStatus.backupStale', 'Last backup is {{days}} days old', { days: backupStaleDays })}
                        description={t('systemStatus.backupStaleDesc', 'Run a backup or check the schedule')}
                        cta={{ label: t('systemStatus.manageBackups', 'Manage backups'), to: '/backup' }}
                      />
                    )}
                    {hasNoBackup && (
                      <ActionItem
                        severity="warn"
                        title={t('systemStatus.noBackups', 'No backups recorded')}
                        description={t('systemStatus.noBackupsDesc', 'Configure a schedule or run one now')}
                        cta={{ label: t('systemStatus.setupBackups', 'Set up backups'), to: '/backup' }}
                      />
                    )}
                    {workers && workers.healthy_count < workers.total && (
                      <ActionItem
                        severity="error"
                        title={t('systemStatus.summary.unhealthyWorkers', '{{down}} of {{total}} workers unhealthy', {
                          down: workers.total - workers.healthy_count,
                          total: workers.total,
                        })}
                        description={(workers.workers || [])
                          .filter((w) => w.status !== 'healthy')
                          .map((w) => w.name)
                          .join(', ')}
                      />
                    )}
                  </ActionItemsPanel>
                </section>
              </FadeIn>
            )}

            <FadeIn>
              <section id="incidents" aria-label={t('systemStatus.incidentHistory.title', 'Recent incidents')}>
                <IncidentHistory />
              </section>
            </FadeIn>

            <details ref={operatorDetails} id="operator-details" className="group rounded-panel border border-[var(--glass-border)] bg-[var(--surface-1)]">
              <summary className="cursor-pointer px-4 py-4 text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:px-5">
                <Text as="span" weight="semibold">{t('systemStatus.operatorDetails', 'Operator diagnostics')}</Text>
                <Caption className="ms-2">{t('systemStatus.operatorDetailsHint', 'Resources, workers, telemetry, maintenance and system details')}</Caption>
              </summary>
              <div className="space-y-6 border-t border-[var(--glass-border)] p-4 sm:p-5">
            {/* ══ Band A ─ Health & triage (full-width bento) ══════════ */}
            <FadeIn>
              <section aria-labelledby="triage-heading" className="space-y-3">
                <SectionTitle id="triage-heading" className="px-1">
                  {t('systemStatus.healthTriage', 'Health & triage')}
                </SectionTitle>
                <Masonry className="columns-1 lg:columns-2 xl:columns-3">

            {/* 3 ─ Health rows ─────────────────────────────────────── */}
            <section id="health" aria-label={t('systemStatus.healthSummary', 'Health summary')}>
              <GlassPanel className="h-full p-4 sm:p-5">
                <PanelTitle className="mb-3">
                  {t('systemStatus.health', 'Health')}
                </PanelTitle>
                <div className="space-y-1">
                  <HealthRow
                    status={totalCount === 0 ? 'unknown' : okCount === totalCount ? 'healthy' : okCount > totalCount / 2 ? 'degraded' : 'unhealthy'}
                    icon={<Server className="h-4 w-4" />}
                    label={t('systemStatus.services', 'Services')}
                    summary={servicesSummary}
                    onClick={() => scrollToSection('services')}
                  />
                  <HealthRow
                    status={dbStatus}
                    icon={<Database className="h-4 w-4" />}
                    label={t('systemStatus.database', 'Database')}
                    summary={databaseSummary}
                    onClick={() => scrollToSection('database')}
                  />
                  <HealthRow
                    status={resolveCompStatus(health?.components?.telemetry?.status ?? 'unknown')}
                    icon={<Activity className="h-4 w-4" />}
                    label={t('systemStatus.telemetry', 'Telemetry')}
                    summary={telemetrySummary}
                    onClick={() => scrollToSection('telemetry')}
                  />
                  <HealthRow
                    status={workersStatus}
                    icon={<Boxes className="h-4 w-4" />}
                    label={t('systemStatus.workers', 'Workers')}
                    summary={workersSummary}
                    onClick={() => scrollToSection('workers')}
                  />
                  {/* Anomaly row — renders only when anomalies_last_24h > 0 */}
                  <AnomalyInlineRow />
                  <HealthRow
                    status={teslaAuthStatus}
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label={t('systemStatus.teslaAuth', 'Tesla auth')}
                    summary={teslaAuthSummary}
                    onClick={() => scrollToSection('tesla-auth')}
                  />
                </div>
              </GlassPanel>
            </section>

        {/* 5 ─ Resources ───────────────────────────────────────── */}
        <section id="resources" aria-label={t('systemStatus.resourcesCopy.title', 'Server resources')}>
          <ResourcesPanel
            rows={resourceRows}
            title={t('systemStatus.resourcesCopy.title', 'Server resources')}
          />
        </section>

                </Masonry>
              </section>
            </FadeIn>

            {/* ══ Band B ─ Systems & services (accordion bento) ═══════ */}
            <FadeIn>
              <section aria-labelledby="systems-heading" className="space-y-3">
                <SectionTitle id="systems-heading" className="px-1">
                  {t('systemStatus.systemsServices', 'Systems & services')}
                </SectionTitle>
                <Masonry className="columns-1 xl:columns-2 2xl:columns-3">

        {/* 7 ─ Database ───────────────────────────────────────── */}
        <section id="database">
          <AccordionSection
            icon={<Database className="h-5 w-5" />}
            title={t('systemStatus.dbConnections', 'Database & connections')}
            description={databaseSummary}
            defaultOpen
            badges={<StatusBadge status={dbStatus} />}
          >
            <DefList
              rows={[
                { label: t('systemStatus.latency', 'Latency'), value: dbLatency != null ? `${Math.round(dbLatency)}ms` : '—' },
                { label: t('systemStatus.poolAcquired', 'Pool acquired'), value: extendedPool ? `${extendedPool.acquired_conns} / ${extendedPool.total_conns || (extendedPool.acquired_conns + extendedPool.idle_conns)}` : '—' },
                { label: t('systemStatus.poolIdle', 'Pool idle'), value: extendedPool ? String(extendedPool.idle_conns) : '—' },
                { label: t('systemStatus.storageUsed', 'Storage used'), value: backupStats?.database_size ?? '—' },
                { label: t('systemStatus.tables', 'Tables'), value: backupStats?.table_count != null ? String(backupStats.table_count) : '—' },
                { label: t('systemStatus.totalRows', 'Total rows'), value: totalRows != null ? fmtInt(totalRows) : '—' },
              ]}
            />
            <DetailLink to="/db-health" label={t('systemStatus.openDbHealth', 'Open DB health')} />
          </AccordionSection>
        </section>

        {/* 8 ─ Telemetry ──────────────────────────────────────── */}
        <section id="telemetry">
          <AccordionSection
            icon={<Activity className="h-5 w-5" />}
            title={t('systemStatus.telemetryPipeline', 'Telemetry pipeline')}
            description={telemetrySummary}
            defaultOpen
          >
            <TelemetryPipelineCard
              vehicles={vehicles}
              positionCount={positionCount}
              drivesCount={drivesCount}
              chargingSessionsCount={backupStats?.row_counts?.charging_sessions}
              signalLogCount={backupStats?.row_counts?.signal_log}
              now={now}
              retained={(vehiclesState.hasData && vehiclesQuery.isError) || (backupStatsState.hasData && backupStatsQuery.isError)}
            />
          </AccordionSection>
        </section>

        {/* 8b ─ Tesla auth (dedicated card) ─────────────────────── */}
        <section id="tesla-auth" aria-label={t('systemStatus.authAria', 'Tesla account authentication')}>
          <TeslaAuthCard
            authenticated={auth?.authenticated}
            expiresAt={auth?.expires_at}
            now={now}
          />
        </section>

        {/* 9 ─ Workers ────────────────────────────────────────── */}
        <section id="workers">
          <AccordionSection
            icon={<Boxes className="h-5 w-5" />}
            title={t('systemStatus.bgWorkers', 'Background workers')}
            description={workersSummary}
            defaultOpen
            badges={<StatusBadge status={workersStatus} />}
          >
            <BackgroundWorkersCard health={workers}
              retained={workersState.hasData && workersQuery.isError}
              loading={workersQuery.isLoading && !workersState.hasData} />
          </AccordionSection>
        </section>

        {/* 10 ─ System info ────────────────────────────────────── */}
        <section id="system">
          <AccordionSection
            icon={<Package className="h-5 w-5" />}
            title={t('systemStatus.systemInfo', 'System info')}
            description={t('systemStatus.systemInfoDesc', 'Version, build, runtime')}
            defaultOpen
          >
            <SystemInfoRows version={version} system={extendedSystem} loading={versionQuery.isLoading && !versionState.hasData} />
          </AccordionSection>
        </section>

                </Masonry>
              </section>
            </FadeIn>

            {/* ══ Band C ─ Reliability & history (full-width) ═════════ */}
            <FadeIn>
              <section aria-labelledby="reliability-heading" className="space-y-3">
                <SectionTitle id="reliability-heading" className="px-1">
                  {t('systemStatus.reliabilityHistory', 'Reliability & history')}
                </SectionTitle>

                <Masonry className="columns-1 lg:columns-2">
                  {/* 13 ─ SLO tracking ────────────────────────────── */}
                  <section id="slo" aria-label={t('systemStatus.sloTracking', 'Personal SLO tracking')}>
                    <SLOTrackingCard />
                  </section>

                  {/* 14 ─ Scheduled maintenance ───────────────────── */}
                  <section id="maintenance" aria-label={t('systemStatus.scheduledMaintenance', 'Scheduled maintenance')}>
                    <ScheduledMaintenanceCard now={now} />
                  </section>

                </Masonry>

              </section>
            </FadeIn>

              </div>
            </details>

            {/* Footer ─ Status API docs link ──────────────────────── */}
            <section id="api-docs" aria-label={t('systemStatus.statusApi', 'Status API')}>
              <div className={cn('flex justify-center pt-1 pb-4', typography.size.xs, typography.color.muted)} data-status-print-hide>
                <Link
                  to="/docs/status-api"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-white/[0.03] px-3 py-1.5 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                >
                  {t('systemStatus.stableStatusApi', 'Stable status API for your own dashboards')} →
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </PageLayout>
  )
}

// ── Local helper components ───────────────────────────────────────

function StatusBadge({ status }: { status: HeroStatus }) {
  const { t } = useTranslation()
  const labels: Record<HeroStatus, string> = {
    healthy: t('systemStatus.statusLabels.healthy', 'healthy'),
    degraded: t('systemStatus.statusLabels.degraded', 'degraded'),
    unhealthy: t('systemStatus.statusLabels.down', 'down'),
    maintenance: t('systemStatus.statusLabels.maintenance', 'maintenance'),
    unknown: t('systemStatus.pipelineStates.unknown', 'unknown'),
  }
  const variants: Record<HeroStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
    healthy: 'success', degraded: 'warning', unhealthy: 'danger', maintenance: 'info', unknown: 'neutral',
  }
  return (
    <Badge variant={variants[status]} dot className="shrink-0 whitespace-normal">
      {labels[status]}
    </Badge>
  )
}

function resolveCompStatus(s: string): HeroStatus {
  if (s === 'healthy' || s === 'ok') return 'healthy'
  if (s === 'degraded' || s === 'warning') return 'degraded'
  if (s === 'unhealthy' || s === 'down' || s === 'offline' || s === 'failed') return 'unhealthy'
  return 'unknown'
}

function DetailLink({ to, label }: { to: string; label: string }) {
  return (
    <div className="flex justify-end pt-2">
      <Link
        to={to}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-2 text-cyan-300 ring-1 ring-cyan-400/30 transition-colors hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
          typography.size.xs,
          typography.weight.medium,
        )}
      >
        {label}
      </Link>
    </div>
  )
}

interface DefListRow { label: string; value: ReactNode }
function DefList({ rows }: { rows: DefListRow[] }) {
  return <KVList items={rows} layout="responsive" wrap className="tabular-nums" />
}

// ── Helper: system info rows ────────────────────────────────────────
function SystemInfoRows({
  version,
  system,
  loading,
}: {
  version?: { app_version: string; chart_version: string; go_version: string; os: string; arch: string; uptime_seconds: number }
  system?: { goroutines: number; uptime_seconds: number; go_version: string }
  loading: boolean
}) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()

  const rows: DefListRow[] = [
    { label: t('systemStatus.systemInfoCopy.appVersion', 'App version'), value: version?.app_version ?? '—' },
    { label: t('systemStatus.systemInfoCopy.chartVersion', 'Chart version'), value: version?.chart_version ?? '—' },
    { label: t('systemStatus.systemInfoCopy.goRuntime', 'Go runtime'), value: version?.go_version ?? '—' },
    { label: t('systemStatus.systemInfoCopy.platform', 'OS / arch'), value: version ? `${version.os}/${version.arch}` : '—' },
    { label: t('systemStatus.resourcesCopy.uptime', 'Uptime'), value: version ? formatUptime(version.uptime_seconds) : '—' },
  ]
  if (system?.goroutines != null) {
    rows.push({ label: t('systemStatus.systemInfoCopy.goroutines', 'Goroutines'), value: fmtInt(system.goroutines) })
  }

  return (
    <>
      {!version && <Text as="p" variant="caption" role={loading ? 'status' : undefined}>
        {loading
          ? t('systemStatus.systemInfoCopy.loading', 'Loading system info…')
          : t('systemStatus.systemInfoCopy.unavailable', 'System info is unavailable.')}
      </Text>}
      <DefList rows={rows} />
    </>
  )
}
