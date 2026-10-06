import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { TripCostComparison } from '@/types/driving';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface TripCostBriefProps {
  comparison?: TripCostComparison | null;
  scope: string;
  loading: boolean;
  retained: boolean;
}

export function TripCostBrief({ comparison, scope, loading, retained }: TripCostBriefProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const detail = comparison ? t('tripPlanner.cost.detail',
    '{{gallons}} gal avoided · {{pct}} cheaper · @ ${{price}}/gal, {{mpg}} mpg', {
      gallons: fmtNumber(comparison.gas_gallons), pct: fmtPercent(comparison.savings_pct),
      price: fmtNumber(comparison.gas_price_per_gallon), mpg: fmtNumber(comparison.gas_mpg),
    }) : undefined;
  const metrics: readonly StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'ev', rawValue: comparison?.ev_cost,
      label: t('tripPlanner.cost.ev', 'EV'), context: detail,
      display: { formatter: (raw) => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'gas', rawValue: comparison?.gas_cost,
      label: t('tripPlanner.cost.gas', 'Gas'),
      display: { formatter: (raw) => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'saved', rawValue: comparison?.savings,
      label: t('tripPlanner.cost.saved', 'Saved'),
      display: { formatter: (raw) => ({ value: formatCurrency(raw), unit: '' }) } },
  ];
  return (
    <section data-testid="trip-cost-summary">
      <DrivingSummaryBrief
        id="trip-cost-brief"
        title={t('tripPlanner.cost.title', 'Trip Cost vs Gas')}
        description={t('tripPlanner.brief.costDescription', 'Estimated EV cost and gasoline equivalent from the current trip-plan comparison; original price and vehicle-economy assumptions are retained.')}
        metrics={metrics} scope={scope} loading={loading} unavailable={!comparison} retained={retained}
        provenance={t('tripPlanner.brief.provenance', 'Deterministic trip-plan response using the submitted route, battery level, and preferences.')}
      />
      {!comparison && !loading && <EmptyState message={t('tripPlanner.cost.empty', 'Plan a trip to compare EV charging cost against gasoline.')} />}
    </section>
  );
}
