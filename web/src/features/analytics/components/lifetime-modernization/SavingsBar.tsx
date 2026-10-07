import { useTranslation } from 'react-i18next';
import { Text, Caption } from '@/components/ui';
import { MetricBar, Currency } from '@/components/data-display';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';

/* Preserve the original semantic comparison palette and specialist currency. */
const EV_COLOR = '#10b981';
const GAS_COLOR = '#f43f5e';

export function SavingsBar({ evCost, gasCost, savings, co2Kg }: {
  evCost: number; gasCost: number; savings: number; co2Kg: number;
}) {
  const { fmtNumber, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const maxCost = Math.max(evCost, gasCost, 1);

  return (
    <div className="space-y-4">
      <MetricBar
        label={t('lifetime.electricCost', 'Electric cost')}
        value={evCost}
        max={maxCost}
        color={EV_COLOR}
        sublabel={formatCurrency(evCost)}
      />
      <MetricBar
        label={t('lifetime.gasCost', 'Gasoline equivalent')}
        value={gasCost}
        max={maxCost}
        color={GAS_COLOR}
        sublabel={formatCurrency(gasCost)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
        <Text as="span" size="lg" weight="semibold" className="text-emerald-300">
          {t('lifetime.youSaved', 'You saved')}{' '}
          <Currency value={savings} precision={displayPrecision} className="text-emerald-300" />
        </Text>
        <Caption>
          {fmtNumber(co2Kg)} kg CO₂ {t('lifetime.avoided', 'avoided')}
        </Caption>
      </div>
    </div>
  );
}
