/**
 * SystemStatusPage — operator-grade health dashboard.
 *
 * Mobile-first single-column layout; answers in <5 seconds:
 *   1. Is my instance healthy?           — StatusHero
 *   2. If not, what's broken?            — Health rows + Action items
 *   3. What do I need to do?             — ActionItemsPanel CTAs
 *
 * Phase 1.5: Pulls live data from existing backend endpoints so every
 *   accordion shows real values (DB size, vehicle count, worker
 *   health, Tesla API spend, error counts, backup recency) instead of
 *   the generic "Operational" stub the first cut shipped with.
 *
 * Heavy panels that duplicated other pages remain link-outs to:
 *   - Detailed DB pool table → /db-health
 *   - Full component health table → /live-monitor
 *   - Audit log table → /notifications
 *   - Telemetry pipeline detail → /admin/telemetry/coverage
 *   - Compression stats → /backup
 */

import { useCallback, useMemo, useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Database, Bell, ShieldCheck, Cpu, Server,
  HardDrive, Package, Clock, RefreshCw, Boxes, Zap, AlertTriangle,
  Car, Inbox,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, Badge } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import {
  StatusHero, type HeroStatus,
  StickyChipBar, StickyCompactHero,
  HealthRow, ResourcesPanel, type ResourceRow,
  ActionItemsPanel, ActionItem,
  UptimeHeatmap, type UptimeDay,
} from '@/components/status'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSystemHealth, useBackupRuns, useBackupConfigs, useMaintenanceState } from '@/api/hooks/useAdmin'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useNotificationStats } from '@/api/hooks/useNotifications'
import { useVehicles } from '@/api/hooks/useVehicles'
import {
  getVersionInfo, getExtendedHealth, checkForUpdates,
  getBackupStats, getWorkersHealth, getAPIUsage, getErrorStats,
} from '@/api/devtools'
import { formatBytes } from '@/lib/numberFormat'
import { cn } from '@/lib/cn'

import { formatUptime } from '../components/status/helpers'
import { AccordionSection } from '../components/status'
import { DiagnosticsSection } from '../components/status'

// Shared cadence
const STATUS_REFRESH_MS = 30_000
const UPDATE_CHECK_MS = 60 * 60 * 1_000  // hourly — backend caches GitHub for 1h
const STALE_BACKUP_DAYS = 7

export default function SystemStatusPage() {
  const { t } = useTranslation()
  usePageTitle(t('System Status'))
  const qc = useQueryClient()

  // ── data sources ────────────────────────────────────────────────
  const {
    data: health,
    isLoading,
    error,
    refetch: refetchHealth,
    dataUpdatedAt,
  } = useSystemHealth()

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

  const { data: apiUsage } = useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: getAPIUsage,
    refetchInterval: 5 * 60_000,
  })

  const { data: errorStats } = useQuery({
    queryKey: ['system-status', 'errors'],
    queryFn: getErrorStats,
    refetchInterval: STATUS_REFRESH_MS,
  })

  const { data: auth } = useAuthStatus()
  const { data: backupRuns } = useBackupRuns()
  const { data: backupConfigs } = useBackupConfigs()
  const { data: maintenance } = useMaintenanceState()
  const { data: notifStats } = useNotificationStats()
  const { data: vehicles } = useVehicles()

  // ── derived overall status ──────────────────────────────────────
  const overallStatus: HeroStatus = useMemo(() => {
    if (maintenance?.mode === 'maintenance') return 'maintenance'
    if (!health) return 'unknown'
    const s = health.status as string
    if (s === 'healthy' || s === 'ok') return 'healthy'
    if (s === 'degraded' || s === 'warning') return 'degraded'
    if (s === 'unhealthy' || s === 'down' || s === 'offline') return 'unhealthy'
    return 'unknown'
  }, [health, maintenance])

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
  }, [refetchHealth, qc])

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

  const components = health ? Object.entries(health.components) : []
  const okCount = components.filter(([, c]) => c.status === 'ok' || c.status === 'healthy').length
  const totalCount = components.length

  const dbStatus: HeroStatus =
    extHealth?.database?.status === 'ok' || extHealth?.database?.status === 'healthy' ? 'healthy'
    : extHealth?.database?.status ? 'degraded'
    : 'unknown'
  const dbLatency = extHealth?.database?.latency_ms

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
    ? workers.healthy_count === workers.total
      ? 'healthy'
      : workers.healthy_count > 0
        ? 'degraded'
        : 'unhealthy'
    : 'unknown'

  const notifStatus: HeroStatus = notifStats
    ? notifStats.failed > 0
      ? 'degraded'
      : 'healthy'
    : 'unknown'

  const errorsStatus: HeroStatus = errorStats
    ? errorStats.total_errors > 100 ? 'degraded'
      : errorStats.total_errors > 500 ? 'unhealthy'
      : 'healthy'
    : 'unknown'

  // Tesla API budget — alert when spend exceeds the documented free credit
  const apiOverBudget = !!apiUsage && apiUsage.estimated_cost > apiUsage.monthly_credit

  // ── resources rows ──────────────────────────────────────────────
  const resourceRows: ResourceRow[] = useMemo(() => {
    const rows: ResourceRow[] = []

    if (extHealth?.database_pool) {
      const acquired = extHealth.database_pool.acquired_conns ?? 0
      const idle = extHealth.database_pool.idle_conns ?? 0
      const total = extHealth.database_pool.total_conns ?? 0
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
        valueText: totalRows.toLocaleString(),
        metaText: positionCount > 0 ? `${positionCount.toLocaleString()} positions` : undefined,
        icon: <Boxes className="h-4 w-4" />,
      })
    }

    if (extHealth?.system?.goroutines != null) {
      rows.push({
        label: 'Runtime threads',
        valueText: extHealth.system.goroutines.toLocaleString(),
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
    } else if (extHealth?.system?.uptime_seconds != null) {
      rows.push({
        label: 'Uptime',
        valueText: formatUptime(extHealth.system.uptime_seconds),
        icon: <Clock className="h-4 w-4" />,
      })
    }

    return rows
  }, [extHealth, version, backupStats, totalRows, positionCount, workers])

  // ── 30-day uptime heatmap (synthesised in Phase 1) ─────────────
  const uptimeDays: UptimeDay[] = useMemo(() => {
    const days: UptimeDay[] = []
    const day = 24 * 60 * 60 * 1000
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * day)
      const iso = d.toISOString().slice(0, 10)
      days.push({
        date: iso,
        // Today = current status; prior days assumed healthy until the
        // backend exposes a real day-level history feed.
        status: i === 0 ? overallStatus : 'healthy',
      })
    }
    return days
  }, [now, overallStatus])

  // ── chip bar IDs ────────────────────────────────────────────────
  const chips = useMemo(() => [
    { id: 'health', label: 'Health' },
    { id: 'action-items', label: 'Action items' },
    { id: 'resources', label: 'Resources' },
    { id: 'services', label: 'Services' },
    { id: 'database', label: 'Database' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'workers', label: 'Workers' },
    { id: 'backups', label: 'Backups' },
    { id: 'tesla-api', label: 'Tesla API' },
    { id: 'errors', label: 'Errors' },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'system', label: 'System' },
    { id: 'uptime', label: 'Uptime' },
  ], [])

  // Action item flags
  const hasUpdate = updateCheck?.update_available === true
  const hasStaleBackup = backupStaleDays != null && backupStaleDays > STALE_BACKUP_DAYS
  const hasNoBackup = backupRuns != null && backupRuns.length === 0 && (backupConfigs?.length ?? 0) > 0
  const hasMaintenance = maintenance?.mode === 'maintenance'

  // Health-row contextual summaries
  const servicesSummary =
    totalCount === 0 ? 'no data' : `${okCount} / ${totalCount} healthy`
  const databaseSummary =
    dbLatency != null
      ? `${Math.round(dbLatency)}ms · ${backupStats?.database_size ?? '—'}`
      : backupStats?.database_size ?? 'connected'
  const telemetrySummary =
    vehicleCount > 0
      ? `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} · ${positionCount.toLocaleString()} positions`
      : 'operational · 0 vehicles (idle)'
  const notificationsSummary =
    notifStats
      ? notifStats.enabled_channels === 0
        ? 'No channels configured'
        : `${notifStats.enabled_channels}/${notifStats.total_channels} channels · ${notifStats.sent} sent`
      : 'operational'
  const workersSummary =
    workers
      ? `${workers.healthy_count} / ${workers.total} healthy`
      : 'unknown'

  return (
    <PageContainer
      title={t('System Status')}
      subtitle={t('At-a-glance health for your TeslaSync instance')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button variant="ghost" size="sm" onClick={handleRefresh} className="gap-2" aria-label={t('Refresh')}>
          <RefreshCw className="h-4 w-4" />
          {t('Refresh')}
        </Button>
      }
    >
      <StickyCompactHero
        targetId="status-hero"
        status={overallStatus}
        lastCheckedLabel={lastCheckedLabel}
        onRefresh={handleRefresh}
      />

      <div className="space-y-5 max-w-3xl mx-auto">
        {/* 1 ─ Hero ───────────────────────────────────────────── */}
        <FadeIn>
          <StatusHero
            id="status-hero"
            status={overallStatus}
            subline={lastCheckedLabel ? `Last checked ${lastCheckedLabel}` : 'Awaiting first check'}
            cta={{ label: t('Run health check'), onClick: handleRefresh }}
          />
        </FadeIn>

        {/* 2 ─ Sticky chip bar ─────────────────────────────────── */}
        <StickyChipBar chips={chips} />

        {/* 3 ─ Health rows ─────────────────────────────────────── */}
        <section id="health" aria-label="Health summary">
          <GlassPanel className="p-2 md:p-3">
            <h3 className="px-3 pt-2 text-sm font-semibold text-[var(--text-primary)]">
              {t('Health')}
            </h3>
            <div className="space-y-1 p-1">
              <HealthRow
                status={totalCount === 0 ? 'unknown' : okCount === totalCount ? 'healthy' : okCount > totalCount / 2 ? 'degraded' : 'unhealthy'}
                icon={<Server className="h-4 w-4" />}
                label={t('Services')}
                summary={servicesSummary}
                to="/live-monitor"
              />
              <HealthRow
                status={dbStatus}
                icon={<Database className="h-4 w-4" />}
                label={t('Database')}
                summary={databaseSummary}
                to="/db-health"
              />
              <HealthRow
                status="healthy"
                icon={<Activity className="h-4 w-4" />}
                label={t('Telemetry')}
                summary={telemetrySummary}
                to="/admin/telemetry/coverage"
              />
              <HealthRow
                status={notifStatus}
                icon={<Bell className="h-4 w-4" />}
                label={t('Notifications')}
                summary={notificationsSummary}
                to="/notifications"
              />
              <HealthRow
                status={workersStatus}
                icon={<Boxes className="h-4 w-4" />}
                label={t('Workers')}
                summary={workersSummary}
              />
              <HealthRow
                status={teslaAuthStatus}
                icon={<ShieldCheck className="h-4 w-4" />}
                label={t('Tesla auth')}
                summary={teslaAuthSummary}
                to="/tesla-account"
              />
            </div>
          </GlassPanel>
        </section>

        {/* 4 ─ Action items (always render) ─────────────────────── */}
        <section id="action-items" aria-label="Operator action items">
          <ActionItemsPanel title={t('Needs your attention')}>
            {hasMaintenance && (
              <ActionItem
                severity="info"
                title={t('Maintenance mode is active')}
                description={maintenance?.maintenance_message || t('System is in operator-set maintenance mode')}
                cta={{ label: t('Manage'), to: '/admin' }}
              />
            )}
            {hasUpdate && (
              <ActionItem
                severity="info"
                title={t('Update available — v{{version}}', { version: updateCheck?.latest })}
                description={t('Current: v{{current}}', { current: updateCheck?.current })}
                cta={{
                  label: t('Release notes'),
                  to: 'https://github.com/ev-dev-labs/teslasync/releases/latest',
                  external: true,
                }}
              />
            )}
            {teslaTokenWarn?.severity === 'error' && (
              <ActionItem
                severity="error"
                title={t('Tesla token expired')}
                description={t('Sign in again to resume Tesla-backed features')}
                cta={{ label: t('Re-authenticate'), to: '/tesla-account' }}
              />
            )}
            {teslaTokenWarn?.severity === 'warn' && (
              <ActionItem
                severity="warn"
                title={t('Tesla token expires in {{days}} day(s)', { days: teslaTokenWarn.days })}
                description={t('Refresh to avoid disruption')}
                cta={{ label: t('Re-authenticate'), to: '/tesla-account' }}
              />
            )}
            {auth?.authenticated === false && !teslaTokenWarn && (
              <ActionItem
                severity="warn"
                title={t('Tesla account not connected')}
                description={t('Connect your Tesla account to fetch vehicle data')}
                cta={{ label: t('Connect'), to: '/tesla-account' }}
              />
            )}
            {hasStaleBackup && (
              <ActionItem
                severity="warn"
                title={t('Last backup is {{days}} days old', { days: backupStaleDays })}
                description={t('Run a backup or check the schedule')}
                cta={{ label: t('Manage backups'), to: '/backup' }}
              />
            )}
            {hasNoBackup && (
              <ActionItem
                severity="warn"
                title={t('No backups recorded')}
                description={t('Configure a schedule or run one now')}
                cta={{ label: t('Set up backups'), to: '/backup' }}
              />
            )}
            {apiOverBudget && apiUsage && (
              <ActionItem
                severity="warn"
                title={t('Tesla API estimated cost ${{cost}} exceeds ${{credit}} monthly credit', {
                  cost: apiUsage.estimated_cost.toFixed(2),
                  credit: apiUsage.monthly_credit.toFixed(2),
                })}
                description={t('Review polling cadence or vehicle subscriptions')}
                cta={{ label: t('Open Tesla API logs'), to: '/api-logs' }}
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

        {/* 5 ─ Resources ───────────────────────────────────────── */}
        <section id="resources" aria-label="Server resources">
          <ResourcesPanel
            rows={resourceRows}
            footnote={t('CPU %, memory bytes, and disk usage need a new /system/resources endpoint (Phase 2).')}
          />
        </section>

        {/* 6 ─ Services & components ──────────────────────────── */}
        <section id="services">
          <AccordionSection
            icon={<Server className="h-5 w-5" />}
            title={t('Services & components')}
            description={servicesSummary}
            defaultOpen
            badges={<StatusBadge status={totalCount === 0 ? 'unknown' : okCount === totalCount ? 'healthy' : 'degraded'} />}
          >
            {components.length > 0 ? (
              <ul className="divide-y divide-white/[0.05]">
                {components.map(([name, comp]) => (
                  <li key={name} className="flex items-center gap-3 py-2 text-sm">
                    <StatusDot status={resolveCompStatus(comp.status)} />
                    <span className="flex-1 truncate font-medium text-[var(--text-primary)]">
                      {name}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {comp.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No component data yet.</p>
            )}
            <DetailLink to="/live-monitor" label={t('Open Live Monitor')} />
          </AccordionSection>
        </section>

        {/* 7 ─ Database ───────────────────────────────────────── */}
        <section id="database">
          <AccordionSection
            icon={<Database className="h-5 w-5" />}
            title={t('Database & connections')}
            description={databaseSummary}
            defaultOpen
            badges={<StatusBadge status={dbStatus} />}
          >
            <DefList
              rows={[
                { label: t('Latency'), value: dbLatency != null ? `${Math.round(dbLatency)}ms` : '—' },
                { label: t('Pool acquired'), value: extHealth?.database_pool ? `${extHealth.database_pool.acquired_conns} / ${extHealth.database_pool.total_conns || (extHealth.database_pool.acquired_conns + extHealth.database_pool.idle_conns)}` : '—' },
                { label: t('Pool idle'), value: extHealth?.database_pool ? String(extHealth.database_pool.idle_conns) : '—' },
                { label: t('Storage used'), value: backupStats?.database_size ?? '—' },
                { label: t('Tables'), value: backupStats?.table_count != null ? String(backupStats.table_count) : '—' },
                { label: t('Total rows'), value: totalRows > 0 ? totalRows.toLocaleString() : '—' },
              ]}
            />
            <DetailLink to="/db-health" label={t('Open DB Health')} />
          </AccordionSection>
        </section>

        {/* 8 ─ Telemetry ──────────────────────────────────────── */}
        <section id="telemetry">
          <AccordionSection
            icon={<Activity className="h-5 w-5" />}
            title={t('Telemetry pipeline')}
            description={telemetrySummary}
            defaultOpen
          >
            <DefList
              rows={[
                { label: t('Vehicles'), value: vehicleCount > 0 ? `${vehicleCount} connected` : 'none configured' },
                { label: t('GPS positions'), value: positionCount > 0 ? positionCount.toLocaleString() : '0 (idle)' },
                { label: t('Drives recorded'), value: drivesCount > 0 ? drivesCount.toLocaleString() : '0' },
                { label: t('Charging sessions'), value: backupStats?.row_counts?.charging_sessions != null ? String(backupStats.row_counts.charging_sessions) : '—' },
                { label: t('Signal log entries'), value: backupStats?.row_counts?.signal_log != null ? backupStats.row_counts.signal_log.toLocaleString() : '—' },
              ]}
            />
            <DetailLink to="/admin/telemetry/coverage" label={t('Open Telemetry Coverage')} />
          </AccordionSection>
        </section>

        {/* 9 ─ Notifications ──────────────────────────────────── */}
        <section id="notifications">
          <AccordionSection
            icon={<Bell className="h-5 w-5" />}
            title={t('Notifications & audit')}
            description={notificationsSummary}
            defaultOpen
            badges={notifStats?.failed ? <Badge variant="warning">{notifStats.failed} failed</Badge> : undefined}
          >
            <DefList
              rows={[
                { label: t('Channels'), value: notifStats ? `${notifStats.enabled_channels} of ${notifStats.total_channels} enabled` : '—' },
                { label: t('Sent (lifetime)'), value: notifStats ? String(notifStats.total_sent) : '—' },
                { label: t('Pending'), value: notifStats ? String(notifStats.pending) : '—' },
                { label: t('Failed'), value: notifStats ? String(notifStats.failed) : '—' },
              ]}
            />
            <DetailLink to="/notifications" label={t('Open Notifications')} />
          </AccordionSection>
        </section>

        {/* 10 ─ Workers ───────────────────────────────────────── */}
        <section id="workers">
          <AccordionSection
            icon={<Boxes className="h-5 w-5" />}
            title={t('Background workers')}
            description={workersSummary}
            defaultOpen
            badges={<StatusBadge status={workersStatus} />}
          >
            {workers?.workers && workers.workers.length > 0 ? (
              <ul className="divide-y divide-white/[0.05]">
                {workers.workers.map((w) => (
                  <li key={w.name} className="flex items-center gap-3 py-2 text-sm">
                    <StatusDot status={w.status === 'healthy' ? 'healthy' : 'unhealthy'} />
                    <span className="flex-1 truncate font-medium text-[var(--text-primary)]">{w.name}</span>
                    {w.latency_ms != null && (
                      <span className="text-xs text-[var(--text-muted)] tabular-nums">{w.latency_ms}ms</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No workers reporting.</p>
            )}
          </AccordionSection>
        </section>

        {/* 11 ─ Backups ───────────────────────────────────────── */}
        <section id="backups">
          <AccordionSection
            icon={<HardDrive className="h-5 w-5" />}
            title={t('Backups')}
            description={
              lastSuccessfulBackup?.completedAt
                ? backupStaleDays === 0
                  ? t('Last backup: today')
                  : t('Last backup: {{days}}d ago', { days: backupStaleDays ?? '?' })
                : (backupConfigs?.length ?? 0) > 0
                  ? t('Configured · no successful run yet')
                  : t('Not configured')
            }
            defaultOpen
            badges={hasStaleBackup
              ? <Badge variant="warning">stale</Badge>
              : hasNoBackup
                ? <Badge variant="warning">none</Badge>
                : undefined}
          >
            <DefList
              rows={[
                { label: t('Configured schedules'), value: String(backupConfigs?.length ?? 0) },
                { label: t('Total runs'), value: String(backupRuns?.length ?? 0) },
                { label: t('Last successful'), value: lastSuccessfulBackup?.completedAt ? new Date(lastSuccessfulBackup.completedAt).toLocaleString() : '—' },
                { label: t('Last successful size'), value: lastSuccessfulBackup?.fileSize ? formatBytes(lastSuccessfulBackup.fileSize) : '—' },
                { label: t('Failures (recent)'), value: String((backupRuns ?? []).filter((r) => r.status === 'failed').length) },
              ]}
            />
            <DetailLink to="/backup" label={t('Open Backups')} />
          </AccordionSection>
        </section>

        {/* 12 ─ Tesla API usage ───────────────────────────────── */}
        <section id="tesla-api">
          <AccordionSection
            icon={<Car className="h-5 w-5" />}
            title={t('Tesla API usage')}
            description={apiUsage
              ? t('${{cost}} of ${{credit}} estimated this period', {
                cost: apiUsage.estimated_cost.toFixed(2),
                credit: apiUsage.monthly_credit.toFixed(2),
              })
              : t('No data')}
            defaultOpen
            badges={apiOverBudget ? <Badge variant="warning">over budget</Badge> : undefined}
          >
            <DefList
              rows={[
                { label: t('Total requests'), value: apiUsage ? apiUsage.total_requests.toLocaleString() : '—' },
                { label: t('Skipped polls'), value: apiUsage ? apiUsage.skipped_polls.toLocaleString() : '—' },
                { label: t('Estimated cost'), value: apiUsage ? `$${apiUsage.estimated_cost.toFixed(2)}` : '—' },
                { label: t('Monthly credit'), value: apiUsage ? `$${apiUsage.monthly_credit.toFixed(2)}` : '—' },
                { label: t('Cost per request'), value: apiUsage ? `$${apiUsage.cost_per_request.toFixed(5)}` : '—' },
                { label: t('Estimated remaining'), value: apiUsage ? `$${apiUsage.estimated_remaining.toFixed(2)}` : '—' },
              ]}
            />
            <DetailLink to="/api-logs" label={t('Open API Logs')} />
          </AccordionSection>
        </section>

        {/* 13 ─ Recent errors ─────────────────────────────────── */}
        <section id="errors">
          <AccordionSection
            icon={<AlertTriangle className="h-5 w-5" />}
            title={t('Recent errors')}
            description={errorStats
              ? t('{{count}} since {{uptime}} ago', { count: errorStats.total_errors, uptime: errorStats.uptime })
              : t('No data')}
            defaultOpen
            badges={errorStats && errorStats.total_errors > 0
              ? <Badge variant={errorsStatus === 'healthy' ? 'neutral' : 'warning'}>{errorStats.total_errors}</Badge>
              : <Badge variant="success">clean</Badge>}
          >
            {errorStats && Object.keys(errorStats.by_code).length > 0 ? (
              <ul className="divide-y divide-white/[0.05]">
                {Object.entries(errorStats.by_code)
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 10)
                  .map(([code, info]) => (
                    <li key={code} className="flex items-start gap-3 py-2 text-sm">
                      <span className="shrink-0 font-mono text-xs text-amber-300">{code}</span>
                      <span className="flex-1 min-w-0 text-[var(--text-secondary)] truncate">
                        {info.last_message || '—'}
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-[var(--text-muted)]">
                        {info.count}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Inbox className="h-4 w-4" />
                <span>{t('No errors recorded recently.')}</span>
              </div>
            )}
            <DetailLink to="/api-logs?level=error" label={t('Open error logs')} />
          </AccordionSection>
        </section>

        {/* 14 ─ Diagnostics ───────────────────────────────────── */}
        <section id="diagnostics">
          <DiagnosticsSection />
        </section>

        {/* 15 ─ System info ────────────────────────────────────── */}
        <section id="system">
          <AccordionSection
            icon={<Package className="h-5 w-5" />}
            title={t('System info')}
            description={t('Version, build, runtime')}
            defaultOpen
          >
            <SystemInfoRows version={version} extHealth={extHealth} />
          </AccordionSection>
        </section>

        {/* 16 ─ 30-day uptime heatmap ─────────────────────────── */}
        <section id="uptime">
          <UptimeHeatmap
            days={uptimeDays}
            footnote={t('Today reflects the current status. Day-level historical data ships with the backend health-history endpoint in Phase 2.')}
          />
        </section>
      </div>
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
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-xs', TEXT_FOR_STATUS[status])}>
      <StatusDot status={status} />
      {label}
    </span>
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
        className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 transition-colors hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        {label}
      </Link>
    </div>
  )
}

interface DefListRow { label: string; value: ReactNode }
function DefList({ rows }: { rows: DefListRow[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2">
          <dt className="text-[var(--text-secondary)]">{r.label}</dt>
          <dd className="font-medium tabular-nums text-[var(--text-primary)]">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Helper: system info rows ────────────────────────────────────────
function SystemInfoRows({
  version,
  extHealth,
}: {
  version?: { app_version: string; chart_version: string; go_version: string; os: string; arch: string; uptime_seconds: number }
  extHealth?: { system?: { goroutines: number; uptime_seconds: number; go_version: string } }
}) {
  if (!version) {
    return <div className="text-sm text-[var(--text-muted)]">Loading system info…</div>
  }

  const rows: DefListRow[] = [
    { label: 'App version', value: version.app_version },
    { label: 'Chart version', value: version.chart_version },
    { label: 'Go runtime', value: version.go_version },
    { label: 'OS / arch', value: `${version.os}/${version.arch}` },
    { label: 'Uptime', value: formatUptime(version.uptime_seconds) },
  ]
  if (extHealth?.system?.goroutines != null) {
    rows.push({ label: 'Goroutines', value: extHealth.system.goroutines.toLocaleString() })
  }

  return <DefList rows={rows} />
}

// Reserved for the Phase-2 unified Tesla auth banner.
void Zap
