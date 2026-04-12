import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatRelative(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

export default function MQTTInspectorPage() {
  const { t } = useTranslation();
  const { data: status, isLoading, error } = useMQTTStatus();

  const vehicles = status?.vehicles ?? [];
  const totalSignals = vehicles.reduce((sum, v) => sum + v.signalCount, 0);
  const totalBatches = vehicles.reduce((sum, v) => sum + v.batchCount, 0);
  const totalRate = vehicles.reduce((sum, v) => sum + (v.signalsPerSec ?? 0), 0);

  const staleVehicles = useMemo(
    () => vehicles.filter((v) => {
      if (!v.lastReceived) return true;
      return Date.now() - new Date(v.lastReceived).getTime() > 120_000;
    }),
    [vehicles],
  );

  return (
    <PageContainer
      title={t('MQTT Inspector')}
      subtitle={t('Monitor MQTT connection and streaming telemetry')}
      loading={isLoading}
      error={error as Error | null}
      empty={!status}
      emptyMessage={t('No MQTT status available.')}
      actions={
        <Badge variant={status?.connected ? 'success' : 'danger'} dot>
          {status?.connected ? t('Connected') : t('Disconnected')}
        </Badge>
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Streaming Vehicles')} value={vehicles.length} />
        <StatCard label={t('Total Signals')} value={totalSignals.toLocaleString()} />
        <StatCard label={t('Total Batches')} value={totalBatches.toLocaleString()} />
        <StatCard label={t('Signals/sec')} value={totalRate.toFixed(1)} />
      </Grid>

      <Card>
        <CardHeader title={t('Connection Info')} />
        <KVList
          columns={2}
          items={[
            { label: t('Broker'), value: <span className="font-mono text-sm">{status?.broker ?? '--'}</span> },
            { label: t('Uptime'), value: status?.uptimeSeconds ? formatUptime(status.uptimeSeconds) : '--' },
            {
              label: t('Topics'),
              value: (
                <div className="flex gap-1 flex-wrap">
                  {status?.topics?.map((topic) => (
                    <Badge key={topic} variant="neutral" size="sm">{topic}</Badge>
                  )) ?? '--'}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {staleVehicles.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader title={t('Stale Vehicles')} subtitle={`${staleVehicles.length} vehicle(s) not reporting`} />
          <div className="px-4 pb-4 space-y-1">
            {staleVehicles.map((v) => (
              <p key={v.vin} className="text-sm font-mono text-amber-400">{v.vin}</p>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t('Vehicle Breakdown')} />
        <div className="divide-y divide-gray-800">
          {vehicles.map((v) => {
            const isStale = !v.lastReceived || Date.now() - new Date(v.lastReceived).getTime() > 120_000;
            return (
              <div key={v.vin} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-40 font-mono text-xs shrink-0">{v.vin}</span>
                <Badge variant={v.state === 'online' ? 'success' : 'neutral'} size="sm">
                  {v.state ?? 'unknown'}
                </Badge>
                <span className="w-20 text-right shrink-0">{(v.signalCount ?? 0).toLocaleString()}</span>
                <span className="w-16 text-right shrink-0">{(v.batchCount ?? 0).toLocaleString()}</span>
                <span className="w-16 text-right shrink-0">{v.signalsPerSec?.toFixed(1) ?? '--'}</span>
                <span className="w-20 text-right text-gray-400 shrink-0">
                  {v.lastReceived ? formatRelative(v.lastReceived) : '--'}
                </span>
                <Badge variant={isStale ? 'warning' : 'success'} size="sm" dot>
                  {isStale ? t('Stale') : t('Live')}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </PageContainer>
  );
}
