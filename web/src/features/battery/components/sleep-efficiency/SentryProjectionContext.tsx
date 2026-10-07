import { BatteryCharging, Calculator, DollarSign, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type {
  SleepEfficiencyFormatters,
  SleepEfficiencySectionProps,
} from './types';

type SentryProjectionContextProps =
  SleepEfficiencySectionProps
  & Pick<SleepEfficiencyFormatters, 'formatCurrency' | 'formatEnergy'>;

export function SentryProjectionContext({
  analysis,
  state,
  formatCurrency,
  formatEnergy,
}: SentryProjectionContextProps) {
  const { t } = useTranslation();
  const { context, projection, on, off } = analysis.sentry;
  const sourceLabel = (() => {
    if (context.capacitySourceCategory === 'vin_estimate') {
      return t('sleep.sentryContext.sourceVin', 'VIN-based estimate');
    }
    if (context.capacitySourceCategory === 'model_estimate') {
      return t('sleep.sentryContext.sourceModel', 'Model-based estimate');
    }
    if (context.capacitySourceCategory === 'default') {
      return t('sleep.sentryContext.sourceDefault', 'Default estimate');
    }
    if (context.capacitySourceCategory === 'other') {
      return t('sleep.sentryContext.sourceOther', 'Other source');
    }
    return t('sleep.common.unavailable', 'Unavailable');
  })();

  return (
    <section data-testid="sleep-efficiency-sentry-projection">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t(
            'sleep.sentryContext.title',
            'Sentry projection and context',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.sentryContext.subtitle',
            'Capacity and electricity price are context inputs, not observed Sentry drain.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              icon={
                <BatteryCharging className="h-4 w-4" aria-hidden="true" />
              }
              label={t(
                'sleep.sentryContext.capacity',
                'Battery capacity context',
              )}
              value={
                context.batteryCapacityWh != null
                  ? formatEnergy(context.batteryCapacityWh)
                  : '—'
              }
              color="blue"
              subtitle={sourceLabel}
            />
            <MetricCard
              icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.sentryContext.price',
                'Base electricity price',
              )}
              value={
                context.baseCostPerKwh != null
                  ? t(
                      'sleep.sentryContext.priceValue',
                      '{{value}}/kWh',
                      { value: formatCurrency(context.baseCostPerKwh) },
                    )
                  : '—'
              }
              color="green"
              subtitle={t(
                'sleep.sentryContext.priceContext',
                'Configured cost input',
              )}
            />
            <MetricCard
              icon={<Eye className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.sentryContext.sampleCounts',
                'Comparison sample counts',
              )}
              value={
                analysis.sentry.comparisonAvailable
                  ? t(
                      'sleep.sentryContext.sampleValue',
                      '{{on}} on · {{off}} off',
                      {
                        on: fmtInt(on.count),
                        off: fmtInt(off.count),
                      },
                    )
                  : '—'
              }
              color="amber"
              subtitle={t(
                'sleep.sentryContext.positiveCounts',
                'Both counts must be positive',
              )}
            />
            <MetricCard
              icon={<Calculator className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.sentryContext.monthlyEnergy',
                'Projected Sentry-on monthly energy',
              )}
              value={
                projection.onMonthlyKwh != null
                  ? t(
                      'sleep.sentryContext.energyValue',
                      '{{value}} kWh',
                      { value: fmtNumber(projection.onMonthlyKwh) },
                    )
                  : '—'
              }
              color="purple"
              subtitle={t(
                'sleep.sentryContext.monthlyBasis',
                '730-hour context projection',
              )}
            />
            <MetricCard
              icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.sentryContext.monthlyCost',
                'Projected Sentry-on monthly cost',
              )}
              value={
                projection.onMonthlyCost != null
                  ? formatCurrency(projection.onMonthlyCost)
                  : '—'
              }
              color="red"
              subtitle={t(
                'sleep.sentryContext.contextOnly',
                'Context projection; not a bill',
              )}
            />
            <MetricCard
              icon={<Calculator className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.sentryContext.extraRate',
                'On-minus-off drain rate',
              )}
              value={
                projection.extraDrainRate != null
                  ? t(
                      'sleep.sentryContext.rateValue',
                      '{{value}}%/hr',
                      { value: fmtNumber(projection.extraDrainRate) },
                    )
                  : '—'
              }
              color="cyan"
              subtitle={t(
                'sleep.sentryContext.descriptiveDifference',
                'Descriptive group difference',
              )}
            />
          </div>

          {!analysis.sentry.comparisonAvailable && (
            <AlertBanner className="mt-4" variant="warning">
              {t(
                'sleep.sentryContext.unavailable',
                'Monthly drain and cost remain unavailable because no count-bearing Sentry on/off comparison exists.',
              )}
            </AlertBanner>
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
