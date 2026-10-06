import { useTranslation } from 'react-i18next';
import { knownNumber } from '@/api/dataState';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { LayoutCard } from '@/components/layout/layout-reference';
import { QueryError } from '@/components/feedback';
import type { RangeSectionProps } from './RangeSourceSlot';

export function RangeSummary({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const data = source.data;
  const distance = (value: number | undefined) => {
    const known = knownNumber(value);
    return known == null ? null : known * 1000;
  };
  const capacity = knownNumber(data?.usable_capacity_wh);
  const health = knownNumber(data?.health_factor);
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'your-estimate', label: t('range.yourEstimate', 'Your Estimate'), rawValue: distance(data?.your_estimate_km) },
    { metricId: 'distance', occurrenceId: 'tesla-estimate', label: t('range.teslaEstimate', 'Tesla Estimate'), rawValue: distance(data?.tesla_estimate_km) },
    { metricId: 'percent', occurrenceId: 'battery', label: t('range.battery', 'Battery'), rawValue: knownNumber(data?.current_battery_pct ?? data?.battery_level) },
    { metricId: 'energy', occurrenceId: 'usable-capacity', label: t('range.usableCapacity', 'Usable Capacity'), rawValue: capacity },
    { metricId: 'percent', occurrenceId: 'health', label: t('range.healthFactor', 'Health Factor'), rawValue: health == null ? null : health * 100 },
  ];
  return (
    <section>
      {source.fatalError ? (
        <LayoutCard title={t('range.kpis', 'Range summary metrics')}>
          <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} />
        </LayoutCard>
      ) : (
        <BatteryEvidenceBrief id="projected-range-summary" title={t('range.kpis', 'Range summary metrics')} metrics={metrics}
          loading={loading && !source.hasData} retained={source.status === 'stale'}
          period={{ kind: 'snapshot',
            label: t('range.modernization.snapshot', 'Range projection snapshot'),
            observedAt: source.updatedAt == null ? null : new Date(source.updatedAt).toISOString(),
            provenance: t('range.modernization.snapshotSource', 'Current battery state and the existing driving-history model; not scoped to a selected date window.') }} />
      )}
    </section>
  );
}
