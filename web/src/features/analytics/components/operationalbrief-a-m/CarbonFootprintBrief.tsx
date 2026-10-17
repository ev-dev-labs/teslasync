import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonFootprintBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const period = analysis.period;
  const resolved = states.period.hasData;
  const comparison = period.netDisposition === 'excess'
    ? t('carbon.footprint.excess', 'Attributed charging emissions exceeded the fixed gas baseline by {{value}}.', { value: display.formatKg(Math.abs(period.netAvoidedCo2Kg ?? 0)) })
    : period.netDisposition === 'avoided'
      ? t('carbon.footprint.avoided', 'Attributed charging emissions were below the fixed gas baseline by {{value}}.', { value: display.formatKg(period.netAvoidedCo2Kg) })
      : period.netDisposition === 'balanced'
        ? t('carbon.footprint.balanced', 'The returned charging and gas-baseline values are equal within wire-rounding tolerance.')
        : t('carbon.footprint.unknown', 'The gas-baseline comparison is unavailable because one or more required values failed validation.');
  const metrics: StatMetric[] = [
    { metricId: 'mass', occurrenceId: 'carbon-footprint-charging', rawValue: resolved ? period.totalCo2Kg : null,
      label: t('carbon.footprint.charging', 'Charging footprint'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.footprint.chargingHint', 'Model-attributed charging emissions') },
    { metricId: 'mass', occurrenceId: 'carbon-footprint-gas', rawValue: resolved ? period.gasBaselineCo2Kg : null,
      label: t('carbon.footprint.gas', 'Gas baseline footprint'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.footprint.gasHint', 'Distance × 0.192 kg CO₂/km') },
    { metricId: 'mass', occurrenceId: 'carbon-footprint-net', rawValue: resolved ? period.netAvoidedCo2Kg : null,
      label: t('carbon.footprint.net', 'Baseline less charging'),
      display: { formatter: raw => ({ value: display.formatSignedKg(raw), unit: '' }) },
      context: t('carbon.footprint.netHint', 'Negative values are retained as excess emissions') },
    { metricId: 'distance', occurrenceId: 'carbon-footprint-distance', rawValue: resolved ? period.inferredGasBaselineDistanceM : null,
      label: t('carbon.footprint.distance', 'Implied baseline distance'),
      display: { formatter: raw => ({ value: display.formatDistance(raw), unit: '' }) },
      context: t('carbon.footprint.distanceHint', 'Reverse-derived from the returned baseline') },
  ];
  return <CarbonBriefBand testId="carbon-period-footprint" metrics={metrics} state={states.period}
    title={t('carbon.footprint.title', 'Selected-period footprint vs gas baseline')}
    description={t('carbon.brief.coverage', 'Selected-period summary; continuous source coverage is unknown.')}
    scope={<span>{analysis.window.startLabel} – {analysis.window.endLabel} · {analysis.window.timezone}</span>}>
    <Text as="p" variant="bodySm" className="mt-4">{comparison}</Text>
  </CarbonBriefBand>;
}
