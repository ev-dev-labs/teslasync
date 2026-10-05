import { useTranslation } from 'react-i18next';
import { StatGroup, useMetricPreferences } from '@/components/data-display/stat-reference';
import { MetricBar } from '@/components/data-display';
import { Text, Caption } from '@/components/ui';
import { formatMetric, type StatPeriod } from '@/lib/metric-reference';
import { safeNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

export function YearSavings({ data, period }: { data: YearReview; period: StatPeriod }) {
  const { t } = useTranslation();
  const prefs = useMetricPreferences();
  const savings = safeNumber(data.gas_savings);
  const electric = safeNumber(data.total_charging_cost);
  const gasEquiv = savings + electric;
  const barMax = gasEquiv > 0 ? gasEquiv : 1;
  const coffees = Math.max(0, Math.round(savings / 5));

  return (
    <>
      <StatGroup id="year-review-savings" period={period} metrics={[
        { metricId: 'currency', rawValue: savings, label: t('yearReview.youSaved', 'You saved') },
        { metricId: 'currency', rawValue: electric, label: t('yearReview.electricCost', 'Electric cost') },
      ]} />
      <Caption>{t('yearReview.vsGas', 'vs. driving a gas car')}</Caption>
      <div className="space-y-3">
        <MetricBar value={gasEquiv} max={barMax} color="#fb7185"
          label={t('yearReview.gasCost', 'Gas would cost')} sublabel={formatMetric('currency', gasEquiv, prefs).text} />
        <MetricBar value={electric} max={barMax} color="#34d399"
          label={t('yearReview.electricCost', 'Electric cost')} sublabel={formatMetric('currency', electric, prefs).text} />
      </div>
      <Text as="p" variant="bodySm">
        {t('yearReview.savingsNote', { cupsOfCoffee: coffees, defaultValue: "That's {{cupsOfCoffee}} cups of coffee!" })}
      </Text>
    </>
  );
}
