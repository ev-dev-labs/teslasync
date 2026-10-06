import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useSystemHealth, useDBStats, useConnectionPool } from '@/api/hooks/useAdmin';

import { combineDataStates, deriveDataState, knownNumber, type DataState } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid, type StatusCell } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { sourcePresentation } from '../components/continuation-dashboard-3/sourcePresentation';

type Translate = (key: string, fallback: string) => string;

/**
 * Normalised health tier. Collapses the open-ended backend status vocabulary
 * (`healthy`/`ok`/`degraded`/`warning`/`unhealthy`/`offline`/`down`/`failed`/
 * `unknown`/…) into the four visual tiers this widget renders. Keeping the
 * mapping here — instead of a raw-string → colour switch — means a recoverable
 * `warning` shares the amber `degraded` tier (rather than the alarming red
 * `down` tier), and a never-polled `unknown` component stays neutral grey.
 */
export type StatusTier = 'ok' | 'degraded' | 'unknown' | 'down';

const SERVICE_KEYS = [
  { key: 'database', i18n: 'db' },
  { key: 'mqtt', i18n: 'mqtt' },
  { key: 'tesla_api', i18n: 'teslaApi' },
  { key: 'fleet_telemetry', i18n: 'workers' },
] as const;

/**
 * Map a raw component status onto one of four visual tiers. Case-insensitive
 * and null-safe: a `null`/`undefined`/empty status carries no information, so
 * it is treated as neutral `unknown` (never an alarmist red), while any
 * unrecognised *non-empty* value degrades to `down`. Never throws.
 */
export function statusTier(status: string | null | undefined): StatusTier {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'ok';
    case 'degraded':
    case 'warning':
      return 'degraded';
    case 'unknown':
    case '':
      return 'unknown';
    default:
      return 'down';
  }
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

/** Human label for the overall system status shown in the compact layout. */
export function overallLabel(status: string, t: Translate): string {
  return tierLabel(statusTier(status), t);
}

/** Map the overall system status onto a StatusBadge presence tone. */
export function overallBadgeStatus(status: string): 'online' | 'away' | 'offline' | 'unknown' {
  if (statusTier(status) === 'ok') return 'online';
  if (statusTier(status) === 'degraded') return 'away';
  if (statusTier(status) === 'unknown') return 'unknown';
  return 'offline';
}

export default function SystemHealthWidget({ size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');

  const health = useSystemHealth();
  const dbStats = useDBStats();
  const pool = useConnectionPool();

  const isCompact = size.cols <= 1;

  const services = useMemo(() => {
    const components = health.data?.components ?? {};
    return SERVICE_KEYS.map((svc) => {
      const tier = statusTier(components[svc.key]?.status);
      const label = t(
        `widget.systemHealth.${svc.i18n}`,
        svc.key === 'tesla_api' ? 'Tesla API'
          : svc.key === 'mqtt' ? 'MQTT'
            : svc.key === 'fleet_telemetry' ? 'Fleet Telemetry'
            : svc.key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      );
      return { key: svc.key, label, tier, a11yLabel: `${label}: ${tierLabel(tier, t)}` };
    });
  }, [health.data, t]);

  const overallStatus = health.data?.status ?? 'unknown';
  const healthyCount = services.filter((s) => s.tier === 'ok').length;

  // `||` (not `??`) so an empty-string databaseSize also degrades to the
  // placeholder instead of rendering a blank stat value.
  const dbSize = health.data?.databaseSize || dbStats.data?.databaseSize || '—';
  const activeConns = knownNumber(pool.data?.inUse);
  const maxConns = knownNumber(pool.data?.maxOpen);
  const runtime = pool.data;
  const goroutines = knownNumber(runtime && 'goroutines' in runtime ? runtime.goroutines : null);
  const memory = knownNumber(runtime && 'memoryMB' in runtime ? runtime.memoryMB : null);
  const sourceStates = [health, dbStats, pool].map((query) =>
    deriveDataState({ ...query, data: query.data ?? (query.isLoading || query.isError || query.error ? undefined : null) }));
  const state: DataState<unknown> = { ...sourceStates[0]!, ...combineDataStates(sourceStates) };
  state.hasData = health.data != null || dbStats.data != null || pool.data != null;
  state.data = state.hasData ? { health: health.data, dbStats: dbStats.data, pool: pool.data } : undefined;
  if (health.data == null && dbStats.data == null && pool.data == null) {
    const fatal = sourceStates.find((source) => source.fatalError)?.fatalError;
    if (fatal) { state.status = 'initialFailure'; state.fatalError = fatal; }
  }
  const cells: StatusCell[] = services.map((service) => ({
    id: service.key,
    label: service.label,
    status: service.tier === 'degraded' ? 'warning' : service.tier === 'down' ? 'error' : service.tier,
    statusLabel: tierLabel(service.tier, t),
  }));
  const summary = health.data ? `${healthyCount}/${services.length}` : null;

  const isLoading = health.isLoading;
  const hasError = state.fatalError?.message;
  const hasData = health.data != null;
  const hasDatabaseSize = dbSize !== '—';
  const databaseSources = [sourceStates[0]!, sourceStates[1]!];
  const databaseCombined = combineDataStates(databaseSources);
  const databaseFailure = databaseSources.find((source) => source.fatalError)?.fatalError ?? null;
  const databaseState: DataState<unknown> = {
    ...sourceStates[1]!,
    ...databaseCombined,
    data: hasDatabaseSize ? dbSize : undefined,
    hasData: hasDatabaseSize,
    fatalError: hasDatabaseSize ? null : databaseFailure,
    refreshError: hasDatabaseSize ? databaseCombined.refreshError ?? databaseFailure : null,
    status: !hasDatabaseSize && databaseFailure ? 'initialFailure'
      : !hasDatabaseSize && databaseSources.some((source) => source.status === 'initial') ? 'initial'
        : databaseCombined.status,
  };
  const databaseStats = <WidgetStatGrid cols={2} stats={[
    { label: t('widget.systemHealth.dbSize', 'DB size'), value: dbSize },
  ]} />;
  const poolStats = <WidgetStatGrid cols={2} stats={[
    { label: t('widget.systemHealth.activeConns', 'Active conns'),
      value: activeConns == null ? '—' : maxConns != null && maxConns > 0 ? `${fmtInt(activeConns)}/${fmtInt(maxConns)}` : fmtInt(activeConns) },
    { label: t('widget.systemHealth.memory', 'Memory'), value: memory == null ? '—' : `${fmtInt(memory)} MB` },
    { label: t('widget.systemHealth.goroutines', 'Goroutines'), value: goroutines == null ? '—' : fmtInt(goroutines) },
  ]} />;

  return (
    <WidgetShell
      title={t('widget.systemHealth.title', 'System health')}
      icon={<Server className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      error={hasError}
      updatedAt={state.updatedAt ?? 0}
      isFetching={health.isFetching || dbStats.isFetching || pool.isFetching}
      isStale={health.isStale || dbStats.isStale || pool.isStale}
      isError={health.isError || dbStats.isError || pool.isError}
      onRefresh={() => { void health.refetch(); void dbStats.refetch(); void pool.refetch(); }}
    >
      {isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <Badge variant={overallStatus === 'healthy' ? 'success' : overallStatus === 'degraded' ? 'warning' : statusTier(overallStatus) === 'unknown' ? 'neutral' : 'danger'}>
              {overallLabel(overallStatus, t)}
            </Badge>
            <WidgetBigNumber value={summary} label={t('widget.systemHealth.services', 'Services')} />
          </div>
        ) : (
          /* ── Standard layout (2×4) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Service status grid */}
            <SourceContent
              state={sourcePresentation(sourceStates[0]!, hasData)}
              label={t('widget.systemHealth.services', 'Services')}
              emptyMessage={t('widget.systemHealth.noData', 'No system health data')}
              errorMessage={t('widget.systemHealth.healthError', 'Unable to load service health')}
              error={sourceStates[0]!.fatalError}
              errorRecovery={{ onRetry: sourceStates[0]!.retry ?? undefined }}
              emptyContent={<>
                <WidgetStatusGrid cells={cells} cols={size.cols >= 3 ? 4 : 2} />
                <EmptyState /* no-action: unknown services retain shell refresh and independent source retry */
                  message={t('widget.systemHealth.noData', 'No system health data')} className="py-4" />
              </>}
            >
              <WidgetStatusGrid cells={cells} cols={size.cols >= 3 ? 4 : 2} />
            </SourceContent>

            {/* Stats grid */}
            <SourceContent
              state={sourcePresentation(databaseState, databaseState.hasData)}
              label={t('widget.systemHealth.dbSize', 'DB size')}
              emptyMessage={t('widget.systemHealth.noDatabaseData', 'No database size data')}
              errorMessage={t('widget.systemHealth.databaseError', 'Unable to load database size')}
              error={databaseState.fatalError}
              errorRecovery={{ onRetry: () => { void health.refetch(); void dbStats.refetch(); } }}
              emptyContent={databaseStats}
            >
            {databaseStats}
            </SourceContent>
            <SourceContent
              state={sourcePresentation(sourceStates[2]!, pool.data != null)}
              label={t('widget.systemHealth.activeConns', 'Active conns')}
              emptyMessage={t('widget.systemHealth.noPoolData', 'No connection pool data')}
              errorMessage={t('widget.systemHealth.poolError', 'Unable to load connection pool data')}
              error={sourceStates[2]!.fatalError}
              errorRecovery={{ onRetry: sourceStates[2]!.retry ?? undefined }}
              emptyContent={poolStats}
            >
            {poolStats}
            </SourceContent>
          </div>
      )}
      {isCompact && !hasData && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Server className="h-5 w-5" />}
          message={t('widget.systemHealth.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
