import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { StatusBadge, StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth, useDBStats, useConnectionPool } from '@/api/hooks/useAdmin';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

type ServiceStatus = 'ok' | 'healthy' | 'degraded' | 'unhealthy';

const SERVICE_KEYS = [
  { key: 'database', i18n: 'db', emoji: '🟢' },
  { key: 'mqtt', i18n: 'mqtt', emoji: '🟢' },
  { key: 'tesla_api', i18n: 'teslaApi', emoji: '🟢' },
  { key: 'fleet_telemetry', i18n: 'workers', emoji: '🟢' },
] as const;

function statusColor(status: ServiceStatus): string {
  if (status === 'ok' || status === 'healthy') return 'bg-green-500 shadow-green-500/40';
  if (status === 'degraded') return 'bg-amber-400 shadow-amber-400/40';
  return 'bg-red-500 shadow-red-500/40';
}

function StatusDot({ status }: { status: ServiceStatus }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] ${statusColor(status)}`} />;
}

function overallLabel(status: string, t: (key: string, fallback: string) => string): string {
  if (status === 'healthy') return t('widget.systemHealth.healthy', 'Healthy');
  if (status === 'degraded') return t('widget.systemHealth.degraded', 'Degraded');
  return t('widget.systemHealth.down', 'Down');
}

function overallBadgeStatus(status: string): 'online' | 'away' | 'offline' {
  if (status === 'healthy') return 'online';
  if (status === 'degraded') return 'away';
  return 'offline';
}

export default function SystemHealthWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const health = useSystemHealth();
  const dbStats = useDBStats();
  const pool = useConnectionPool();

  const isCompact = size.cols <= 1;

  const services = useMemo(() => {
    const components = health.data?.components ?? {};
    return SERVICE_KEYS.map((svc) => ({
      key: svc.key,
      label: t(`widget.systemHealth.${svc.i18n}`, svc.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
      status: (components[svc.key]?.status ?? 'unhealthy') as ServiceStatus,
    }));
  }, [health.data, t]);

  const overallStatus = health.data?.status ?? 'unknown';
  const healthyCount = services.filter((s) => s.status === 'ok' || s.status === 'healthy').length;

  const dbSize = health.data?.databaseSize ?? dbStats.data?.databaseSize ?? '—';
  const activeConns = pool.data?.inUse ?? 0;
  const maxConns = pool.data?.maxOpen ?? 0;
  const goroutines = (pool.data as Record<string, unknown> | undefined)?.goroutines;
  const memory = (pool.data as Record<string, unknown> | undefined)?.memoryMB;

  const isLoading = health.isLoading;
  const hasError = health.error ? String(health.error) : null;
  const hasData = health.data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.systemHealth.title', 'System Health')}
      icon={<Server className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={hasError}
      updatedAt={health.dataUpdatedAt}
      isFetching={health.isFetching}
      isStale={health.isStale}
      isError={health.isError}
      onRefresh={() => health.refetch()}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <StatusBadge status={overallBadgeStatus(overallStatus)} size="sm" />
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {overallLabel(overallStatus, t)}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {healthyCount}/{services.length} {t('widget.systemHealth.services', 'services')}
            </span>
          </div>
        ) : (
          /* ── Standard layout (2×4) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Service status grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {services.map((svc) => (
                <div key={svc.key} className="flex items-center gap-2 min-h-[44px]">
                  <StatusDot status={svc.status} />
                  <span className="text-xs text-[var(--text-secondary)] truncate">{svc.label}</span>
                </div>
              ))}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2 mt-auto">
              <StatCard
                label={t('widget.systemHealth.dbSize', 'DB Size')}
                value={dbSize}
              />
              <StatCard
                label={t('widget.systemHealth.activeConns', 'Active Conns')}
                value={maxConns > 0 ? `${fmtInt(activeConns)}/${fmtInt(maxConns)}` : fmtInt(activeConns)}
              />
              <StatCard
                label={t('widget.systemHealth.memory', 'Memory')}
                value={memory != null ? `${fmtInt(memory)} MB` : '—'}
              />
              <StatCard
                label={t('widget.systemHealth.goroutines', 'Goroutines')}
                value={goroutines != null ? fmtInt(goroutines) : '—'}
              />
            </div>
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Server className="h-5 w-5" />}
          message={t('widget.systemHealth.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
