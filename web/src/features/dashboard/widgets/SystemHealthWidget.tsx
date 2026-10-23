import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { combineDataStates, deriveDataState, knownNumber, type DataState } from '@/api/dataState';
import { useSystemHealth, useConnectionPool, useDBStats } from '@/api/hooks/useAdmin';
import { useVersionInfo } from '@/api/hooks/useSettings';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid, type StatusCell } from './shared';
import type { WidgetProps } from './types';

type Translate = (key: string, fallback: string) => string;

export type StatusTier = 'ok' | 'degraded' | 'unknown' | 'down';

const SERVICE_KEYS = [
  { key: 'database', i18n: 'db' },
  { key: 'mqtt', i18n: 'mqtt' },
  { key: 'tesla_api', i18n: 'teslaApi' },
  { key: 'fleet_telemetry', i18n: 'workers' },
] as const;

export function statusTier(status: string | null | undefined): StatusTier {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'ok';
    case 'degraded':
    case 'warning':
      return 'degraded';
    case 'unknown':
    case '':
      return 'unknown';
    case 'unhealthy':
    case 'offline':
    case 'down':
    case 'failed':
      return 'down';
    default:
      return 'unknown';
  }
}

export function formatUptime(seconds: unknown): string | null {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
      const total = Math.floor(seconds);
      const days = Math.floor(total / 86_400);
      const hours = Math.floor((total % 86_400) / 3_600);
      const minutes = Math.floor((total % 3_600) / 60);
      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
}

const TIER_LABEL: Record<StatusTier, { key: string; fallback: string }> = {
  ok: { key: 'widget.systemHealth.statusOk', fallback: 'Healthy' },
  degraded: { key: 'widget.systemHealth.statusDegraded', fallback: 'Degraded' },
  unknown: { key: 'widget.systemHealth.statusUnknown', fallback: 'Unknown' },
  down: { key: 'widget.systemHealth.statusDown', fallback: 'Down' },
};

function tierLabel(tier: StatusTier, t: Translate): string {
  const meta = TIER_LABEL[tier];
  return t(meta.key, meta.fallback);
}

export function overallLabel(status: string, t: Translate): string {
  return tierLabel(statusTier(status), t);
}

export function overallBadgeStatus(status: string): 'online' | 'away' | 'offline' | 'unknown' {
  switch (statusTier(status)) {
    case 'ok':
      return 'online';
    case 'degraded':
      return 'away';
    case 'down':
      return 'offline';
    default:
      return 'unknown';
  }
}

export default function SystemHealthWidget({ size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const health = useSystemHealth();
  const pool = useConnectionPool();
  const db = useDBStats();
  const version = useVersionInfo();
  const isCompact = size.cols <= 1;

  const services = useMemo(() => SERVICE_KEYS.map((svc) => {
    const status = health.data?.components?.[svc.key]?.status;
    const tier = statusTier(status);
    const label = t(
      `widget.systemHealth.${svc.i18n}`,
      svc.key === 'tesla_api' ? 'Tesla API'
        : svc.key === 'mqtt' ? 'MQTT'
          : svc.key === 'fleet_telemetry' ? 'Fleet Telemetry'
          : svc.key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    );
    return { key: svc.key, label, tier };
  }), [health.data, t]);

  const sourceStates = [health, pool, ...(db ? [db] : []), version].map((query) =>
    deriveDataState({
      ...query,
      data: query.data ?? (query.isLoading || query.isError || query.error ? undefined : null),
    }));
  const state: DataState<unknown> = {
    ...combineDataStates(sourceStates),
    hasData: health.data != null || pool.data != null || db.data != null || version.data != null,
    data: health.data != null || pool.data != null || db.data != null || version.data != null
      ? { health: health.data, pool: pool.data, db: db.data, version: version.data }
      : undefined,
    status: health.isError && health.data == null
      && pool.data == null && db.data == null && version.data == null
      ? 'initialFailure'
      : combineDataStates(sourceStates).status,
    fatalError: health.isError && health.data == null
      && pool.data == null && db.data == null && version.data == null
      ? (health.error instanceof Error ? health.error : new Error('Unable to load system health'))
      : null,
    retry: () => {
      void health.refetch();
      void pool.refetch();
      void db.refetch();
      void version.refetch();
    },
  };

  const overallStatus = health.data?.status ?? 'unknown';
  const healthyCount = services.filter((service) => service.tier === 'ok').length;
  const summary = health.data ? `${healthyCount}/${services.length}` : null;
  const poolRecord = pool.data as {
    memoryMB?: number;
    memory?: { allocBytes?: number; alloc_bytes?: number };
    goroutines?: number;
    max_open?: number;
    maxOpen?: number;
    in_use?: number;
    inUse?: number;
  } | undefined;
  const memory = poolRecord?.memoryMB != null
    ? knownNumber(poolRecord.memoryMB)
    : knownNumber(poolRecord?.memory?.allocBytes ?? poolRecord?.memory?.alloc_bytes);
  const memoryMB = memory != null && poolRecord?.memoryMB == null ? memory / 1024 / 1024 : memory;
  const memoryValue = memory == null ? null : `${fmtInt(memory)} MB`;
  const formattedMemoryValue = poolRecord?.memoryMB != null
    ? memoryValue
    : memoryMB == null ? null : `${fmtInt(memoryMB)} MB`;
  const goroutines = knownNumber(poolRecord?.goroutines);
  const activeConns = knownNumber(poolRecord?.inUse ?? poolRecord?.in_use);
  const maxConns = knownNumber(poolRecord?.maxOpen ?? poolRecord?.max_open);
  const connectionValue = activeConns == null
    ? null
    : maxConns != null && maxConns > 0
      ? `${fmtInt(activeConns)}/${fmtInt(maxConns)}`
      : fmtInt(activeConns);
  const dbSize = health.data?.databaseSize ?? db.data?.databaseSize ?? null;
  const uptimeSeconds = knownNumber((version.data as { uptime_seconds?: unknown } | undefined)?.uptime_seconds);
  const uptimeValue = formatUptime(uptimeSeconds);

  const cells: StatusCell[] = services.map((service) => ({
    id: service.key,
    label: service.label,
    status: service.tier === 'degraded'
      ? 'warning'
      : service.tier === 'down'
        ? 'error'
        : service.tier,
    statusLabel: tierLabel(service.tier, t),
  }));

  const isLoading = Boolean(
    health.isLoading && pool.isLoading && db.isLoading && version.isLoading
      ? true
      : health.isLoading && health.data == null
  );
  return (
    <WidgetShell
      title={t('widget.systemHealth.title', 'System health')}
      icon={<Server className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      error={state.fatalError?.message ?? null}
      updatedAt={state.updatedAt ?? 0}
      isFetching={health.isFetching || pool.isFetching || db.isFetching || version.isFetching}
      isStale={health.isStale || pool.isStale || db.isStale || version.isStale}
      isError={health.isError || pool.isError || db.isError || version.isError}
      onRefresh={() => {
        void health.refetch();
        void pool.refetch();
        void db.refetch();
        void version.refetch();
      }}
    >
      {isCompact ? (
        <div className="flex h-full min-h-[44px] flex-col items-center justify-center gap-2">
          <Badge variant={
            statusTier(overallStatus) === 'ok' ? 'success'
              : statusTier(overallStatus) === 'degraded' ? 'warning'
                : statusTier(overallStatus) === 'down' ? 'danger'
                  : 'neutral'
          }>
            {overallLabel(overallStatus, t)}
          </Badge>
          <WidgetBigNumber value={summary} label={t('widget.systemHealth.services', 'Services')} align="center" animated={false} />
        </div>
      ) : (
        <div className="flex h-full min-w-0 flex-col gap-3">
          {health.data ? (
            <WidgetStatusGrid cells={cells} cols={size.cols >= 3 ? 4 : 2} />
          ) : !health.isLoading ? (
            <EmptyState
              message={health.isError
                ? t('widget.systemHealth.healthError', 'Unable to load service health')
                : t('widget.systemHealth.noData', 'No system health data')}
              className="py-2"
            />
          ) : null}
          {isLoading && (
            <div role="status" aria-label={t('widget.systemHealth.loadingServices', 'Loading Services')}>
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          )}
          <WidgetStatGrid
            cols={3}
            stats={[
              { label: t('widget.systemHealth.dbSize', 'DB size'), value: dbSize },
              { label: t('widget.systemHealth.memory', 'Memory'), value: formattedMemoryValue ?? null },
              { label: t('widget.systemHealth.activeConns', 'Active conns'), value: connectionValue },
              { label: t('widget.systemHealth.goroutines', 'Goroutines'), value: goroutines == null ? null : fmtInt(goroutines) },
              { label: t('widget.versionInfo.serverUptime', 'Server uptime'), value: uptimeValue },
            ]}
          />
        </div>
      )}
    </WidgetShell>
  );
}
