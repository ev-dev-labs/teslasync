import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text, Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { safeNumber } from '@/lib/numberFormat';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';

export function YearEnvironmentBrief({ data, period, retained }: { data: YearReview; period: StatPeriod; retained?: boolean }) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const co2 = safeNumber(data.co2_offset_kg);
  const trees = Math.max(0, Math.round(co2 / 21));
  const treeIcons = Array.from({ length: Math.min(trees, 30) }, (_, i) => i);
  const metrics: StatMetric[] = [{
    metricId: 'mass', occurrenceId: 'year-environment-co2', rawValue: data.co2_offset_kg,
    label: t('yearReview.co2Offset', 'CO₂ offset'),
    description: t('yearReview.treesEquiv', { count: trees, defaultValue: 'Like planting {{count}} trees' }),
    display: { formatter: raw => ({ value: fmtInt(raw), unit: 'kg' }) },
  }];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div id="year-review-environment" className="space-y-3">
    <OperationalBrief compact testId="year-review-environment-brief"
      eyebrow={t('yearReview.title', 'Year in review')} title={t('yearReview.co2Offset', 'CO₂ offset')}
      description={t('yearReview.brief.environmentDescription', 'Reported calendar-year carbon offset with the existing tree-equivalent estimate.')}
      statusLabel={retained ? t('yearReview.brief.retained', 'Retained year evidence') : t('yearReview.brief.available', 'Recorded year evidence')}
      statusTone={retained ? 'warning' : 'neutral'}
      metrics={operationalMetrics} scope={period.label} provenance={t('yearReview.title', 'Year in review')} />
    <Caption>{t('yearReview.treesEquiv', { count: trees, defaultValue: 'Like planting {{count}} trees' })}</Caption>
    <div className="flex flex-wrap gap-1.5">
      {treeIcons.map(i => <Text as="span" key={i} size="xl" className="leading-none" aria-hidden="true">🌳</Text>)}
      {trees > 30 && <Text variant="bodySm" className="self-end">+{trees - 30} {t('yearReview.more', 'more')}</Text>}
      {trees === 0 && <Caption>{t('yearReview.noTrees', 'Every trip helps — keep driving electric!')}</Caption>}
    </div>
  </div>;
}
