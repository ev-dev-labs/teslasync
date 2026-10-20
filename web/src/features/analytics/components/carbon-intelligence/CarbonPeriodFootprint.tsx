import { Factory, Fuel, Scale, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
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
      <LayoutCard
        title={t('carbon.footprint.title', 'Selected-period footprint vs gas baseline')}
        actions={<Scale className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.period}>
          <StatStrip
            id="carbon-period-footprint-metrics"
            variant="embedded"
            period={{ kind: 'unknown', label: t('carbon.source.period', 'Selected-period summary') }}
            metrics={[
              {
                metricId: 'text', occurrenceId: 'carbon-footprint-charging',
                label: t('carbon.footprint.charging', 'Charging footprint'),
                rawValue: display.formatKg(period.totalCo2Kg),
                context: <><Factory className="h-5 w-5" aria-hidden="true" />{t('carbon.footprint.chargingHint', 'Model-attributed charging emissions')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-footprint-gas',
                label: t('carbon.footprint.gas', 'Gas baseline footprint'),
                rawValue: display.formatKg(period.gasBaselineCo2Kg),
                context: <><Fuel className="h-5 w-5" aria-hidden="true" />{t('carbon.footprint.gasHint', 'Distance × 0.192 kg CO₂/km')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-footprint-net',
                label: t('carbon.footprint.net', 'Baseline less charging'),
                rawValue: display.formatSignedKg(period.netAvoidedCo2Kg),
                context: <><Scale className="h-5 w-5" aria-hidden="true" />{t('carbon.footprint.netHint', 'Negative values are retained as excess emissions')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-footprint-distance',
                label: t('carbon.footprint.distance', 'Implied baseline distance'),
                rawValue: display.formatDistance(period.inferredGasBaselineDistanceM),
                context: <><Route className="h-5 w-5" aria-hidden="true" />{t('carbon.footprint.distanceHint', 'Reverse-derived from the returned baseline')}</>,
              },
            ]}
          />
          <Text as="p" variant="bodySm" className="mt-4">
            {comparison}
          </Text>
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
