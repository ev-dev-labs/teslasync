import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, Card, CardHeader } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { Skeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';

import { getExtendedHealth } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';
import { statusToBadgeVariant, formatUptime } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function HealthProbesSection() {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });
  const { data, isLoading, refetch } = query;
  const state = useDataState(query);

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (isLoading && !state.hasData) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('systemStatus.probes.title', 'Health probes')}
        description={t('systemStatus.probes.desc', 'Liveness and readiness checks')}
        defaultOpen
      >
        <Grid cols={{ default: 1, md: 2 }} gap={4}>
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </Grid>
      </AccordionSection>
    );
  }

  // Only surface a full-panel error on the INITIAL load (no cached data). A
  // failed background refetch keeps the last good probe readings on screen
  // instead of blanking the whole section over a transient network blip.
  if (state.fatalError) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('systemStatus.probes.title', 'Health probes')}
        description={t('systemStatus.probes.desc', 'Liveness and readiness checks')}
        defaultOpen
      >
        <QueryError error={state.fatalError} onRetry={handleRetry} />
      </AccordionSection>
    );
  }

  const livenessStatus = data?.status ?? 'unknown';
  const database = data?.components?.database;
  const pool = data?.components?.database_pool;
  const system = data?.components?.system;
  const dbStatus = database?.status ?? 'unknown';
  const dbLatency = database?.latency_ms;

  return (
    <AccordionSection
      icon={<HeartPulse className="h-5 w-5" />}
      title={t('systemStatus.probes.title', 'Health probes')}
      description={t('systemStatus.probes.desc', 'Liveness and readiness checks')}
      badges={
        <>
          <Badge variant={statusToBadgeVariant(livenessStatus)} size="sm" dot>{t('systemStatus.probes.live', 'Live')}</Badge>
          <Badge variant={statusToBadgeVariant(dbStatus)} size="sm" dot>{t('systemStatus.probes.ready', 'Ready')}</Badge>
        </>
      }
      defaultOpen
    >
      <StaleRefreshWarning state={state} />
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader
            title={t('systemStatus.probes.liveTitle', 'Liveness — /healthz')}
            action={<Badge variant={statusToBadgeVariant(livenessStatus)} size="sm">{livenessStatus}</Badge>}
          />
          <KVList
            items={[
              { label: t('common.status', 'Status'), value: livenessStatus },
              { label: t('systemStatus.goroutines', 'Goroutines'), value: system?.goroutines != null ? fmtInt(system.goroutines) : '—' },
              { label: t('systemStatus.uptime', 'Uptime'), value: system?.uptime_seconds != null ? formatUptime(system.uptime_seconds) : '—' },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title={t('systemStatus.probes.readyTitle', 'Readiness — /readyz')}
            action={<Badge variant={statusToBadgeVariant(dbStatus)} size="sm">{dbStatus}</Badge>}
          />
          <KVList
            items={[
              { label: t('systemStatus.database', 'Database'), value: dbStatus },
              { label: t('systemStatus.latency', 'Latency'), value: dbLatency != null ? `${fmtNumber(dbLatency)} ms` : '—' },
              { label: t('systemStatus.probes.poolConns', 'Pool connections'), value: pool?.total_conns != null ? fmtInt(pool.total_conns) : '—' },
            ]}
          />
        </Card>
      </Grid>
    </AccordionSection>
  );
}
