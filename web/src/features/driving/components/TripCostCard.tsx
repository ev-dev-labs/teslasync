import { useTranslation } from 'react-i18next';
import { PiggyBank } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { TripCostComparison } from '@/types/driving';

interface TripCostCardProps {
  comparison?: TripCostComparison | null;
}

/** Door-to-door $ readout: EV charging cost vs the gasoline equivalent. */
export function TripCostCard({ comparison }: TripCostCardProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PiggyBank className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('tripPlanner.cost.title', 'Trip Cost vs Gas')}
      </PanelTitle>

      {!comparison ? (
        <EmptyState
          icon={<PiggyBank className="h-8 w-8" />}
          message={t('tripPlanner.cost.empty', 'Plan a trip to compare EV charging cost against gasoline.')}
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Caption className="block">{t('tripPlanner.cost.ev', 'EV')}</Caption>
              <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5 tabular-nums">
                {formatCurrency(comparison.ev_cost)}
              </Text>
            </div>
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Caption className="block">{t('tripPlanner.cost.gas', 'Gas')}</Caption>
              <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5 tabular-nums">
                {formatCurrency(comparison.gas_cost)}
              </Text>
            </div>
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <Caption className="block">{t('tripPlanner.cost.saved', 'Saved')}</Caption>
              <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5 tabular-nums">
                {formatCurrency(comparison.savings)}
              </Text>
            </div>
          </div>
          <Caption className="block tabular-nums">
            {t('tripPlanner.cost.detail', '{{gallons}} gal avoided · {{pct}} cheaper · @ ${{price}}/gal, {{mpg}} mpg', {
              gallons: fmtNumber(comparison.gas_gallons, 1),
              pct: fmtPercent(comparison.savings_pct, 0),
              price: fmtNumber(comparison.gas_price_per_gallon, 2),
              mpg: fmtNumber(comparison.gas_mpg, 0),
            })}
          </Caption>
        </div>
      )}
    </GlassPanel>
  );
}
