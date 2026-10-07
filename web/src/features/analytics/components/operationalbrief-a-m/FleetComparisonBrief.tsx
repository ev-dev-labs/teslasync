import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface FleetComparisonItem {
  id: string;
  label: string;
  value: string;
  loading: boolean;
  rawA: number | null | undefined;
  rawB: number | null | undefined;
  metricId: StatMetric['metricId'];
  format: (raw: number) => string;
  retained?: boolean;
}

export function FleetComparisonBrief({ items, nameA, nameB }: {
  items: readonly FleetComparisonItem[]; nameA: string; nameB: string;
}) {
  const { t } = useTranslation();
  const provenance = t('comparison.highlightContext.provenance', 'Battery readings are snapshots; efficiency, charging cost and CO₂ saved are lifetime statistics.');
  const metrics: StatMetric[] = items.flatMap(item => ([
    { metricId: item.metricId, occurrenceId: `${item.id}-a`, label: `${item.label} · ${nameA}`,
      rawValue: item.rawA, display: { formatter: (raw: number) => ({ value: item.format(raw), unit: '' }) },
      description: provenance, context: item.value },
    { metricId: item.metricId, occurrenceId: `${item.id}-b`, label: `${item.label} · ${nameB}`,
      rawValue: item.rawB, display: { formatter: (raw: number) => ({ value: item.format(raw), unit: '' }) },
      description: provenance, context: item.value },
  ]));
  const operationalMetrics = useOperationalMetrics(metrics);
  const loading = items.some(item => item.loading);
  const retained = items.some(item => item.retained);
  const partial = items.some(item => item.rawA == null || item.rawB == null);
  return <div id="fleet-compare-highlights">
    <OperationalBrief compact metrics={operationalMetrics} loading={items.length > 0 && items.every(item => item.loading)}
      eyebrow={t('comparison.title', 'Fleet comparison')}
      title={t('comparison.highlights', 'Key highlights')} description={provenance}
      statusLabel={loading ? t('analytics.brief.loading', 'Loading evidence')
        : retained ? t('analytics.brief.retained', 'Retained evidence')
          : partial ? t('comparison.brief.partial', 'Some comparison values unavailable') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={partial || retained ? 'warning' : 'neutral'}
      scope={<span>{t('comparison.highlightContext.period', 'Snapshot and lifetime comparison')}</span>}
      provenance={provenance}
    />
  </div>;
}
