import { Calculator } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TcoDisposition } from '../../lib/trueCost';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

function presentation(
  value: TcoDisposition,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (value === 'savings') {
    return { label: t('tco.savings.savings', 'Savings'), variant: 'success' as const };
  }
  if (value === 'loss') {
    return { label: t('tco.savings.loss', 'Loss'), variant: 'danger' as const };
  }
  if (value === 'balanced') {
    return { label: t('tco.savings.balanced', 'Near balance'), variant: 'warning' as const };
  }
  return { label: t('tco.savings.unavailable', 'Unavailable'), variant: 'neutral' as const };
}

export function TrueCostSavingsEnvelope({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const fuel = presentation(analysis.fuelDisposition, t);
  const combined = presentation(analysis.combinedDisposition, t);
  const cards = [
    {
      label: t('tco.savings.fuel', 'Fuel-only savings / loss'),
      value: analysis.gates.fuelComparison
        ? display.formatSignedCurrency(analysis.metrics.totalFuelDelta.value)
        : '—',
      detail: t('tco.savings.fuelHint', 'Lifetime distance-derived gas equivalent less recorded charging spend'),
      status: fuel,
      emphasis: analysis.fuelDisposition,
    },
    {
      label: t('tco.savings.maintenance', 'Maintenance heuristic'),
      value: analysis.gates.maintenanceHeuristic
        ? display.formatCurrency(analysis.metrics.maintenanceHeuristic.value)
        : '—',
      detail: t('tco.savings.maintenanceHint', '$50 × modeled drive-span months; not observed service spend'),
      status: {
        label: analysis.gates.maintenanceHeuristic
          ? t('tco.savings.heuristic', 'Heuristic')
          : t('tco.savings.withheld', 'Withheld'),
        variant: 'warning' as const,
      },
      emphasis: 'balanced' as const,
    },
    {
      label: t('tco.savings.combined', 'Fuel delta + heuristic'),
      value: display.formatSignedCurrency(analysis.combinedFuelAndMaintenance),
      detail: t('tco.savings.combinedHint', 'Algebraic combination only; not verified net ownership savings'),
      status: combined,
      emphasis: analysis.combinedDisposition,
    },
  ];

  return (
    <section
      data-testid="tco-savings-envelope"
      aria-label={t('tco.savings.aria', 'Savings and loss operating-cost envelope')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.savings.title', 'Savings / loss envelope')}
        </PanelTitle>
        <TrueCostSectionBody state={state}>
          <div className="grid gap-3 lg:grid-cols-3">
            {cards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <Text as="p" variant="metricLabel">{card.label}</Text>
                  <Badge variant={card.status.variant}>{card.status.label}</Badge>
                </div>
                <Text
                  as="p"
                  variant="metricValue"
                  mono
                  className={cn(
                    'mt-2',
                    card.emphasis === 'savings' && 'text-emerald-300',
                    card.emphasis === 'loss' && 'text-rose-300',
                    card.emphasis === 'balanced' && 'text-amber-300',
                  )}
                >
                  {card.value}
                </Text>
                <Text as="p" variant="caption" className="mt-1">{card.detail}</Text>
              </div>
            ))}
          </div>
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
