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

import { PageContainer, Masonry } from '@/components/layout'
import { GlassPanel, Button, PanelTitle, SectionTitle, Text, Caption } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import {
  StatusHero, type HeroStatus,
  HealthRow, ResourcesPanel, type ResourceRow,
  ActionItemsPanel, ActionItem,
} from '@/components/status'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSystemHealth, useBackupRuns, useBackupConfigs, useMaintenanceState } from '@/api/hooks/useAdmin'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useVehicles } from '@/api/hooks/useVehicles'
import {
  getVersionInfo, getExtendedHealth, checkForUpdates,
  getBackupStats, getWorkersHealth,
} from '@/api/devtools'
import { fmtInt } from '@/lib/numberFormat'
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

// Shared cadence
const STATUS_REFRESH_MS = 30_000
const UPDATE_CHECK_MS = 60 * 60 * 1_000  // hourly — backend caches GitHub for 1h
const STALE_BACKUP_DAYS = 7

export default function SystemStatusPage() {
  const { t } = useTranslation()
  usePageTitle(t('systemStatus.title', 'System Status'))
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
  const {
    data: health,
    isLoading,
    isFetching,
    error,
    refetch: refetchHealth,
    dataUpdatedAt,
  } = useSystemHealth()

  // SSE drops polling cost when connected; useQuery polling remains the
  // offline fallback.
  const { state: liveState, lastUpdateAt: liveLastUpdate, reconnect: liveReconnect } = useStatusLiveSSE()

  const { data: extHealth } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  })

  const { data: updateCheck } = useQuery({
    queryKey: ['system-status', 'update-check'],
    queryFn: checkForUpdates,
    refetchInterval: UPDATE_CHECK_MS,
    staleTime: UPDATE_CHECK_MS,
  })

  const { data: backupStats } = useQuery({
    queryKey: ['system-status', 'backup-stats'],
    queryFn: getBackupStats,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const { data: workers } = useQuery({
    queryKey: ['system-status', 'workers'],
    queryFn: getWorkersHealth,
    refetchInterval: STATUS_REFRESH_MS,
  })


  const { data: auth } = useAuthStatus()
  const { data: backupRuns } = useBackupRuns()
  const { data: backupConfigs } = useBackupConfigs()
  const { data: maintenance } = useMaintenanceState()
  const { data: vehicles } = useVehicles()

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
    if (secs < 60) return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
  }, [now, dataUpdatedAt])

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
    teslaTokenWarn?.severity === 'error' ? 'Token expired'
    : teslaTokenWarn?.severity === 'warn' ? `Expires in ${teslaTokenWarn.days}d`
    : auth?.authenticated ? 'Connected'
    : 'Not connected'

  const totalRows = useMemo(() => {
    if (!backupStats?.row_counts) return 0
    return Object.values(backupStats.row_counts).reduce((a, b) => a + (b ?? 0), 0)
  }, [backupStats])

  const positionCount = backupStats?.row_counts?.positions ?? 0
  const drivesCount = backupStats?.row_counts?.drives ?? 0
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
      const acquired = extendedPool.acquired_conns ?? 0
      const idle = extendedPool.idle_conns ?? 0
      const total = extendedPool.total_conns ?? 0
      const max = total > 0 ? total : acquired + idle
      rows.push({
        label: 'DB connections',
        valueText: `${acquired}`,
        metaText: max > 0 ? `of ${max} in use` : undefined,
        percent: max > 0 ? (acquired / max) * 100 : undefined,
        icon: <Database className="h-4 w-4" />,
      })
    }

    if (backupStats?.database_size) {
      rows.push({
        label: 'Storage used',
        valueText: backupStats.database_size,
        metaText: backupStats.table_count != null ? `across ${backupStats.table_count} tables` : undefined,
        icon: <HardDrive className="h-4 w-4" />,
      })
    }

    if (totalRows > 0) {
      rows.push({
        label: 'Total rows',
        valueText: fmtInt(totalRows),
        metaText: positionCount > 0 ? `${fmtInt(positionCount)} positions` : undefined,
        icon: <Boxes className="h-4 w-4" />,
      })
    }

    if (extendedSystem?.goroutines != null) {
      rows.push({
        label: 'Runtime threads',
        valueText: fmtInt(extendedSystem.goroutines),
        metaText: 'goroutines',
        icon: <Cpu className="h-4 w-4" />,
      })
    }

    if (workers) {
      rows.push({
        label: 'Workers',
        valueText: `${workers.healthy_count} / ${workers.total}`,
        metaText: 'healthy',
        percent: workers.total > 0 ? (workers.healthy_count / workers.total) * 100 : undefined,
        icon: <Server className="h-4 w-4" />,
      })
    }

    if (version?.uptime_seconds != null && version.uptime_seconds > 0) {
      rows.push({
        label: 'Uptime',
        valueText: formatUptime(version.uptime_seconds),
        icon: <Clock className="h-4 w-4" />,
      })
    } else if (extendedSystem?.uptime_seconds != null) {
      rows.push({
        label: 'Uptime',
        valueText: formatUptime(extendedSystem.uptime_seconds),
        icon: <Clock className="h-4 w-4" />,
      })
    }

    return rows
  }, [
    backupStats,
    extendedPool,
    extendedSystem,
    positionCount,
    totalRows,
    version,
    workers,
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
    ? `Health check failed — ${error instanceof Error ? error.message : String(error)}`
    : healthStale
      ? `Last checked ${lastCheckedLabel ?? 'unknown'} (stale)`
      : lastCheckedLabel
        ? `Last checked ${lastCheckedLabel}`
        : 'Awaiting first check'

  // Health-row contextual summaries
  const servicesSummary =
    totalCount === 0 ? 'no data' : `${okCount} / ${totalCount} healthy`
  const databaseSummary =
    dbLatency != null
      ? `${Math.round(dbLatency)}ms · ${backupStats?.database_size ?? '—'}`
      : backupStats?.database_size ?? 'connected'
  const telemetrySummary =
    vehicleCount > 0
      ? `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} · ${fmtInt(positionCount)} positions`
      : t('systemStatus.telemetryUnknown', 'No vehicle telemetry to assess')
  const workersSummary =
    workers
      ? `${workers.healthy_count} / ${workers.total} healthy`
      : 'unknown'

  return (
    <PageContainer
      title={t('systemStatus.title', 'System Status')}
      subtitle={t('systemStatus.subtitle', 'At-a-glance health for your TeslaSync instance')}
      loading={false}
      error={null}
      actions={
        <div className="flex items-center gap-2">
          <LiveStatusPill state={liveState} lastUpdateAt={liveLastUpdate} now={now} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-2"
            aria-label={t('systemStatus.refreshAria', 'Refresh (R)')}
            aria-busy={isFetching}
            title="Press R to refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      }
    >
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

      {isLoading ? (
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
                    <DetailLink to="/live-monitor" label={t('systemStatus.openLiveMonitor', 'Open Live Monitor')} />
                  </div>
                  {components.length > 0 ? (
                    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {components.map(([name, comp]) => (
                        <li key={name} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
                          <Text size="sm" weight="medium" color="primary" className="min-w-0 truncate">{name}</Text>
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
                        title={t('{{down}} of {{total}} workers unhealthy', {
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
                <Caption className="ml-2">{t('systemStatus.operatorDetailsHint', 'Resources, workers, telemetry, maintenance and system details')}</Caption>
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
        <section id="resources" aria-label="Server resources">
          <ResourcesPanel
            rows={resourceRows}
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
                { label: t('systemStatus.totalRows', 'Total rows'), value: totalRows > 0 ? fmtInt(totalRows) : '—' },
              ]}
            />
            <DetailLink to="/db-health" label={t('systemStatus.openDbHealth', 'Open DB Health')} />
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
            />
          </AccordionSection>
        </section>

        {/* 8b ─ Tesla auth (dedicated card) ─────────────────────── */}
        <section id="tesla-auth" aria-label="Tesla account authentication">
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
            <BackgroundWorkersCard health={workers} />
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
            <SystemInfoRows version={version} system={extendedSystem} />
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
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.03] px-3 py-1.5 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                >
                  {t('systemStatus.stableStatusApi', 'Stable Status API for your own dashboards')} →
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </PageContainer>
  )
}

// ── Local helper components ───────────────────────────────────────

const DOT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy:     'bg-green-400',
  degraded:    'bg-amber-400',
  unhealthy:   'bg-red-400',
  unknown:     'bg-zinc-400',
  maintenance: 'bg-blue-400',
}

const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy:     'text-green-300',
  degraded:    'text-amber-300',
  unhealthy:   'text-red-300',
  unknown:     'text-zinc-300',
  maintenance: 'text-blue-300',
}

function StatusDot({ status }: { status: HeroStatus }) {
  return <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', DOT_FOR_STATUS[status])} aria-hidden />
}

function StatusBadge({ status }: { status: HeroStatus }) {
  const label =
    status === 'healthy' ? 'healthy'
    : status === 'degraded' ? 'degraded'
    : status === 'unhealthy' ? 'down'
    : status === 'maintenance' ? 'maintenance'
    : 'unknown'
  return (
    <Text as="span" size="xs" className={cn('inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5', TEXT_FOR_STATUS[status])}>
      <StatusDot status={status} />
      {label}
    </Text>
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
          'inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-2 text-cyan-200 ring-1 ring-cyan-400/30 transition-colors hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
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
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2">
          <Text as="dt" size="sm" color="secondary">{r.label}</Text>
          <Text as="dd" size="sm" weight="medium" color="primary" className="tabular-nums">{r.value}</Text>
        </div>
      ))}
    </dl>
  )
}

// ── Helper: system info rows ────────────────────────────────────────
function SystemInfoRows({
  version,
  system,
}: {
  version?: { app_version: string; chart_version: string; go_version: string; os: string; arch: string; uptime_seconds: number }
  system?: { goroutines: number; uptime_seconds: number; go_version: string }
}) {
  if (!version) {
    return <Text as="div" size="sm" color="muted">Loading system info…</Text>
  }

  const rows: DefListRow[] = [
    { label: 'App version', value: version.app_version },
    { label: 'Chart version', value: version.chart_version },
    { label: 'Go runtime', value: version.go_version },
    { label: 'OS / arch', value: `${version.os}/${version.arch}` },
    { label: 'Uptime', value: formatUptime(version.uptime_seconds) },
  ]
  if (system?.goroutines != null) {
    rows.push({ label: 'Goroutines', value: fmtInt(system.goroutines) })
  }

  return <DefList rows={rows} />
}
