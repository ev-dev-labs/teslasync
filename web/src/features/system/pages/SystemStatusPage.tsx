/**
 * SystemStatusPage — operator-grade health dashboard.
 *
 * Mobile-first single-column layout; answers in <5 seconds:
 *   1. Is my instance healthy?           — StatusHero
 *   2. If not, what's broken?            — Health rows + Action items
 *   3. What do I need to do?             — ActionItemsPanel CTAs
 *
 * Phase 1: SSR-style polling, derives action items from existing endpoints
 *   (update-check, auth-status, backup runs, maintenance state).
 *
 * Phase 2 (deferred): SSE updates, incident lifecycle, /api/v1/status
 *   endpoints, scheduled maintenance, push notifications, SLO tracking.
 *
 * Heavy panels that duplicated other pages have been removed:
 *   - Detailed DB pool table → /db-health
 *   - Full component health table → /live-monitor
 *   - Audit log table → /notifications
 *   - Telemetry pipeline detail → /admin/telemetry/coverage
 *   - Compression stats → /backup (Data Export)
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Database, Bell, ShieldCheck, Cpu, Server,
  HardDrive, Package, Clock, RefreshCw,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Button } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import {
  StatusHero, type HeroStatus,
  StickyChipBar, StickyCompactHero,
  HealthRow, ResourcesPanel, type ResourceRow,
  ActionItemsPanel, ActionItem,
  UptimeHeatmap, type UptimeDay,
} from '@/components/status'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSystemHealth, useBackupRuns, useMaintenanceState } from '@/api/hooks/useAdmin'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { getVersionInfo, getExtendedHealth, checkForUpdates } from '@/api/devtools'

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

  const { data: auth } = useAuthStatus()
  const { data: backupRuns } = useBackupRuns()
  const { data: maintenance } = useMaintenanceState()

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

  // ── action items derivation ─────────────────────────────────────
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
    const success = backupRuns.find((r) => r.status === 'completed')
    return success ?? null
  }, [backupRuns])

  const backupStaleDays = useMemo(() => {
    if (!lastSuccessfulBackup?.completedAt) return null
    const days = Math.floor((now - new Date(lastSuccessfulBackup.completedAt).getTime()) / (24 * 60 * 60 * 1000))
    return days
  }, [lastSuccessfulBackup, now])

  // ── health row data ─────────────────────────────────────────────
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

  // ── resources rows (Phase 1: only what backend exposes today) ──
  const resourceRows: ResourceRow[] = useMemo(() => {
    const rows: ResourceRow[] = []

    if (extHealth?.database_pool) {
      const acquired = extHealth.database_pool.acquired_conns ?? 0
      const total = extHealth.database_pool.total_conns ?? 0
      const idle = extHealth.database_pool.idle_conns ?? 0
      const max = total > 0 ? total : acquired + idle
      rows.push({
        label: 'DB connections',
        valueText: `${acquired}`,
        metaText: max > 0 ? `of ${max} in use` : undefined,
        percent: max > 0 ? (acquired / max) * 100 : undefined,
        icon: <Database className="h-4 w-4" />,
      })
    }

    if (extHealth?.system?.goroutines != null) {
      rows.push({
        label: 'Runtime threads',
        valueText: `${extHealth.system.goroutines.toLocaleString()}`,
        metaText: 'goroutines',
        icon: <Cpu className="h-4 w-4" />,
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
  }, [extHealth, version])

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
        // backend exposes a real day-level history feed (Phase 2).
        status: i === 0 ? overallStatus : 'healthy',
      })
    }
    return days
  }, [now, overallStatus])

  // ── chip bar + sticky offsets ───────────────────────────────────
  const chips = useMemo(() => [
    { id: 'health', label: 'Health' },
    { id: 'action-items', label: 'Action items' },
    { id: 'resources', label: 'Resources' },
    { id: 'services', label: 'Services' },
    { id: 'database', label: 'Database' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'backups', label: 'Backups' },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'system', label: 'System' },
    { id: 'uptime', label: 'Uptime' },
  ], [])

  // Derived flags for visible action items. (`hasTeslaAction` is reserved
  // for the Phase 2 unified Tesla auth banner; not yet rendered here.)
  const hasUpdate = updateCheck?.update_available === true
  const hasStaleBackup = backupStaleDays != null && backupStaleDays > STALE_BACKUP_DAYS
  const hasNoBackup = backupRuns != null && backupRuns.length === 0
  const hasMaintenance = maintenance?.mode === 'maintenance'

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
                summary={totalCount === 0 ? 'no data' : `${okCount} / ${totalCount} healthy`}
                to="/live-monitor"
              />
              <HealthRow
                status={dbStatus}
                icon={<Database className="h-4 w-4" />}
                label={t('Database')}
                summary={dbLatency != null ? `${Math.round(dbLatency)}ms` : 'connected'}
                to="/db-health"
              />
              <HealthRow
                status="healthy"
                icon={<Activity className="h-4 w-4" />}
                label={t('Telemetry')}
                summary="operational"
                to="/admin/telemetry/coverage"
              />
              <HealthRow
                status="healthy"
                icon={<Bell className="h-4 w-4" />}
                label={t('Notifications')}
                summary="operational"
                to="/notifications"
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
          </ActionItemsPanel>
        </section>

        {/* 5 ─ Resources ───────────────────────────────────────── */}
        <section id="resources" aria-label="Server resources">
          <ResourcesPanel
            rows={resourceRows}
            footnote={t('CPU %, memory bytes and disk usage land in Phase 2 (needs new /system/resources endpoint).')}
          />
        </section>

        {/* 6 ─ Collapsed link-out accordions ──────────────────── */}
        <LinkAccordion
          id="services"
          title={t('Services & components')}
          summary={totalCount > 0 ? `${okCount} / ${totalCount} healthy` : 'no data'}
          icon={<Server className="h-5 w-5" />}
          to="/live-monitor"
          ctaLabel={t('Open Live Monitor')}
        />
        <LinkAccordion
          id="database"
          title={t('Database & connections')}
          summary={dbLatency != null ? `Connected · ${Math.round(dbLatency)}ms` : 'Connected'}
          icon={<Database className="h-5 w-5" />}
          to="/db-health"
          ctaLabel={t('Open DB Health')}
        />
        <LinkAccordion
          id="telemetry"
          title={t('Telemetry pipeline')}
          summary={t('Operational')}
          icon={<Activity className="h-5 w-5" />}
          to="/admin/telemetry/coverage"
          ctaLabel={t('Open Telemetry Coverage')}
        />
        <LinkAccordion
          id="notifications"
          title={t('Notifications & audit')}
          summary={t('Operational')}
          icon={<Bell className="h-5 w-5" />}
          to="/notifications"
          ctaLabel={t('Open Notifications')}
        />
        <LinkAccordion
          id="backups"
          title={t('Backups')}
          summary={
            lastSuccessfulBackup?.completedAt
              ? backupStaleDays === 0
                ? t('Last backup: today')
                : t('Last backup: {{days}}d ago', { days: backupStaleDays ?? '?' })
              : t('No backups recorded')
          }
          icon={<HardDrive className="h-5 w-5" />}
          to="/backup"
          ctaLabel={t('Open Backups')}
        />

        {/* 7 ─ Diagnostics (kept — unique self-test runner) ──── */}
        <section id="diagnostics">
          <DiagnosticsSection />
        </section>

        {/* 8 ─ System info ─────────────────────────────────────── */}
        <section id="system">
          <AccordionSection
            icon={<Package className="h-5 w-5" />}
            title={t('System info')}
            description={t('Version, build, runtime')}
          >
            <SystemInfoRows version={version} extHealth={extHealth} />
          </AccordionSection>
        </section>

        {/* 9 ─ 30-day uptime heatmap ───────────────────────────── */}
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

// ── Helper: link-out accordion ─────────────────────────────────────
//
// Thin wrapper around AccordionSection — title + summary on the row,
// big "Open <page>" button inside. Replaces the heavy detail panels
// the old page used to render inline.
interface LinkAccordionProps {
  id: string
  title: string
  summary: string
  icon: React.ReactNode
  to: string
  ctaLabel: string
}

function LinkAccordion({ id, title, summary, icon, to, ctaLabel }: LinkAccordionProps) {
  return (
    <section id={id}>
      <AccordionSection
        icon={icon}
        title={title}
        description={summary}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-[var(--text-secondary)]">
            Detailed view lives on its own page so this dashboard stays scannable.
          </p>
          <Link
            to={to}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 transition-colors hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            {ctaLabel}
          </Link>
        </div>
      </AccordionSection>
    </section>
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

  const rows: { label: string; value: string }[] = [
    { label: 'App version', value: version.app_version },
    { label: 'Chart version', value: version.chart_version },
    { label: 'Go runtime', value: version.go_version },
    { label: 'OS / arch', value: `${version.os}/${version.arch}` },
    { label: 'Uptime', value: formatUptime(version.uptime_seconds) },
  ]
  if (extHealth?.system?.goroutines != null) {
    rows.push({ label: 'Goroutines', value: extHealth.system.goroutines.toLocaleString() })
  }

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

// Suppress unused-import warning for icons reserved for Phase 2.
