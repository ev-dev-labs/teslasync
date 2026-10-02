import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Badge, Caption } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid, type StatusCell } from './shared';
import type { WidgetProps } from './types';

const SERVICE_KEYS = ['database', 'mqtt', 'tesla_api', 'fleet_telemetry'] as const;

type StatusKind = 'success' | 'warning' | 'danger' | 'unknown';

type TFn = (key: string, fallback: string) => string;

// Collapse any backend status string into a single visual kind. The health
// contract (ComponentStatus in @/types/admin) emits 'healthy'/'ok' for good,
// 'degraded'/'warning' for recoverable, a family of broken states
// ('unhealthy'/'offline'/'down'/'failed') for danger, and 'unknown' when a
// probe has never run. Anything unrecognised is treated as broken so a
// newly-added bad state fails safe (red) rather than silently reading healthy.
function classifyStatus(status: string | null | undefined): StatusKind {
  switch (status?.toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'success';
    case 'degraded':
    case 'warning':
      return 'warning';
    case 'unknown':
    case '':
    case undefined:
    case null:
      return 'unknown';
    default:
      return 'danger';
  }
}

const KIND_BADGE: Record<StatusKind, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  unknown: 'neutral',
};

function kindLabel(kind: StatusKind, t: TFn): string {
  switch (kind) {
    case 'success':
      return t('widget.uptime.statusOk', 'OK');
    case 'warning':
      return t('widget.uptime.statusDegraded', 'Degraded');
    case 'unknown':
      return t('widget.uptime.statusUnknown', 'Unknown');
    default:
      return t('widget.uptime.statusDown', 'Down');
  }
}

export default function UptimeMonitorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const query = useSystemHealth();
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = deriveDataState({ ...query, data: data ?? (isLoading || query.isError || query.error ? undefined : null) });

  // Match the sibling system widgets (SystemHealthWidget / APIUsageWidget): a
  // single-column placement is "compact". The registered minSize is 1×2, so the
  // previous `cols === 1 && rows === 1` condition was unreachable and the compact
  // count never rendered — a 1-wide widget wrongly showed the full per-service
  // list crammed into one narrow column.
  const isCompact = size.cols <= 1;
  const isTall = size.rows >= 2;

  const services = useMemo(() => {
    const components = data?.components ?? {};
    return SERVICE_KEYS.map((key) => {
      const status = components[key]?.status;
      const kind = classifyStatus(status);
      const failures = components[key]?.consecutiveFailures;
      return {
        key,
        label: t(
          `widget.uptime.${key}`,
          key === 'tesla_api' ? 'Tesla API'
            : key === 'mqtt' ? 'MQTT'
              : key === 'fleet_telemetry' ? 'Fleet Telemetry'
              : key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
        ),
        kind,
        statusLabel: kindLabel(kind, t),
        failures,
        failuresLabel: `${failures} ${t('widget.uptime.consecutiveFailures', 'consecutive failures')}`,
        lastError: components[key]?.lastError ?? null,
      };
    });
  }, [data, t]);

  const totalCount = services.length;
  const healthyCount = services.filter((s) => s.kind === 'success').length;
  const overallKind = classifyStatus(data?.status ?? 'unknown');
  const overallLabel =
    data?.status === 'healthy' ? t('widget.uptime.allOk', 'All OK') : kindLabel(overallKind, t);
  const summaryLabel = t('widget.uptime.servicesHealthy', 'Services healthy');
  const cells: StatusCell[] = services.map((service) => ({
    id: service.key,
    label: service.label,
    status: service.kind === 'success' ? 'ok' : service.kind === 'danger' ? 'error' : service.kind,
    statusLabel: service.statusLabel,
    value: [
      service.failures != null && service.failures > 0 ? `×${service.failures} ${t('widget.uptime.consecutiveFailures', 'consecutive failures')}` : null,
      service.lastError,
    ].filter(Boolean).join(' · ') || undefined,
  }));

  // Only replace the whole widget with a full-panel error on the INITIAL load
  // failure, when there is no cached health payload to fall back on. This widget
  // refetches on an interval, so once data is on screen a transient
  // background-refetch failure must not blank out otherwise-valid status — it is
  // surfaced through the freshness indicator's error state instead (WidgetShell
  // forwards `isError` to <DataFreshness>).
  const blockingError = state.fatalError?.message;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.uptime.title', 'Uptime monitor')}
      icon={<Activity className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      error={blockingError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refetch}
    >
        <div className="flex h-full flex-col gap-2">
          {/* Overall status badge */}
          <div className="flex items-center justify-between">
            <Caption>
              {t('widget.uptime.overall', 'Overall')}
            </Caption>
            <Badge variant={KIND_BADGE[overallKind]}>{overallLabel}</Badge>
          </div>

          {isCompact ? (
            /* Compact: just the healthy/total count */
            <div className="flex flex-1 items-center justify-center">
              <WidgetBigNumber value={data ? `${healthyCount}/${totalCount}` : null} label={summaryLabel} />
            </div>
          ) : (
            /* Full: row per service */
            <WidgetStatusGrid cells={cells} cols={size.cols >= 3 ? 4 : 2} />
          )}

          {/* Extended detail in tall, non-compact mode */}
          {isTall && !isCompact && (
            <WidgetStatGrid cols={2} stats={[
              { label: t('widget.uptime.dbSize', 'DB size'), value: data?.databaseSize || '—' },
              { label: t('widget.uptime.tables', 'Tables'), value: data?.tableCount ?? '—' },
            ]} />
          )}
        {!data && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.uptime.noData', 'No system health data')}
          className="py-4"
        />
        )}
        </div>
    </WidgetShell>
  );
}
