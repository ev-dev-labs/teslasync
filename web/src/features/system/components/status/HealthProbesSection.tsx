import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, Card, CardHeader } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { getExtendedHealth } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';
import { statusToBadgeVariant, formatUptime } from './helpers';

export function HealthProbesSection() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('Health Probes')}
        description={t('Liveness and readiness checks')}
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
  if (error && !data) {
    return (
      <AccordionSection
        icon={<HeartPulse className="h-5 w-5" />}
        title={t('Health Probes')}
        description={t('Liveness and readiness checks')}
        defaultOpen
      >
        <QueryError error={error} onRetry={handleRetry} />
      </AccordionSection>
    );
  }

  const livenessStatus = data?.status ?? 'unknown';
  const dbStatus = data?.database?.status ?? 'unknown';
  const dbLatency = data?.database?.latency_ms;

  return (
    <AccordionSection
      icon={<HeartPulse className="h-5 w-5" />}
      title={t('Health Probes')}
      description={t('Liveness and readiness checks')}
      badges={
        <>
          <Badge variant={statusToBadgeVariant(livenessStatus)} size="sm" dot>{t('Live')}</Badge>
          <Badge variant={statusToBadgeVariant(dbStatus)} size="sm" dot>{t('Ready')}</Badge>
        </>
      }
      defaultOpen
    >
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader
            title={t('Liveness — /healthz')}
            action={<Badge variant={statusToBadgeVariant(livenessStatus)} size="sm">{livenessStatus}</Badge>}
          />
          <KVList
            items={[
              { label: t('Status'), value: livenessStatus },
              { label: t('Goroutines'), value: fmtInt(data?.system?.goroutines ?? 0) },
              { label: t('Uptime'), value: formatUptime(data?.system?.uptime_seconds ?? 0) },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title={t('Readiness — /readyz')}
            action={<Badge variant={statusToBadgeVariant(dbStatus)} size="sm">{dbStatus}</Badge>}
          />
          <KVList
            items={[
              { label: t('Database'), value: dbStatus },
              { label: t('Latency'), value: dbLatency != null ? `${fmtNumber(dbLatency, 1)} ms` : '—' },
              { label: t('Pool Connections'), value: fmtInt(data?.database_pool?.total_conns ?? 0) },
            ]}
          />
        </Card>
      </Grid>
    </AccordionSection>
  );
}
