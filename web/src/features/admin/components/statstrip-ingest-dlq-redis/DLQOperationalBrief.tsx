import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { AlertBanner } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DLQListResponse } from '@/types/admin-diagnostics';
import { dlqMetrics } from './dlqMetrics';
import { briefSourceStatus } from './briefSourceStatus';

interface Props {
  data: DLQListResponse | undefined;
  loading: boolean;
  retained: boolean;
  error?: Error | null;
}

export function DLQOperationalBrief({ data, loading, retained, error }: Props) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const model = dlqMetrics(data, t);
  const metrics = model.metrics.map(metric => ({
    ...metric, display: { precision, units: { locale } },
  }));
  const briefMetrics = useOperationalMetrics(metrics);
  const status = briefSourceStatus(t, { hasData: data != null, loading, retained, failed: !!error });
  return <div className="space-y-4" data-testid="dlq-summary" data-retained={retained}>
    {retained && <Text as="p" variant="caption" role="status">
      {t('developerReference.stats.state.retained', 'Showing retained measurements')}
    </Text>}
    <OperationalBrief compact metrics={briefMetrics} {...status} testId="dlq-operational-brief"
      eyebrow={t('admin.dlq.pageTitle', 'DLQ inspector')}
      title={t('admin.dlq.stats.aria', 'Dead-letter queue summary')}
      description={t('admin.dlq.subtitle', 'Dead-letter queue — inspect failed ingests and replay them back to their source topic.')}
      scope={<Text as="span" variant="caption">{model.period.label}</Text>}
      provenance={t('admin.dlq.stats.totalSub', 'in dead-letter queue')}
      loading={loading && !retained}
    />
    {!loading && data?.replay_enabled === false && <AlertBanner variant="warning"
      title={t('admin.dlq.banners.disabledTitle', 'DLQ replay is disabled')}>
      {t('admin.dlq.banners.disabledMessage',
        'The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result="disabled".')}
    </AlertBanner>}
  </div>;
}
