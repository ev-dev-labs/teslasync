import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { LayoutCard } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { CostStatistics, ServiceRecord } from './maintenanceModel';
import { MaintenanceSource } from './MaintenanceSource';

/** Source denomination and annual estimate remain unchanged at the display boundary. */
export function MaintenanceCostPanel({
  source,
  enabled,
  costStats,
  formatCurrency,
}: {
  source: DataState<ServiceRecord[]>;
  enabled: boolean;
  costStats: CostStatistics | null;
  formatCurrency: (amount: number) => string;
}) {
  const { t } = useTranslation();
  const empty = (
    <EmptyState message={t('maintenance.noCost', 'No cost data available yet. Log service records to see cost estimates.')}
      action={enabled && source.retry ? { label: t('common.refresh', 'Refresh'), onClick: source.retry } : undefined}
      actionTo={!enabled ? { label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' } : undefined} />
  );
  const metrics = [
    {
      key: 'total-spent',
      label: t('maintenance.totalSpent', 'Total spent'),
      value: costStats?.totalCost ?? null,
    },
    {
      key: 'annual-estimate',
      label: t('maintenance.annualEst', 'Annual est.'),
      value: costStats?.annualCost ?? null,
    },
    {
      key: 'average-service',
      label: t('maintenance.avgService', 'Avg / service'),
      value: costStats?.avgPerService ?? null,
    },
  ];
  return (
    <LayoutCard title={t('maintenance.costTitle', 'Estimated annual cost')}>
      <MaintenanceSource source={source} enabled={enabled} empty={empty} loading={<Skeleton height={120} />}>
        {costStats ? (
          <>
            <VehicleOperationalBrief embedded
              id="maintenance-cost-summary"
              title={t('maintenance.costTitle', 'Estimated annual cost')}
              available={enabled && source.hasData}
              retained={source.hasData && (source.refreshError != null || source.isRefreshBlocked)}
              period={{
                kind: 'unknown',
                label: t('dataSources.labels.serviceRecords', 'Service records'),
                reason: t('maintenance.cost.methodology', 'Annual estimate uses the span between valid service dates, with a minimum of 0.1 years; fewer than two valid dates use total cost. Average cost uses every returned record.'),
              }}
              metrics={metrics.map((metric): StatMetric => ({
                metricId: 'currency',
                occurrenceId: metric.key,
                rawValue: metric.value,
                label: metric.label,
                description: metric.label,
                display: { formatter: raw => ({
                  value: `${formatCurrency(raw)}${metric.key === 'annual-estimate' ? t('maintenance.perYear', '/yr') : ''}`,
                  unit: '',
                }) },
              }))}
            />
            <Text as="p" variant="bodySm">
              {t('maintenance.evNote', 'EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.')}
            </Text>
          </>
        ) : empty}
      </MaintenanceSource>
    </LayoutCard>
  );
}
