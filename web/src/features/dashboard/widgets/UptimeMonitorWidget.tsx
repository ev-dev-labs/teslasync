import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatusGrid, type StatusCell } from './shared';
import type { WidgetProps } from './types';

const SERVICE_KEYS = ['database', 'mqtt', 'tesla_api', 'fleet_telemetry'] as const;
type StatusKind = 'success' | 'warning' | 'danger' | 'unknown';
type Translate = (key: string, fallback: string) => string;

export function classifyStatus(status: string | null | undefined): StatusKind {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'success';
    case 'degraded':
    case 'warning':
      return 'warning';
    case 'unknown':
    case '':
      return 'unknown';
    default:
      return 'danger';
  }
}

export function statusLabel(kind: StatusKind, t: Translate): string {
  if (kind === 'success') return t('widget.uptime.statusOk', 'OK');
  if (kind === 'warning') return t('widget.uptime.statusDegraded', 'Degraded');
  if (kind === 'unknown') return t('widget.uptime.statusUnknown', 'Unknown');
  return t('widget.uptime.statusDown', 'Down');
}

export default function UptimeMonitorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const query = useSystemHealth();
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = deriveDataState(
    { ...query, data: data ?? (isLoading || query.isError || query.error ? undefined : null) },
    { provenance: 'cached', unavailable: data == null && !isLoading && !isError && !query.error },
  );

  const isCompact = size.cols <= 1;
  const services = useMemo(() => {
    const components = data?.components ?? {};
    return SERVICE_KEYS.map((key) => {
      const component = components[key];
      const kind = classifyStatus(component?.status);
      const label = t(
        `widget.uptime.${key}`,
        key === 'tesla_api' ? 'Tesla API'
          : key === 'mqtt' ? 'MQTT'
            : key === 'fleet_telemetry' ? 'Fleet Telemetry'
            : 'Database',
      );
      const failures = component?.consecutiveFailures;
      return {
        key,
        label,
        kind,
        value: [
          failures != null && failures > 0
            ? `×${failures} ${t('widget.uptime.consecutiveFailures', 'consecutive failures')}`
            : null,
          component?.lastError ?? null,
        ].filter(Boolean).join(' · ') || undefined,
      };
    });
  }, [data, t]);

  const cells: StatusCell[] = services.map((service) => ({
    id: service.key,
    label: service.label,
    status: service.kind === 'success' ? 'ok' : service.kind === 'danger' ? 'error' : service.kind,
    statusLabel: statusLabel(service.kind, t),
    value: service.value,
  }));
  const healthyCount = services.filter((service) => service.kind === 'success').length;

  return (
    <WidgetShell
      title={t('widget.uptime.title', 'Uptime monitor')}
      icon={<Activity className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      error={state.fatalError?.message}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refetch}
    >
      {isCompact ? (
        <div className="flex h-full items-center justify-center">
          <WidgetBigNumber
            value={data ? `${healthyCount}/${services.length}` : null}
            label={t('widget.uptime.servicesHealthy', 'Services healthy')}
          />
        </div>
      ) : (
        <WidgetStatusGrid
          cells={cells}
          cols={size.cols >= 3 ? 4 : 2}
          emptyMessage={t('widget.uptime.noData', 'No system health data')}
        />
      )}
      {!data && !isLoading && (
        <EmptyState
          variant="informational"
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.uptime.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
