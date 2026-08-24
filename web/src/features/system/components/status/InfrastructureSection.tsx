import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Globe, Wifi, WifiOff, Database, Activity, Clock } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, Card, CardHeader } from '@/components/ui';
import { InlineMetric, KVList } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { fmtInt } from '@/lib/numberFormat';
import { getTelemetryStatus, getExtendedHealth } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';

const DASH = '—';

export function InfrastructureSection() {
  const { t } = useTranslation();

  const {
    data: telemetry,
    isPending: telemetryLoading,
    isError: telemetryError,
  } = useQuery({
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
  const isPolling = connectionMode === 'polling';
  // `mode` is a required string on the wire but can arrive empty on a partial
  // response — collapse empty/whitespace to an em-dash so the row never renders
  // blank.
  const displayMode = connectionMode.trim() ? connectionMode : DASH;
  const speed = telemetry?.speed_comparison;
  const pool = extHealth?.components?.database_pool;

  // Honest header status: don't claim "Disconnected" before the first fetch
  // resolves (that misleads operators into thinking streaming is down), and
  // surface fetch failures instead of silently degrading to a
  // disconnected-looking state.
  const headerBadge = telemetryLoading ? (
    <Badge variant="neutral" size="sm" dot>
      {t('Checking…')}
    </Badge>
  ) : telemetryError ? (
    <Badge variant="danger" size="sm" dot>
      {t('Error')}
    </Badge>
  ) : (
    <Badge variant={sseConnected ? 'success' : 'warning'} size="sm" dot>
      {sseConnected ? t('Connected') : t('Disconnected')}
    </Badge>
  );

  return (
    <AccordionSection
      icon={<Globe aria-hidden="true" className="h-5 w-5" />}
      title={t('Infrastructure')}
      description={t('SSE connections and polling engine diagnostics')}
      badges={headerBadge}
    >
      {telemetryLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('Loading infrastructure diagnostics')}
          className="space-y-3"
        >
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : telemetryError ? (
        <div role="alert" className="text-sm text-[var(--text-muted)]">
          {t('Unable to load infrastructure diagnostics.')}
        </div>
      ) : (
        <Grid cols={{ default: 1, md: 2 }} gap={4}>
          <Card>
            <CardHeader
              title={t('SSE Connection')}
              action={
                sseConnected ? (
                  <Wifi aria-hidden="true" className="h-4 w-4 text-green-400" />
                ) : (
                  <WifiOff aria-hidden="true" className="h-4 w-4 text-red-400" />
                )
              }
            />
            <KVList
              items={[
                {
                  label: t('Connection State'),
                  value: (
                    <Badge variant={sseConnected ? 'success' : 'danger'} size="sm">
                      {sseConnected ? t('Connected') : t('Disconnected')}
                    </Badge>
                  ),
                },
                { label: t('Endpoint'), value: telemetry?.endpoint || DASH },
                { label: t('Protocol'), value: telemetry?.protocol || DASH },
                { label: t('Fallback Mode'), value: isPolling ? t('Yes — Polling') : t('No') },
              ]}
            />
          </Card>

          <Card>
            <CardHeader
              title={t('Polling Engine')}
              action={
                <Badge variant={isPolling ? 'success' : 'neutral'} size="sm">
                  {isPolling ? t('Active') : t('Standby')}
                </Badge>
              }
            />
            <KVList
              items={[
                { label: t('Mode'), value: displayMode },
                { label: t('Speed Comparison'), value: speed?.speedup || DASH },
                { label: t('Fleet Telemetry Latency'), value: speed?.fleet_telemetry_latency || DASH },
                { label: t('Fleet API Polling'), value: speed?.fleet_api_polling || DASH },
              ]}
            />
          </Card>
        </Grid>
      )}

      {pool && (
        <div className="mt-4">
          <Grid cols={{ default: 3 }} gap={3}>
            <InlineMetric
              icon={<Database aria-hidden="true" className="h-4 w-4 text-cyan-400" />}
              value={fmtInt(pool.total_conns)}
              label={t('Total Conns')}
            />
            <InlineMetric
              icon={<Activity aria-hidden="true" className="h-4 w-4 text-green-400" />}
              value={fmtInt(pool.acquired_conns)}
              label={t('Acquired')}
            />
            <InlineMetric
              icon={<Clock aria-hidden="true" className="h-4 w-4 text-amber-400" />}
              value={fmtInt(pool.idle_conns)}
              label={t('Idle')}
            />
          </Grid>
        </div>
      )}
    </AccordionSection>
  );
}
