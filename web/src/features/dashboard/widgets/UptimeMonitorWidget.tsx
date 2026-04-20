import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const SERVICE_KEYS = ['database', 'mqtt', 'tesla_api', 'fleet_telemetry'] as const;

type ServiceStatus = 'ok' | 'healthy' | 'degraded' | 'unhealthy';

function statusVariant(status: ServiceStatus): 'success' | 'warning' | 'danger' {
  if (status === 'ok' || status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

function StatusDot({ status }: { status: ServiceStatus }) {
  const color =
    status === 'ok' || status === 'healthy'
      ? 'bg-green-500 shadow-green-500/40'
      : status === 'degraded'
        ? 'bg-amber-400 shadow-amber-400/40'
        : 'bg-red-500 shadow-red-500/40';

  return <span className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] ${color}`} />;
}

function ServiceRow({ label, status }: { label: string; status: ServiceStatus }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StatusDot status={status} />
        <span className="text-xs text-white/70">{label}</span>
      </div>
      <Badge variant={statusVariant(status)} className="text-[10px]">
        {status === 'ok' || status === 'healthy' ? 'OK' : status}
      </Badge>
    </div>
  );
}

export default function UptimeMonitorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useSystemHealth();

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const services = useMemo(() => {
    const components = data?.components ?? {};
    return SERVICE_KEYS.map((key) => ({
      key,
      label: t(`widget.uptime.${key}`, key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
      status: (components[key]?.status ?? 'unhealthy') as ServiceStatus,
      failures: components[key]?.consecutiveFailures ?? 0,
      lastError: components[key]?.lastError ?? null,
    }));
  }, [data, t]);

  const overallStatus = data?.status ?? 'unknown';
  const healthyCount = services.filter(
    (s) => s.status === 'ok' || s.status === 'healthy',
  ).length;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.uptime.title', 'Uptime Monitor')}
      icon={<Activity className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        <div className="flex flex-col gap-2 h-full">
          {/* Overall status badge */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              {t('widget.uptime.overall', 'Overall')}
            </span>
            <Badge variant={statusVariant(overallStatus as ServiceStatus)}>
              {overallStatus === 'healthy'
                ? t('widget.uptime.allOk', 'All OK')
                : overallStatus}
            </Badge>
          </div>

          {isCompact ? (
            /* Compact: just the count */
            <div className="flex-1 flex items-center justify-center">
              <span className="text-2xl font-bold text-white/90">
                {healthyCount}/{services.length}
              </span>
            </div>
          ) : (
            /* Full: row per service */
            <div className="flex flex-col gap-2">
              {services.map((svc) => (
                <ServiceRow key={svc.key} label={svc.label} status={svc.status} />
              ))}
            </div>
          )}

          {/* Extended detail in tall mode */}
          {isTall && !isCompact && (
            <div className="mt-auto pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between text-[10px] text-white/40">
                <span>{t('widget.uptime.dbSize', 'DB Size')}</span>
                <span className="text-white/60">{data.databaseSize ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/40">
                <span>{t('widget.uptime.tables', 'Tables')}</span>
                <span className="text-white/60">{data.tableCount ?? '—'}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.uptime.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
