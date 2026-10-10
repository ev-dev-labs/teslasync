import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { GlassPanel, Text, MetricLabel, HelperText } from '@/components/ui';
import { Currency } from '@/components/data-display';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { neonColorMap } from '@/lib/tokens';
import { cn } from '@/lib/cn';

/** Source cost model: unavailable coverage never becomes a zero-cost saving. */
export function CostComparisonCard({
  label, evCost, gasCost, icon,
}: {
  label: string; evCost: number | null; gasCost: number | null; icon: ReactNode;
}) {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const savings = evCost != null && gasCost != null ? gasCost - evCost : null;
  const savingsPct =
    savings != null && gasCost != null && gasCost > 0
      ? (Math.abs(savings) / gasCost) * 100
      : null;
  const isSaving = savings != null && savings >= 0;
  const green = neonColorMap.green;
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', green.bg, green.ring)}>
          <span className={green.text} aria-hidden="true">{icon}</span>
        </div>
        <Text variant="subhead">{label}</Text>
      </div>
      <div className="mb-3 flex items-center gap-4">
        <div className="min-w-0">
          <MetricLabel>{t('energy.cost.evCost', 'EV cost')}</MetricLabel>
          <Text as="p" size="lg" weight="bold" className="mt-0.5 text-[var(--text-primary)]">
            {evCost != null ? <Currency value={evCost} /> : '—'}
          </Text>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <div className="min-w-0">
          <MetricLabel>{t('energy.cost.gasEquivalent', 'Gas equivalent')}</MetricLabel>
          <Text as="p" size="lg" weight="bold" color="secondary" className="mt-0.5">
            {gasCost != null ? <Currency value={gasCost} /> : '—'}
          </Text>
        </div>
      </div>
      {savings != null && savingsPct != null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Text size="sm" weight="bold" className={isSaving ? 'text-emerald-300' : 'text-amber-300'}>
            {isSaving
              ? t('energy.cost.saving', 'Saving')
              : t('energy.cost.higherBy', 'Higher by')}{' '}
            <Currency value={Math.abs(savings)} />
          </Text>
          <Text
            as="span"
            size="2xs"
            weight="semibold"
            className={cn(
              'rounded-full px-2 py-0.5 ring-1',
              isSaving ? [green.bg, green.text, green.ring] : 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
            )}
          >
            {fmtPercent(savingsPct)}{' '}
            {isSaving ? t('energy.cost.less', 'less') : t('energy.cost.more', 'more')}
          </Text>
        </div>
      ) : (
        <HelperText>
          {t('energy.cost.incomplete', 'Complete charging-cost coverage is required before savings are modeled.')}
        </HelperText>
      )}
    </GlassPanel>
  );
}
