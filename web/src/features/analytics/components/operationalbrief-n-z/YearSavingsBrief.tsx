import { useTranslation } from 'react-i18next';
import { OperationalBrief, MetricBar, type StatMetric } from '@/components/data-display';
import { Caption, Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useMetricPreferences } from '@/components/data-display/stat-reference';
import { formatMetric } from '@/lib/metric-reference';
import { safeNumber } from '@/lib/numberFormat';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';

export function YearSavingsBrief({ data, period, retained }: { data: YearReview; period: StatPeriod; retained?: boolean }) {
  const { t } = useTranslation();
  const preferences = useMetricPreferences();
  const savings = safeNumber(data.gas_savings);
  const electric = safeNumber(data.total_charging_cost);
  const gasEquiv = savings + electric;
  const barMax = gasEquiv > 0 ? gasEquiv : 1;
  const coffees = Math.max(0, Math.round(savings / 5));
  const metrics: StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'year-savings', rawValue: data.gas_savings,
      label: t('yearReview.youSaved', 'You saved'), context: t('yearReview.vsGas', 'vs. driving a gas car') },
    { metricId: 'currency', occurrenceId: 'year-electric-cost', rawValue: data.total_charging_cost,
      label: t('yearReview.electricCost', 'Electric cost') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div id="year-review-savings" className="space-y-3">
    <OperationalBrief compact testId="year-review-savings-brief"
      eyebrow={t('yearReview.title', 'Year in review')} title={t('yearReview.youSaved', 'You saved')}
      description={t('yearReview.brief.savingsDescription', 'Recorded electric cost and reported savings versus gasoline for the selected calendar year.')}
      statusLabel={retained ? t('yearReview.brief.retained', 'Retained year evidence') : t('yearReview.brief.available', 'Recorded year evidence')}
      statusTone={retained ? 'warning' : 'neutral'}
      metrics={operationalMetrics} scope={period.label} provenance={t('yearReview.title', 'Year in review')} />
    <Caption>{t('yearReview.vsGas', 'vs. driving a gas car')}</Caption>
    <div className="space-y-3">
      <MetricBar value={gasEquiv} max={barMax} color="#fb7185"
        label={t('yearReview.gasCost', 'Gas would cost')} sublabel={formatMetric('currency', gasEquiv, preferences).text} />
      <MetricBar value={electric} max={barMax} color="#34d399"
        label={t('yearReview.electricCost', 'Electric cost')} sublabel={formatMetric('currency', electric, preferences).text} />
    </div>
    <Text as="p" variant="bodySm">
      {t('yearReview.savingsNote', { cupsOfCoffee: coffees, defaultValue: "That's {{cupsOfCoffee}} cups of coffee!" })}
    </Text>
  </div>;
}
