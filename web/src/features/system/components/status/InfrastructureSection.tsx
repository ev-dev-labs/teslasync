import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Globe, Wifi, WifiOff, Database, Activity, Clock } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, Card, CardHeader } from '@/components/ui';
import { InlineMetric, KVList } from '@/components/data-display';
import { fmtInt } from '@/lib/numberFormat';
import { getTelemetryStatus, getExtendedHealth } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';

export function InfrastructureSection() {
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
        <Badge variant={sseConnected ? 'success' : 'warning'} size="sm" dot>
          {sseConnected ? t('Connected') : t('Disconnected')}
        </Badge>
      }
    >
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader
            title={t('SSE Connection')}
            action={sseConnected ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-red-400" />}
          />
          <KVList
            items={[
              {
                label: t('Connection State'),
                value: <Badge variant={sseConnected ? 'success' : 'danger'} size="sm">{sseConnected ? t('Connected') : t('Disconnected')}</Badge>,
              },
              { label: t('Endpoint'), value: telemetry?.endpoint ?? '—' },
              { label: t('Protocol'), value: telemetry?.protocol ?? '—' },
              { label: t('Fallback Mode'), value: connectionMode === 'polling' ? t('Yes — Polling') : t('No') },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title={t('Polling Engine')}
            action={<Badge variant={connectionMode === 'polling' ? 'success' : 'neutral'} size="sm">{connectionMode === 'polling' ? t('Active') : t('Standby')}</Badge>}
          />
          <KVList
            items={[
              { label: t('Mode'), value: connectionMode },
              { label: t('Speed Comparison'), value: telemetry?.speed_comparison?.speedup ?? '—' },
              { label: t('Fleet Telemetry Latency'), value: telemetry?.speed_comparison?.fleet_telemetry_latency ?? '—' },
              { label: t('Fleet API Polling'), value: telemetry?.speed_comparison?.fleet_api_polling ?? '—' },
            ]}
          />
        </Card>
      </Grid>

      {extHealth?.database_pool && (
        <div className="mt-4">
          <Grid cols={{ default: 3 }} gap={3}>
            <InlineMetric icon={<Database className="h-4 w-4 text-cyan-400" />} value={fmtInt(extHealth.database_pool.total_conns)} label={t('Total Conns')} />
            <InlineMetric icon={<Activity className="h-4 w-4 text-green-400" />} value={fmtInt(extHealth.database_pool.acquired_conns)} label={t('Acquired')} />
            <InlineMetric icon={<Clock className="h-4 w-4 text-amber-400" />} value={fmtInt(extHealth.database_pool.idle_conns)} label={t('Idle')} />
          </Grid>
        </div>
      )}
    </AccordionSection>
  );
}
