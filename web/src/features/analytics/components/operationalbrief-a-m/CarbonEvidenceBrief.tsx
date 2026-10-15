import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { CarbonSectionBody } from '../carbon-intelligence/CarbonSectionBody';
import type { CarbonSectionProps } from '../carbon-intelligence/types';

export function CarbonEvidenceBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const period = analysis.period;
  const resolved = states.period.hasData;
  const netLabel = period.netDisposition === 'excess' ? t('carbon.evidence.netExcess', 'Excess vs gas baseline')
    : period.netDisposition === 'unknown' ? t('carbon.evidence.netUnavailable', 'Baseline comparison unavailable')
      : period.netDisposition === 'balanced' ? t('carbon.evidence.netBalanced', 'At gas baseline')
        : t('carbon.evidence.netAvoided', 'Net avoided vs gas baseline');
  const metrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'carbon-period-energy', rawValue: resolved ? period.totalEnergyWh : null,
      label: t('carbon.evidence.energy', 'Charging energy'),
      display: { formatter: raw => ({ value: display.formatEnergy(raw), unit: '' }) },
      context: t('carbon.evidence.energyHint', 'Normalized once from the legacy API wire value') },
    { metricId: 'mass', occurrenceId: 'carbon-period-co2', rawValue: resolved ? period.totalCo2Kg : null,
      label: t('carbon.evidence.co2', 'Attributed charging CO₂'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.evidence.co2Hint', 'Energy attributed by backend model clock-hour') },
    { metricId: 'count', occurrenceId: 'carbon-period-sessions', rawValue: resolved ? period.sessionsScored : null,
      label: t('carbon.evidence.sessions', 'Sessions scored'),
      display: { formatter: raw => ({ value: display.formatNumber(raw), unit: '' }) },
      context: t('carbon.evidence.sessionsHint', 'Positive-energy charging sessions') },
    { metricId: 'rate', occurrenceId: 'carbon-period-intensity', rawValue: resolved ? period.energyWeightedIntensityGPerKwh : null,
      label: t('carbon.evidence.average', 'Energy-weighted intensity'),
      description: t('carbon.brief.intensityUnit', 'Source intensity in grams of CO₂ per kilowatt-hour.'),
      display: { formatter: raw => ({ value: display.formatIntensity(raw), unit: '' }) },
      context: t('carbon.evidence.averageHint', 'Derived from returned CO₂ and energy') },
    { metricId: 'mass', occurrenceId: 'carbon-period-gas', rawValue: resolved ? period.gasBaselineCo2Kg : null,
      label: t('carbon.evidence.gas', 'Gas-car baseline'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.evidence.gasHint', 'Fixed 0.192 kg CO₂ per km') },
    { metricId: 'mass', occurrenceId: 'carbon-period-net', rawValue: resolved ? period.netAvoidedCo2Kg : null,
      label: netLabel, display: { formatter: raw => ({ value: display.formatSignedKg(raw), unit: '' }) },
      context: t('carbon.evidence.netHint', 'Gas baseline minus attributed charging CO₂') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const invalidWindow = analysis.window.availability === 'invalid';
  const provenance = invalidWindow
    ? t('carbon.source.invalidWindow', 'The date-window labels or RFC3339 boundaries are invalid; period interpretation is withheld.')
    : t('carbon.brief.coverage', 'Selected-period summary; continuous source coverage is unknown.');
  return <section data-testid="carbon-evidence-ledger"
    aria-label={t('carbon.evidence.aria', 'Selected-period carbon KPI and evidence ledger')}>
    <OperationalBrief compact title={t('carbon.evidence.title', 'Selected-period evidence ledger')}
      eyebrow={t('carbon.title', 'Carbon intelligence')} description={provenance}
      metrics={operationalMetrics} loading={states.period.isLoading && !resolved}
      statusLabel={states.period.isLoading && !resolved ? t('analytics.brief.loading', 'Loading evidence')
        : !resolved ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : states.period.refreshError || states.period.refreshPaused ? t('analytics.brief.retained', 'Retained evidence')
            : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!resolved || states.period.refreshError || states.period.refreshPaused ? 'warning' : 'neutral'}
      scope={<span>{invalidWindow ? t('carbon.source.period', 'Selected-period summary')
        : t('carbon.source.periodScope', '{{start}} through {{end}} calendar labels', {
          start: analysis.window.startLabel, end: analysis.window.endLabel })}
        {!invalidWindow && ` · ${analysis.window.startInstant} – ${analysis.window.endInstantExclusive} · ${analysis.window.timezone}`}</span>}
      provenance={provenance}
    />
    <CarbonSectionBody state={states.period}>
      {period.availability === 'empty' ? <AlertBanner className="mt-4" variant="info">
        {t('carbon.evidence.validEmpty', 'The selected-period endpoint returned a valid zero-evidence response.')}
      </AlertBanner> : period.availability === 'invalid' ? <AlertBanner className="mt-4" variant="warning">
        {t('carbon.evidence.invalid', 'Some selected-period fields failed runtime validation; unknown values remain withheld.')}
      </AlertBanner> : null}
    </CarbonSectionBody>
  </section>;
}
