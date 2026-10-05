import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { StatStrip } from '@/components/data-display/stat-reference';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { CostStatistics, ServiceRecord } from './maintenanceModel';
import { MaintenanceSource } from './MaintenanceSource';

/** Text metrics intentionally retain the authoritative currency formatter,
 * /yr suffix and all-record cost denominators. No generic currency recasing,
 * conversion or range completeness is imposed on service history. */
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
    <EmptyState message={t('maintenance.noCost', 'No cost data available yet. Log service records to see cost estimates.')} />
  );
  const metrics = [
    {
      key: 'total-spent',
      label: t('maintenance.totalSpent', 'Total spent'),
      value: costStats ? formatCurrency(costStats.totalCost) : null,
    },
    {
      key: 'annual-estimate',
      label: t('maintenance.annualEst', 'Annual est.'),
      value: costStats
        ? `${formatCurrency(costStats.annualCost)}${t('maintenance.perYear', '/yr')}` : null,
    },
    {
      key: 'average-service',
      label: t('maintenance.avgService', 'Avg / service'),
      value: costStats ? formatCurrency(costStats.avgPerService) : null,
    },
  ];
  return (
    <LayoutCard title={t('maintenance.costTitle', 'Estimated annual cost')}>
      <MaintenanceSource source={source} enabled={enabled} empty={empty} loading={<Skeleton height={120} />}>
        {costStats ? (
          <>
            <StatStrip
              id="maintenance-cost-summary"
              variant="embedded"
              period={{
                kind: 'unknown',
                label: t('dataSources.labels.serviceRecords', 'Service records'),
                reason: t('maintenance.cost.methodology', 'Annual estimate uses the span between valid service dates, with a minimum of 0.1 years; fewer than two valid dates use total cost. Average cost uses every returned record.'),
              }}
              metrics={metrics.map(metric => ({
                metricId: 'text',
                occurrenceId: metric.key,
                rawValue: metric.value,
                label: metric.label,
                description: metric.label,
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
