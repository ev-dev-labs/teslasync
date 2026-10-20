import { useTranslation } from 'react-i18next';
import type { RepairCaseStats as RepairCaseStatsData } from '@/api/hooks/useRepairCaseStats';
import { SystemSummaryBrief } from './operationalbrief-all/SystemSummaryBrief';

interface RepairCaseStatsProps {
  statistics?: RepairCaseStatsData;
  loading?: boolean;
  retained?: boolean;
}

export function RepairCaseStats({ statistics, loading = false, retained = false }: RepairCaseStatsProps) {
  const { t } = useTranslation();
  const metrics = [
    {
      label: t('dataRepair.cases.open', 'Open cases'),
      value: statistics?.open,
      hint: t('dataRepair.cases.openHint', 'Awaiting operator review'),
    },
    {
      label: t('dataRepair.cases.inReview', 'In review'),
      value: statistics?.in_review,
      hint: t('dataRepair.cases.inReviewHint', 'Actively triaged'),
    },
    {
      label: t('dataRepair.cases.quarantined', 'Quarantined'),
      value: statistics?.quarantined,
      hint: t('dataRepair.cases.quarantinedHint', 'Reversible removals'),
    },
    {
      label: t('dataRepair.cases.active', 'Active cases'),
      value: statistics?.open != null && statistics?.in_review != null
        ? statistics.open + statistics.in_review
        : null,
      hint: t('dataRepair.cases.activeHint', 'Active review workload'),
    },
  ];

  return (
    <SystemSummaryBrief
      title={t('dataRepair.cases.metricsLabel', 'Repair case metrics')}
      description={t('dataRepair.cases.briefDescription', 'Server-reported repair case workload; active cases are open plus in-review cases.')}
      scope={t('dataRepair.cases.briefScope', 'Repair case statistics response; separate from the filtered queue and diagnosis scan.')}
      available={statistics != null} loading={loading} retained={retained}
      metrics={metrics.map((metric, index) => ({
        metricId: 'count', occurrenceId: `case-${index}`, rawValue: metric.value,
        label: metric.label, context: metric.hint,
      }))}
    />
  );
}
