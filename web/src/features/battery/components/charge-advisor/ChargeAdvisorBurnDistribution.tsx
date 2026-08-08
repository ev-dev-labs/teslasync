import { BarChart3, Sigma } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import { fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorBurnDistribution({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const distribution = analysis.burnDistribution;
  const metrics = [
    [t('chargeAdvisor.distribution.mean', 'Mean'), distribution.meanPct],
    [t('chargeAdvisor.distribution.median', 'Median'), distribution.medianPct],
    [t('chargeAdvisor.distribution.p75', 'p75'), distribution.p75Pct],
    [t('chargeAdvisor.distribution.p90', 'p90'), distribution.p90Pct],
    [t('chargeAdvisor.distribution.minimum', 'Minimum'), distribution.minPct],
    [t('chargeAdvisor.distribution.maximum', 'Maximum'), distribution.maxPct],
  ] as const;

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.distribution.title', 'Burn distribution')}
      subtitle={t(
        'chargeAdvisor.distribution.subtitle',
        'Robust summaries of summed active local-day drive-associated SoC drops.',
      )}
      icon={<BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-distribution"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text variant="caption">{label}</Text>
            <Text className="mt-1 text-lg font-semibold text-cyan-300">
              {value == null ? '—' : fmtPercent(value, 1)}
            </Text>
          </div>
        ))}
      </div>
      <Text as="p" variant="caption" className="mt-4">
        <Sigma className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        {t(
          'chargeAdvisor.distribution.count',
          '{{count}} active local days in the distribution',
          { count: distribution.count },
        )}
      </Text>
    </ChargeAdvisorSection>
  );
}
