import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { RedisSignalsResponse } from '@/api/hooks/useRedisSignals';
import { redisMetrics } from './redisMetrics';
import { briefSourceStatus } from './briefSourceStatus';

interface Props {
  data: RedisSignalsResponse | undefined;
  loading: boolean;
  retained: boolean;
  enabled: boolean;
  error?: Error | null;
}

export function RedisOperationalBrief({ data, loading, retained, enabled, error }: Props) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { locale } = useNumberFormatting();
  const model = redisMetrics(data, t, formatDateTime);
  const metrics = model.metrics.map(metric => ({
    ...metric, display: { units: { locale } },
  }));
  const briefMetrics = useOperationalMetrics(metrics);
  const status = briefSourceStatus(t, { enabled, hasData: data != null, loading, retained, failed: !!error });
  return <div data-testid="redis-signals-summary" data-retained={retained}>
    {retained && <Text as="p" variant="caption" role="status">
      {t('developerReference.stats.state.retained', 'Showing retained measurements')}
    </Text>}
    <OperationalBrief compact metrics={briefMetrics} {...status} testId="redis-signals-operational-brief"
      eyebrow={t('redis.title', 'Redis signal viewer')}
      title={t('redis.kpis', 'Cache metrics')}
      description={t('redis.subtitle', 'Inspect cached signal values in Redis (L2)')}
      scope={<Text as="span" variant="caption">{model.period.label}</Text>}
      provenance={t('redis.subtitle', 'Inspect cached signal values in Redis (L2)')}
      loading={loading && !retained}
    />
  </div>;
}
