import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Satellite, Radio, Zap, TrendingUp } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { getTelemetryStatus } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';

export function ServiceHealthSection() {
  const { t } = useTranslation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['system-status', 'telemetry'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000,
  });

  const vehicles = data?.streaming_vehicles ? Object.values(data.streaming_vehicles) : [];
  const activeCount = vehicles.filter((v) => v.is_streaming).length;

  type VehicleRow = (typeof vehicles)[number];

  const vehicleColumns = useMemo<Column<VehicleRow>[]>(() => [
    { key: 'vin', header: t('VIN'), render: (row) => <span className="font-mono text-xs">{row.vin ?? '—'}</span> },
    {
      key: 'status', header: t('Status'),
      render: (row) => <Badge variant={row.is_streaming ? 'success' : 'neutral'} size="sm" dot>{row.is_streaming ? t('Streaming') : t('Idle')}</Badge>,
    },
    { key: 'signal_count', header: t('Signals'), sortable: true, render: (row) => fmtInt(row.signal_count) },
    { key: 'signals_per_second', header: t('Signals/s'), render: (row) => fmtNumber(row.signals_per_second, 1) },
    { key: 'latency_ms', header: t('Latency'), render: (row) => `${fmtNumber(row.latency_ms, 0)} ms` },
    { key: 'last_received', header: t('Last Received'), render: (row) => formatDateTime(row.last_received) },
  ], [t]);

  return (
    <AccordionSection
      icon={<Satellite className="h-5 w-5" />}
      title={t('Service Health')}
      description={t('Fleet Telemetry streaming status')}
      badges={
        data ? (
          <>
            <Badge variant={data.enabled ? 'success' : 'neutral'} size="sm" dot>
              {data.enabled ? t('Enabled') : t('Disabled')}
            </Badge>
            <Badge variant="info" size="sm">{activeCount} {t('streaming')}</Badge>
          </>
        ) : undefined
      }
    >
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error && !data ? (
        <QueryError error={error as Error} onRetry={() => refetch()} />
      ) : !data ? (
        // no-action: health data appears when the telemetry service publishes its first report.
        <EmptyState
          message={t(
            'system.empty.telemetry',
            'Telemetry service health has not reported yet.',
          )}
          description={t(
            'system.empty.telemetryDescription',
            'Connection mode, vehicle counts, and signal throughput appear after the telemetry service publishes health data.',
          )}
        />
      ) : (
        <div className="space-y-4">
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <MetricCard label={t('Mode')} value={data.mode ?? '—'} icon={<Radio className="h-4 w-4" />} color="cyan" />
            <MetricCard label={t('Vehicles Connected')} value={activeCount} icon={<Satellite className="h-4 w-4" />} color="green" />
            <MetricCard label={t('Total Signals')} value={fmtInt(data.aggregate_stats?.total_signals_received ?? 0)} icon={<Zap className="h-4 w-4" />} color="purple" />
            <MetricCard label={t('Avg Signals/s')} value={data.aggregate_stats?.avg_signals_per_second ?? '0'} icon={<TrendingUp className="h-4 w-4" />} color="cyan" />
          </Grid>
          <DataTable
            tableId="system:service-vehicles"
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
