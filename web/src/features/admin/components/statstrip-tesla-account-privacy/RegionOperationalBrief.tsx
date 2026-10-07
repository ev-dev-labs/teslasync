import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { DataStatus } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { RegionKpiBandProps } from '../tesla-region/RegionKpiBand';
import { useAccountSnapshotPeriod } from './useAccountSnapshotPeriod';
import { useAccountBriefStatus } from './useAccountBriefStatus';

interface RegionOperationalBriefProps extends RegionKpiBandProps {
  known: boolean;
  sourceStatus: DataStatus;
}

export function RegionOperationalBrief({ known, sourceStatus, regionKey, regionLabel, scheme,
  fetchedAt, configured, isLoading }: RegionOperationalBriefProps) {
  const { t } = useTranslation('settings');
  const { formatRelative } = useDateFormat();
  const period = useAccountSnapshotPeriod(fetchedAt);
  const metrics: readonly StatMetric[] = [
    { metricId: 'text', occurrenceId: 'region-zone', rawValue: known ? regionKey?.toUpperCase() : null,
      label: t('region.kpi.region', 'Region'),
      context: known ? regionLabel?.trim() || t('region.kpi.regionUnknown', 'Not detected') : undefined },
    { metricId: 'status', occurrenceId: 'region-endpoint',
      rawValue: !known ? null : configured
        ? t('region.status.configured', 'Configured') : t('region.status.pending', 'Not configured'),
      label: t('region.kpi.status', 'Endpoint'),
      context: t('region.kpi.source', 'Tesla Fleet API') },
    { metricId: 'text', occurrenceId: 'region-protocol', rawValue: known ? scheme?.toUpperCase() : null,
      label: t('region.kpi.protocol', 'Protocol'),
      context: t('region.kpi.protocolHint', 'Secure transport') },
    { metricId: 'text', occurrenceId: 'region-synced',
      rawValue: known && period.kind === 'snapshot' && period.observedAt
        ? formatRelative(new Date(period.observedAt)) : null,
      label: t('region.kpi.synced', 'Last synced'),
      context: t('region.kpi.syncedHint', 'From Tesla account') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const status = useAccountBriefStatus(sourceStatus);
  return <OperationalBrief compact testId="tesla-region-summary" metrics={briefMetrics}
    eyebrow={t('region.brief.eyebrow', 'Tesla account')}
    title={t('region.brief.title', 'Region and endpoint')}
    description={t('region.brief.description', 'Your account region, Fleet API endpoint and latest synchronization.')}
    {...status} loading={isLoading}
    scope={<Text as="span" variant="caption">{period.label}</Text>}
    provenance={period.kind === 'snapshot' ? period.provenance : undefined} />;
}
