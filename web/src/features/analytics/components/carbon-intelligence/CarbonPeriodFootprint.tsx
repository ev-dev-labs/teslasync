import { Factory, Fuel, Scale, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonPeriodFootprint({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const period = analysis.period;
  const comparison = period.netDisposition === 'excess'
    ? t(
        'carbon.footprint.excess',
        'Attributed charging emissions exceeded the fixed gas baseline by {{value}}.',
        { value: display.formatKg(Math.abs(period.netAvoidedCo2Kg ?? 0)) },
      )
    : period.netDisposition === 'avoided'
      ? t(
          'carbon.footprint.avoided',
          'Attributed charging emissions were below the fixed gas baseline by {{value}}.',
          { value: display.formatKg(period.netAvoidedCo2Kg) },
        )
      : period.netDisposition === 'balanced'
        ? t(
            'carbon.footprint.balanced',
            'The returned charging and gas-baseline values are equal within wire-rounding tolerance.',
          )
        : t(
            'carbon.footprint.unknown',
            'The gas-baseline comparison is unavailable because one or more required values failed validation.',
          );

  return (
    <section
      data-testid="carbon-period-footprint"
      aria-label={t(
        'carbon.footprint.aria',
        'Selected-period footprint versus gas baseline',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Scale
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t(
            'carbon.footprint.title',
            'Selected-period footprint vs gas baseline',
          )}
        </PanelTitle>
        <CarbonSectionBody state={states.period}>
          <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
            <MetricCard
              label={t('carbon.footprint.charging', 'Charging footprint')}
              value={display.formatKg(period.totalCo2Kg)}
              subtitle={t(
                'carbon.footprint.chargingHint',
                'Model-attributed charging emissions',
              )}
              icon={<Factory className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('carbon.footprint.gas', 'Gas baseline footprint')}
              value={display.formatKg(period.gasBaselineCo2Kg)}
              subtitle={t(
                'carbon.footprint.gasHint',
                'Distance × 0.192 kg CO₂/km',
              )}
              icon={<Fuel className="h-5 w-5" aria-hidden="true" />}
              color="red"
            />
            <MetricCard
              label={t('carbon.footprint.net', 'Baseline less charging')}
              value={display.formatSignedKg(period.netAvoidedCo2Kg)}
              subtitle={t(
                'carbon.footprint.netHint',
                'Negative values are retained as excess emissions',
              )}
              icon={<Scale className="h-5 w-5" aria-hidden="true" />}
              color={period.netDisposition === 'excess'
                ? 'red'
                : period.netDisposition === 'unknown'
                  ? 'blue'
                  : 'green'}
            />
            <MetricCard
              label={t('carbon.footprint.distance', 'Implied baseline distance')}
              value={display.formatDistance(
                period.inferredGasBaselineDistanceM,
                { precision: 1 },
              )}
              subtitle={t(
                'carbon.footprint.distanceHint',
                'Reverse-derived from the returned baseline',
              )}
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
          </Grid>
          <Text as="p" variant="bodySm" className="mt-4">
            {comparison}
          </Text>
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
