import { useTranslation } from 'react-i18next';
import { DollarSign, Fuel, Zap } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { AnimatedNumber, MetricBar } from '@/components/data-display';
import { useFormatting } from '@/hooks/useFormatting';
import { safeNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

/** Rough price of one cup of coffee, in the user's currency, for the fun note. */
const COFFEE_PRICE = 5;

/** Money saved by driving electric, vs. the gas-car equivalent. */
export function YearSavingsPanel({ data }: Props) {
  const { t } = useTranslation();
  const { formatCurrency, currencySymbol } = useFormatting();

  // The API types these as non-null numbers, but a partial Year-in-Review
  // payload can surface null/NaN at runtime, so every read goes through
  // safeNumber (nullish/NaN/±Infinity → 0) before it reaches the display.
  const savings = safeNumber(data.gas_savings);
  const electric = safeNumber(data.total_charging_cost);
  const gasEquiv = savings + electric;
  // MetricBar divides value by max; keep it strictly positive so an all-zero
  // payload can't produce a NaN/Infinity bar width.
  const barMax = gasEquiv > 0 ? gasEquiv : 1;
  // Never a negative or NaN cup count — a non-positive saving reads "0 cups"
  // instead of the nonsensical "-12 cups of coffee!".
  const coffees = Math.max(0, Math.round(savings / COFFEE_PRICE));

  return (
    <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon-green/10 ring-1 ring-neon-green/20">
          <DollarSign className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        </span>
        <PanelTitle>{t('yearReview.youSaved', 'You saved')}</PanelTitle>
      </div>

      <div>
        <AnimatedNumber
          value={savings}
          duration={1.2}
          prefix={currencySymbol}
          className="text-4xl font-bold tracking-tight text-emerald-300 sm:text-5xl"
        />
        <Caption className="mt-1 block">{t('yearReview.vsGas', 'vs. driving a gas car')}</Caption>
      </div>

      <div className="mt-auto space-y-3">
        <MetricBar
          value={gasEquiv}
          max={barMax}
          color="#fb7185"
          label={t('yearReview.gasCost', 'Gas would cost')}
          sublabel={formatCurrency(gasEquiv, 0)}
        />
        <MetricBar
          value={electric}
          max={barMax}
          color="#34d399"
          label={t('yearReview.electricCost', 'Electric cost')}
          sublabel={formatCurrency(electric, 0)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
        <Text variant="bodySm" className="text-emerald-300">
          {t('yearReview.savingsNote', { cupsOfCoffee: coffees, defaultValue: "That's {{cupsOfCoffee}} cups of coffee!" })}
        </Text>
        <Fuel className="ms-auto h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      </div>
    </GlassPanel>
  );
}
