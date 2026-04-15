import { type ReactNode, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Server,
  Database,
  Radio,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  Clock,
  Cpu,
  HardDrive,
  Gauge,
  DollarSign,
  BarChart3,
  Zap,
  Archive,
  TrendingUp,
  HeartPulse,
  Satellite,
  Globe,
  ChevronDown,
  Bell,
  Package,
  Send,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  type Column,
  IconBox,
} from '@/components/ui';
import {
  StatCard,
  KVList,
  MetricCard,
  InlineMetric,
} from '@/components/data-display';
import {
  RadialGauge,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  CHART_COLORS,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSystemHealth, useConnectionPool } from '@/api/hooks/useAdmin';
import {
  getExtendedHealth,
  getAPIUsage,
  getCompressionStats,
  getTelemetryStatus,
  getWorkersHealth,
  getVersionInfo,
  getAuditLogs as getDevtoolsAuditLogs,
  getExportJobs as getDevtoolsExportJobs,
} from '@/api/devtools';
import { getNotificationStats, getNotificationLogs } from '@/api/settings';

import type {
  NotificationLog,
  ExportJobSummary,
  AuditLog,
} from '@/api/types';

import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtPercent } from '@/lib/numberFormat';

/* ==========================================================================
   Helpers
   ========================================================================== */

function getStatusColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return '#22c55e';
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return '#f59e0b';
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

function statusTextClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy': case 'ok': case 'online': case 'connected': case 'ready': case 'sent': case 'completed':
      return 'text-green-400';
    case 'degraded': case 'warning': case 'pending': case 'queued': case 'processing':
      return 'text-amber-400';
    case 'unhealthy': case 'offline': case 'error': case 'down': case 'failed':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function getStatusIcon(status: string): JSX.Element {
  const cls = statusTextClass(status);
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return <CheckCircle className={`h-4 w-4 ${cls}`} />;
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return <AlertTriangle className={`h-4 w-4 ${cls}`} />;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return <XCircle className={`h-4 w-4 ${cls}`} />;
    default:
      return <AlertTriangle className={`h-4 w-4 ${cls}`} />;
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${fmtNumber(bytes / Math.pow(k, i), 1)} ${sizes[i]}`;
}

function statusToBadgeVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'ready':
    case 'sent':
    case 'completed':
      return 'success';
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return 'warning';
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/* ==========================================================================
   AccordionSection – collapsible section with icon, title, description
   ========================================================================== */

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = useCallback(() => setOpen((prev) => !prev), []);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    },
    [],
  );

  return (
    <GlassPanel className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-3 px-5 py-4 cursor-pointer select-none',
          'hover:bg-white/[0.02] transition-colors',
        )}
      >
        <div className="text-cyan-400 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">
            {description}
          </div>
        </div>
        {badges && (
          <div className="flex items-center gap-2 shrink-0">{badges}</div>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-[var(--text-muted)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </div>
      {open && (
        <FadeIn>
          <div className="border-t border-white/[0.06] px-5 py-4 space-y-4">
            {children}
          </div>
        </FadeIn>
      )}
    </GlassPanel>
  );
}

/* ==========================================================================
   Section 1 – Health Probes (Liveness / Readiness)
   ========================================================================== */

function HealthProbesSection() {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('Health Probes')}
        description={t('Liveness and readiness checks')}
        defaultOpen
      >
        <Grid cols={{ default: 1, md: 2 }} gap={4}>
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </Grid>
      </AccordionSection>
    );
  }

  if (error) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('Health Probes')}
        description={t('Liveness and readiness checks')}
        defaultOpen
      >
        <QueryError error={error as Error} onRetry={() => refetch()} />
      </AccordionSection>
    );
  }

  const livenessStatus = data?.status ?? 'unknown';
  const dbStatus = data?.database?.status ?? 'unknown';
  const dbLatency = data?.database?.latency_ms;

  return (
    <AccordionSection
      icon={<HeartPulse className="h-5 w-5" />}
      title={t('Health Probes')}
      description={t('Liveness and readiness checks')}
      badges={
        <>
          <Badge
            variant={statusToBadgeVariant(livenessStatus)}
            size="sm"
            dot
          >
            {t('Live')}
          </Badge>
          <Badge
            variant={statusToBadgeVariant(dbStatus)}
            size="sm"
            dot
          >
            {t('Ready')}
          </Badge>
        </>
      }
      defaultOpen
    >
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        {/* Liveness */}
        <Card>
          <CardHeader
            title={t('Liveness — /healthz')}
            action={
              <Badge variant={statusToBadgeVariant(livenessStatus)} size="sm">
                {livenessStatus}
              </Badge>
            }
          />
          <KVList
            items={[
              { label: t('Status'), value: livenessStatus },
              {
                label: t('Goroutines'),
                value: fmtInt(data?.system?.goroutines ?? 0),
              },
              {
                label: t('Uptime'),
                value: formatUptime(data?.system?.uptime_seconds ?? 0),
              },
            ]}
          />
        </Card>

        {/* Readiness */}
        <Card>
          <CardHeader
            title={t('Readiness — /readyz')}
            action={
              <Badge variant={statusToBadgeVariant(dbStatus)} size="sm">
                {dbStatus}
              </Badge>
            }
          />
          <KVList
            items={[
              { label: t('Database'), value: dbStatus },
              {
                label: t('Latency'),
                value:
                  dbLatency != null
                    ? `${fmtNumber(dbLatency, 1)} ms`
                    : '—',
              },
              {
                label: t('Pool Connections'),
                value: fmtInt(data?.database_pool?.total_conns ?? 0),
              },
            ]}
          />
        </Card>
      </Grid>
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 2 – Backend Status (Components, DB Pool, Runtime)
   ========================================================================== */

interface ComponentRow {
  name: string;
  status: string;
  latency_ms: number;
  failures: number;
  lastCheck: string;
}

function BackendStatusSection() {
  const { t } = useTranslation();

  const { data: extHealth, isLoading: extLoading } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const { data: pool, isLoading: poolLoading } = useConnectionPool();

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const isLoading = extLoading || poolLoading;

  const componentRows: ComponentRow[] = extHealth
    ? Object.entries(extHealth.components).map(([name, c]) => ({
        name,
        status: c.status,
        latency_ms: c.latency_ms ?? 0,
        failures: c.consecutive_failures ?? 0,
        lastCheck: c.last_check ?? '',
      }))
    : [];

  const componentColumns: Column<ComponentRow>[] = [
    {
      key: 'status',
      header: t('Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <span className={statusTextClass(row.status)}>
            {row.status}
          </span>
        </div>
      ),
    },
    {
      key: 'name',
      header: t('Component'),
      sortable: true,
      render: (row) => (
        <span className="font-medium text-[var(--text-primary)]">
          {row.name}
        </span>
      ),
    },
    {
      key: 'latency_ms',
      header: t('Latency'),
      sortable: true,
      render: (row) => `${fmtNumber(row.latency_ms, 1)} ms`,
    },
    {
      key: 'failures',
      header: t('Failures'),
      sortable: true,
      render: (row) => (
        <span className={cn(row.failures > 0 && 'text-red-400')}>
          {fmtInt(row.failures)}
        </span>
      ),
    },
    {
      key: 'lastCheck',
      header: t('Last Check'),
      render: (row) => (row.lastCheck ? formatDateTime(row.lastCheck) : '—'),
    },
  ];

  const okCount = componentRows.filter(
    (r) => r.status === 'ok' || r.status === 'healthy',
  ).length;

  return (
    <AccordionSection
      icon={<Server className="h-5 w-5" />}
      title={t('Backend Status')}
      description={t('Component health, database pool, and runtime info')}
      badges={
        componentRows.length > 0 ? (
          <Badge
            variant={okCount === componentRows.length ? 'success' : 'warning'}
            size="sm"
          >
            {okCount}/{componentRows.length} {t('healthy')}
          </Badge>
        ) : undefined
      }
      defaultOpen
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Component Health Table */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('Component Health')}
            </h4>
            <DataTable
              columns={componentColumns}
              data={componentRows}
              keyExtractor={(r) => r.name}
              compact
              pagination
              emptyMessage={t('No components found')}
            />
          </div>

          {/* Database Pool Stats */}
          {pool && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('Database Connection Pool')}
              </h4>
              <Grid cols={{ default: 2, md: 5 }} gap={3}>
                <StatCard
                  label={t('Max Open')}
                  value={fmtInt(pool.maxOpen)}
                  icon={<Database className="h-4 w-4" />}
                />
                <StatCard
                  label={t('Open')}
                  value={fmtInt(pool.open)}
                  icon={<Database className="h-4 w-4" />}
                />
                <StatCard
                  label={t('In Use')}
                  value={fmtInt(pool.inUse)}
                  icon={<Activity className="h-4 w-4" />}
                />
                <StatCard
                  label={t('Idle')}
                  value={fmtInt(pool.idle)}
                  icon={<Clock className="h-4 w-4" />}
                />
                <StatCard
                  label={t('Wait Count')}
                  value={fmtInt(pool.waitCount)}
                  icon={<Gauge className="h-4 w-4" />}
                />
              </Grid>
            </div>
          )}

          {/* System Runtime */}
          {(extHealth?.system || version) && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('System Runtime')}
              </h4>
              <KVList
                columns={2}
                items={[
                  {
                    label: t('Go Version'),
                    value:
                      version?.go_version ??
                      extHealth?.system?.go_version ??
                      '—',
                  },
                  {
                    label: t('Uptime'),
                    value: formatUptime(
                      version?.uptime_seconds ??
                        extHealth?.system?.uptime_seconds ??
                        0,
                    ),
                  },
                  {
                    label: t('Goroutines'),
                    value: fmtInt(
                      version?.goroutines ??
                        extHealth?.system?.goroutines ??
                        0,
                    ),
                  },
                  {
                    label: t('OS / Arch'),
                    value: version
                      ? `${version.os} / ${version.arch}`
                      : '—',
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 3 – Service Health (Fleet Telemetry)
   ========================================================================== */

function ServiceHealthSection() {
  const { t } = useTranslation();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['system-status', 'telemetry'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000,
  });

  const vehicles = data?.streaming_vehicles
    ? Object.values(data.streaming_vehicles)
    : [];
  const activeCount = vehicles.filter((v) => v.is_streaming).length;

  type VehicleRow = (typeof vehicles)[number];

  const vehicleColumns: Column<VehicleRow>[] = [
    {
      key: 'vin',
      header: t('VIN'),
      render: (row) => (
        <span className="font-mono text-xs">{row.vin}</span>
      ),
    },
    {
      key: 'status',
      header: t('Status'),
      render: (row) => (
        <Badge
          variant={row.is_streaming ? 'success' : 'neutral'}
          size="sm"
          dot
        >
          {row.is_streaming ? t('Streaming') : t('Idle')}
        </Badge>
      ),
    },
    {
      key: 'signal_count',
      header: t('Signals'),
      sortable: true,
      render: (row) => fmtInt(row.signal_count),
    },
    {
      key: 'signals_per_second',
      header: t('Signals/s'),
      render: (row) => fmtNumber(row.signals_per_second, 1),
    },
    {
      key: 'latency_ms',
      header: t('Latency'),
      render: (row) => `${fmtNumber(row.latency_ms, 0)} ms`,
    },
    {
      key: 'last_received',
      header: t('Last Received'),
      render: (row) => formatDateTime(row.last_received),
    },
  ];

  return (
    <AccordionSection
      icon={<Satellite className="h-5 w-5" />}
      title={t('Service Health')}
      description={t('Fleet Telemetry streaming status')}
      badges={
        data ? (
          <>
            <Badge
              variant={data.enabled ? 'success' : 'neutral'}
              size="sm"
              dot
            >
              {data.enabled ? t('Enabled') : t('Disabled')}
            </Badge>
            <Badge variant="info" size="sm">
              {activeCount} {t('streaming')}
            </Badge>
          </>
        ) : undefined
      }
    >
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <QueryError error={error as Error} onRetry={() => refetch()} />
      ) : !data ? (
        <EmptyState message={t('No telemetry data available')} />
      ) : (
        <div className="space-y-4">
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <MetricCard
              label={t('Mode')}
              value={data.mode}
              icon={<Radio className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('Vehicles Connected')}
              value={activeCount}
              icon={<Satellite className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('Total Signals')}
              value={fmtInt(
                data.aggregate_stats?.total_signals_received ?? 0,
              )}
              icon={<Zap className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('Avg Signals/s')}
              value={data.aggregate_stats?.avg_signals_per_second ?? '0'}
              icon={<TrendingUp className="h-4 w-4" />}
              color="cyan"
            />
          </Grid>

          <DataTable
            columns={vehicleColumns}
            data={vehicles}
            keyExtractor={(v) => v.vin}
            compact
            pagination
            emptyMessage={t('No vehicles connected')}
          />
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 4 – Infrastructure (SSE / Polling)
   ========================================================================== */

function InfrastructureSection() {
  const { t } = useTranslation();

  const { data: telemetry } = useQuery({
    queryKey: ['system-status', 'telemetry'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000,
  });

  const { data: extHealth } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const sseConnected = telemetry?.enabled ?? false;
  const connectionMode = telemetry?.mode ?? 'unknown';

  return (
    <AccordionSection
      icon={<Globe className="h-5 w-5" />}
      title={t('Infrastructure')}
      description={t('SSE connections and polling engine diagnostics')}
      badges={
        <Badge
          variant={sseConnected ? 'success' : 'warning'}
          size="sm"
          dot
        >
          {sseConnected ? t('Connected') : t('Disconnected')}
        </Badge>
      }
    >
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        {/* SSE Connection */}
        <Card>
          <CardHeader
            title={t('SSE Connection')}
            action={
              sseConnected ? (
                <Wifi className="h-4 w-4 text-green-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-400" />
              )
            }
          />
          <KVList
            items={[
              {
                label: t('Connection State'),
                value: (
                  <Badge
                    variant={sseConnected ? 'success' : 'danger'}
                    size="sm"
                  >
                    {sseConnected ? t('Connected') : t('Disconnected')}
                  </Badge>
                ),
              },
              {
                label: t('Endpoint'),
                value: telemetry?.endpoint ?? '—',
              },
              {
                label: t('Protocol'),
                value: telemetry?.protocol ?? '—',
              },
              {
                label: t('Fallback Mode'),
                value:
                  connectionMode === 'polling'
                    ? t('Yes — Polling')
                    : t('No'),
              },
            ]}
          />
        </Card>

        {/* Polling Engine */}
        <Card>
          <CardHeader
            title={t('Polling Engine')}
            action={
              <Badge
                variant={
                  connectionMode === 'polling' ? 'success' : 'neutral'
                }
                size="sm"
              >
                {connectionMode === 'polling' ? t('Active') : t('Standby')}
              </Badge>
            }
          />
          <KVList
            items={[
              { label: t('Mode'), value: connectionMode },
              {
                label: t('Speed Comparison'),
                value:
                  telemetry?.speed_comparison?.speedup ?? '—',
              },
              {
                label: t('Fleet Telemetry Latency'),
                value:
                  telemetry?.speed_comparison
                    ?.fleet_telemetry_latency ?? '—',
              },
              {
                label: t('Fleet API Polling'),
                value:
                  telemetry?.speed_comparison?.fleet_api_polling ??
                  '—',
              },
            ]}
          />
        </Card>
      </Grid>

      {/* Database Pool Overview from ExtendedHealth */}
      {extHealth?.database_pool && (
        <div className="mt-4">
          <Grid cols={{ default: 3 }} gap={3}>
            <InlineMetric
              icon={<Database className="h-4 w-4 text-cyan-400" />}
              value={fmtInt(extHealth.database_pool.total_conns)}
              label={t('Total Conns')}
            />
            <InlineMetric
              icon={<Activity className="h-4 w-4 text-green-400" />}
              value={fmtInt(extHealth.database_pool.acquired_conns)}
              label={t('Acquired')}
            />
            <InlineMetric
              icon={<Clock className="h-4 w-4 text-amber-400" />}
              value={fmtInt(extHealth.database_pool.idle_conns)}
              label={t('Idle')}
            />
          </Grid>
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 5 – Data Pipeline (Compression + Export Jobs)
   ========================================================================== */

function DataPipelineSection() {
  const { t } = useTranslation();

  const { data: compression, isLoading: compLoading } = useQuery({
    queryKey: ['system-status', 'compression'],
    queryFn: getCompressionStats,
    refetchInterval: 30_000,
  });

  const { data: exportJobs, isLoading: exportLoading } = useQuery({
    queryKey: ['system-status', 'export-jobs'],
    queryFn: () => getDevtoolsExportJobs(),
    refetchInterval: 15_000,
  });

  const isLoading = compLoading || exportLoading;

  const exportColumns: Column<ExportJobSummary>[] = [
    {
      key: 'status',
      header: t('Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <span className={statusTextClass(row.status)}>
            {row.status}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('Type'),
      render: (row) => row.type,
    },
    {
      key: 'format',
      header: t('Format'),
      render: (row) => (
        <Badge variant="neutral" size="sm">
          {row.format}
        </Badge>
      ),
    },
    {
      key: 'file_name',
      header: t('File'),
      render: (row) => (
        <span className="font-mono text-xs truncate max-w-[200px] block">
          {row.file_name}
        </span>
      ),
    },
    {
      key: 'record_count',
      header: t('Records'),
      sortable: true,
      render: (row) => fmtInt(row.record_count),
    },
    {
      key: 'created_at',
      header: t('Created'),
      render: (row) => formatDateTime(row.created_at),
    },
  ];

  const pendingJobs =
    exportJobs?.filter((j) => j.status === 'queued').length ?? 0;
  const processingJobs =
    exportJobs?.filter((j) => j.status === 'processing').length ?? 0;
  const completedJobs =
    exportJobs?.filter((j) => j.status === 'ready').length ?? 0;
  const failedJobs =
    exportJobs?.filter((j) => j.status === 'failed').length ?? 0;

  return (
    <AccordionSection
      icon={<Archive className="h-5 w-5" />}
      title={t('Data Pipeline')}
      description={t('Compression statistics and export job queue')}
      badges={
        <>
          {compression && (
            <Badge variant="info" size="sm">
              {fmtPercent(compression.savings_percent)} {t('saved')}
            </Badge>
          )}
          {pendingJobs + processingJobs > 0 && (
            <Badge variant="warning" size="sm">
              {pendingJobs + processingJobs} {t('active')}
            </Badge>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Compression Stats */}
          {compression && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('Compression Statistics')}
              </h4>
              <Grid cols={{ default: 2, md: 4 }} gap={3}>
                <MetricCard
                  label={t('Compression Ratio')}
                  value={fmtPercent(compression.savings_percent)}
                  icon={<TrendingUp className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('Estimated Savings')}
                  value={formatBytes(compression.estimated_saved_bytes)}
                  icon={<HardDrive className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Total Positions')}
                  value={fmtInt(compression.total_positions)}
                  icon={<BarChart3 className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('Compressed')}
                  value={fmtInt(compression.compressed_positions)}
                  icon={<Archive className="h-4 w-4" />}
                  color="cyan"
                />
              </Grid>

              {/* Compression ratio gauge */}
              <div className="mt-4 flex justify-center">
                <RadialGauge
                  value={compression.savings_percent}
                  max={100}
                  label={t('Savings')}
                  unit="%"
                  color="#22c55e"
                  size={140}
                />
              </div>
            </div>
          )}

          {/* Export Job Queue */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('Export Job Queue')}
            </h4>
            {exportJobs && exportJobs.length > 0 ? (
              <>
                <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                  <StatCard
                    label={t('Pending')}
                    value={pendingJobs}
                    icon={<Clock className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('Processing')}
                    value={processingJobs}
                    icon={<Activity className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('Completed')}
                    value={completedJobs}
                    icon={<CheckCircle className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('Failed')}
                    value={failedJobs}
                    icon={<XCircle className="h-4 w-4" />}
                  />
                </Grid>
                <DataTable
                  columns={exportColumns}
                  data={exportJobs}
                  keyExtractor={(j) => j.id}
                  compact
                  pagination
                  emptyMessage={t('No export jobs')}
                />
              </>
            ) : (
              <EmptyState message={t('No export jobs in queue')} />
            )}
          </div>
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 6 – Operations (Notifications + Audit Log)
   ========================================================================== */

function OperationsSection() {
  const { t } = useTranslation();

  const { data: notifStats, isLoading: statsLoading } = useQuery({
    queryKey: ['system-status', 'notification-stats'],
    queryFn: getNotificationStats,
    refetchInterval: 15_000,
  });

  const { data: notifLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['system-status', 'notification-logs'],
    queryFn: () => getNotificationLogs(10, 0),
    refetchInterval: 15_000,
  });

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['system-status', 'audit-logs'],
    queryFn: () => getDevtoolsAuditLogs(20),
    refetchInterval: 30_000,
  });

  const isLoading = statsLoading || logsLoading || auditLoading;

  const successRate =
    notifStats && notifStats.total_sent > 0
      ? (notifStats.sent / notifStats.total_sent) * 100
      : 100;

  const notifLogColumns: Column<NotificationLog>[] = [
    {
      key: 'status',
      header: t('Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <span className={statusTextClass(row.status)}>
            {row.status}
          </span>
        </div>
      ),
    },
    {
      key: 'title',
      header: t('Title'),
      render: (row) => (
        <span className="text-[var(--text-primary)] truncate max-w-[200px] block">
          {row.title}
        </span>
      ),
    },
    {
      key: 'message',
      header: t('Message'),
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)] truncate max-w-[250px] block">
          {row.message}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('Time'),
      render: (row) => formatDateTime(row.created_at),
    },
  ];

  const auditColumns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      header: t('Time'),
      render: (row) => formatDateTime(row.created_at),
    },
    {
      key: 'action',
      header: t('Action'),
      render: (row) => (
        <Badge variant="info" size="sm">
          {row.action}
        </Badge>
      ),
    },
    {
      key: 'resource',
      header: t('Resource'),
      render: (row) => (
        <span className="font-mono text-xs">{row.resource}</span>
      ),
    },
    {
      key: 'details',
      header: t('Details'),
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)] truncate max-w-[250px] block">
          {row.details}
        </span>
      ),
    },
  ];

  return (
    <AccordionSection
      icon={<Bell className="h-5 w-5" />}
      title={t('Operations')}
      description={t('Notification delivery and audit trail')}
      badges={
        notifStats ? (
          <Badge
            variant={
              successRate >= 95
                ? 'success'
                : successRate >= 80
                  ? 'warning'
                  : 'danger'
            }
            size="sm"
          >
            {fmtPercent(successRate, 1)} {t('success rate')}
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Notification Stats */}
          {notifStats && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('Notification Delivery')}
              </h4>
              <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                <MetricCard
                  label={t('Total Sent')}
                  value={fmtInt(notifStats.total_sent)}
                  icon={<Send className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Failed')}
                  value={fmtInt(notifStats.failed)}
                  icon={<XCircle className="h-4 w-4" />}
                  color="red"
                />
                <MetricCard
                  label={t('Success Rate')}
                  value={fmtPercent(successRate, 1)}
                  icon={<CheckCircle className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('Channels')}
                  value={`${notifStats.enabled_channels}/${notifStats.total_channels}`}
                  icon={<Bell className="h-4 w-4" />}
                  color="purple"
                />
              </Grid>

              {/* Notification success gauge */}
              <div className="flex justify-center mb-4">
                <RadialGauge
                  value={successRate}
                  max={100}
                  label={t('Success')}
                  unit="%"
                  color={
                    successRate >= 95
                      ? '#22c55e'
                      : successRate >= 80
                        ? '#f59e0b'
                        : '#ef4444'
                  }
                  size={120}
                />
              </div>

              {notifLogs ? (
                <DataTable
                  columns={notifLogColumns}
                  data={notifLogs}
                  keyExtractor={(l) => l.id}
                  compact
                  pagination={{ defaultPageSize: 50 }}
                  emptyMessage={t('No recent notifications')}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </div>
          )}

          {/* Audit Logs */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('Audit Log')}
            </h4>
            {auditLogs && auditLogs.length > 0 ? (
              <DataTable
                columns={auditColumns}
                data={auditLogs}
                keyExtractor={(l) => l.id}
                compact
                pagination={{ defaultPageSize: 50 }}
                emptyMessage={t('No audit entries')}
              />
            ) : (
              <EmptyState message={t('No audit log entries')} />
            )}
          </div>
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Section 7 – Diagnostics (API Usage + Worker Health)
   ========================================================================== */

function DiagnosticsSection() {
  const { t } = useTranslation();

  const { data: apiUsage, isLoading: usageLoading } = useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: getAPIUsage,
    refetchInterval: 30_000,
  });

  const { data: workers, isLoading: workersLoading } = useQuery({
    queryKey: ['system-status', 'workers'],
    queryFn: getWorkersHealth,
    refetchInterval: 15_000,
  });

  const isLoading = usageLoading || workersLoading;

  // Bar chart data for API usage breakdown
  const usageChartData = apiUsage
    ? [
        { name: t('Requests'), value: apiUsage.total_requests },
        { name: t('Skipped'), value: apiUsage.skipped_polls },
      ]
    : [];

  return (
    <AccordionSection
      icon={<Cpu className="h-5 w-5" />}
      title={t('Diagnostics')}
      description={t('API usage dashboard and worker health')}
      badges={
        workers ? (
          <Badge
            variant={
              workers.healthy_count === workers.total ? 'success' : 'warning'
            }
            size="sm"
          >
            {workers.healthy_count}/{workers.total} {t('workers healthy')}
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* API Usage */}
          {apiUsage && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('API Usage')}
              </h4>
              <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                <MetricCard
                  label={t('Total Requests')}
                  value={fmtInt(apiUsage.total_requests)}
                  icon={<Activity className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Estimated Cost')}
                  value={`$${fmtNumber(apiUsage.estimated_cost, 2)}`}
                  icon={<DollarSign className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('Monthly Credit')}
                  value={`$${fmtNumber(apiUsage.monthly_credit, 2)}`}
                  icon={<DollarSign className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('Remaining')}
                  value={`$${fmtNumber(apiUsage.estimated_remaining, 2)}`}
                  icon={<Gauge className="h-4 w-4" />}
                  color="cyan"
                  subtitle={`${t('Skipped polls')}: ${fmtInt(apiUsage.skipped_polls)}`}
                />
              </Grid>

              {/* Cost gauge */}
              <div className="flex justify-center mb-4">
                <RadialGauge
                  value={apiUsage.estimated_cost}
                  max={apiUsage.monthly_credit || 1}
                  label={t('Budget Used')}
                  unit="$"
                  color={
                    apiUsage.estimated_remaining > apiUsage.monthly_credit * 0.5
                      ? '#22c55e'
                      : apiUsage.estimated_remaining >
                          apiUsage.monthly_credit * 0.2
                        ? '#f59e0b'
                        : '#ef4444'
                  }
                  size={140}
                />
              </div>

              {/* Usage bar chart */}
              <Card padding="sm">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={usageChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {usageChartData.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={CHART_COLORS[idx % CHART_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {/* Worker Health */}
          {workers ? (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                {t('Worker Health')}
              </h4>
              {workers.workers.length > 0 ? (
                <Grid cols={{ default: 1, md: 2, lg: 3 }} gap={3}>
                  {workers.workers.map((w) => (
                    <Card key={w.name} padding="sm">
                      <div className="flex items-center gap-3">
                        <IconBox
                          color={w.status === 'healthy' ? 'green' : 'red'}
                          size="sm"
                        >
                          {getStatusIcon(w.status)}
                        </IconBox>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {w.name}
                          </div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {w.host} · {fmtNumber(w.latency_ms, 0)} ms
                          </div>
                        </div>
                        <Badge
                          variant={statusToBadgeVariant(w.status)}
                          size="sm"
                        >
                          {w.status}
                        </Badge>
                      </div>
                      {w.error && (
                        <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                          {w.error}
                        </div>
                      )}
                    </Card>
                  ))}
                </Grid>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </AccordionSection>
  );
}

/* ==========================================================================
   Main Page Component
   ========================================================================== */

export default function SystemStatusPage() {
  const { t } = useTranslation();
  usePageTitle(t('System Status'));

  const queryClient = useQueryClient();

  const {
    data: health,
    isLoading,
    error,
    refetch: refetchHealth,
  } = useSystemHealth();

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const handleRefreshAll = useCallback(() => {
    refetchHealth();
    queryClient.invalidateQueries({ queryKey: ['system-status'] });
  }, [refetchHealth, queryClient]);

  const components = health
    ? Object.entries(health.components)
    : [];
  const okCount = components.filter(
    ([, c]) => c.status === 'ok',
  ).length;
  const degradedCount = components.filter(
    ([, c]) => c.status === 'degraded',
  ).length;
  const unhealthyCount = components.filter(
    ([, c]) => c.status === 'unhealthy',
  ).length;

  const overallStatus = health?.status ?? 'unknown';
  const glowColor: 'cyan' | 'green' | 'purple' | 'none' =
    overallStatus === 'healthy'
      ? 'green'
      : overallStatus === 'degraded'
        ? 'cyan'
        : 'none';

  return (
    <PageContainer
      title={t('System Status')}
      subtitle={t('Health monitoring for all backend services')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefreshAll}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {t('Refresh')}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* ================================================================
            Overall Status Hero
            ================================================================ */}
        <FadeIn>
          <GlassPanel glow={glowColor} className="p-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              {/* Big status indicator with glow */}
              <div className="flex flex-col items-center gap-3">
                <div
                  className={cn(
                    'h-20 w-20 rounded-full flex items-center justify-center',
                    'ring-2 ring-offset-2 ring-offset-transparent transition-shadow duration-700',
                    overallStatus === 'healthy' &&
                      'bg-green-500/20 ring-green-500/40',
                    overallStatus === 'degraded' &&
                      'bg-yellow-500/20 ring-yellow-500/40',
                    overallStatus === 'unhealthy' &&
                      'bg-red-500/20 ring-red-500/40',
                    overallStatus === 'unknown' &&
                      'bg-gray-500/20 ring-gray-500/40',
                  )}
                  style={{
                    boxShadow: `0 0 40px ${getStatusColor(overallStatus)}44`,
                  }}
                >
                  <div className={statusTextClass(overallStatus)}>
                    {overallStatus === 'healthy' ? (
                      <CheckCircle className="h-10 w-10" />
                    ) : overallStatus === 'degraded' ? (
                      <AlertTriangle className="h-10 w-10" />
                    ) : (
                      <XCircle className="h-10 w-10" />
                    )}
                  </div>
                </div>
                <span
                  className={cn('text-lg font-bold uppercase tracking-wider', statusTextClass(overallStatus))}
                >
                  {overallStatus}
                </span>
              </div>

              {/* Component badges + version info */}
              <div className="flex-1 space-y-4">
                {/* Per-component sub-badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {components.map(([name, comp]) => (
                    <Badge
                      key={name}
                      variant={statusToBadgeVariant(comp.status)}
                      size="sm"
                      dot
                    >
                      {name}
                    </Badge>
                  ))}
                </div>

                {/* Summary counts */}
                <Grid cols={{ default: 2, lg: 4 }} gap={3}>
                  <InlineMetric
                    icon={
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    }
                    value={okCount}
                    label={t('Healthy')}
                  />
                  <InlineMetric
                    icon={
                      <AlertTriangle className="h-4 w-4 text-yellow-400" />
                    }
                    value={degradedCount}
                    label={t('Degraded')}
                  />
                  <InlineMetric
                    icon={<XCircle className="h-4 w-4 text-red-400" />}
                    value={unhealthyCount}
                    label={t('Unhealthy')}
                  />
                  {version && (
                    <InlineMetric
                      icon={
                        <Package className="h-4 w-4 text-cyan-400" />
                      }
                      value={version.app_version}
                      label={t('Version')}
                    />
                  )}
                </Grid>

                {/* Version details */}
                {version && (
                  <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                    <span>
                      {t('Chart')}: {version.chart_version}
                    </span>
                    <span>
                      {t('Go')}: {version.go_version}
                    </span>
                    <span>
                      {t('Uptime')}:{' '}
                      {formatUptime(version.uptime_seconds)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* ================================================================
            Accordion Sections
            ================================================================ */}
        <StaggerContainer className="space-y-4">
          <StaggerItem>
            <HealthProbesSection />
          </StaggerItem>

          <StaggerItem>
            <BackendStatusSection />
          </StaggerItem>

          <StaggerItem>
            <ServiceHealthSection />
          </StaggerItem>

          <StaggerItem>
            <InfrastructureSection />
          </StaggerItem>

          <StaggerItem>
            <DataPipelineSection />
          </StaggerItem>

          <StaggerItem>
            <OperationsSection />
          </StaggerItem>

          <StaggerItem>
            <DiagnosticsSection />
          </StaggerItem>
        </StaggerContainer>
      </div>
    </PageContainer>
  );
}
