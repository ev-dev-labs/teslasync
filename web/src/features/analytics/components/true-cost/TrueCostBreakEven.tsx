import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

export function TrueCostBreakEven({
  analysis,
  state,
  display,
  gasUnit,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const unitLabel = gasUnit === 'liter'
    ? t('tco.units.liter', 'L')
    : t('tco.units.gallon', 'gal');
  const supported = analysis.breakEven.gasPricePerConfiguredUnit != null
    || analysis.breakEven.comparisonMpg != null;

  return (
    <section
      data-testid="tco-break-even"
      aria-label={t('tco.breakEven.aria', 'Algebraic break-even analysis')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <Scale className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.breakEven.title', 'Break-even analysis')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.breakEven.subtitle', 'Each threshold holds recorded charging spend and all other baseline assumptions constant.')}
        </Text>
        <TrueCostSectionBody state={state}>
          {supported ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <Text as="p" variant="metricLabel">
                  {t('tco.breakEven.price', 'Break-even gasoline price')}
                </Text>
                <Text as="p" variant="metricValue" mono className="mt-2">
                  {analysis.breakEven.gasPricePerConfiguredUnit != null
                    ? t('tco.breakEven.priceValue', '{{value}}/{{unit}}', {
                      value: display.formatCurrency(
                        analysis.breakEven.gasPricePerConfiguredUnit,
                        3,
                      ),
                      unit: unitLabel,
                    })
                    : '—'}
                </Text>
                <Text as="p" variant="caption">
                  {t('tco.breakEven.priceHint', 'Price where modeled lifetime gas cost equals recorded charging spend.')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <Text as="p" variant="metricLabel">
                  {t('tco.breakEven.mpg', 'Break-even comparison MPG')}
                </Text>
                <Text as="p" variant="metricValue" mono className="mt-2">
                  {analysis.breakEven.comparisonMpg != null
                    ? t('tco.breakEven.mpgValue', '{{value}} MPG', {
                      value: display.formatNumber(analysis.breakEven.comparisonMpg, 2),
                    })
                    : '—'}
                </Text>
                <Text as="p" variant="caption">
                  {t('tco.breakEven.mpgHint', 'Efficiency where modeled lifetime gas cost equals recorded charging spend.')}
                </Text>
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('tco.breakEven.empty', 'Positive recorded spend, distance, gas baseline, price, and MPG are required.')} />
          )}
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
