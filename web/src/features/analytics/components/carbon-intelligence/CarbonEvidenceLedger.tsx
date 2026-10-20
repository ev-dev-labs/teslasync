import {
  Activity,
  CalendarRange,
  Factory,
  Fuel,
  Gauge,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip, type StatMetric } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonEvidenceLedger({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const period = analysis.period;
  const resolved = states.period.hasData;
  const netLabel = period.netDisposition === 'excess'
    ? t('carbon.evidence.netExcess', 'Excess vs gas baseline')
    : period.netDisposition === 'unknown'
      ? t('carbon.evidence.netUnavailable', 'Baseline comparison unavailable')
      : period.netDisposition === 'balanced'
        ? t('carbon.evidence.netBalanced', 'At gas baseline')
        : t('carbon.evidence.netAvoided', 'Net avoided vs gas baseline');
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'carbon-period-energy',
      label: t('carbon.evidence.energy', 'Charging energy'),
      rawValue: resolved ? display.formatEnergy(period.totalEnergyWh) : null,
      description: t('carbon.evidence.energyHint', 'Normalized once from the legacy API wire value'),
      context: <><Zap className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.energyHint', 'Normalized once from the legacy API wire value')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'carbon-period-co2',
      label: t('carbon.evidence.co2', 'Attributed charging CO₂'),
      rawValue: resolved ? display.formatKg(period.totalCo2Kg) : null,
      description: t('carbon.evidence.co2Hint', 'Energy attributed by backend model clock-hour'),
      context: <><Factory className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.co2Hint', 'Energy attributed by backend model clock-hour')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'carbon-period-sessions',
      label: t('carbon.evidence.sessions', 'Sessions scored'),
      rawValue: resolved ? display.formatNumber(period.sessionsScored) : null,
      description: t('carbon.evidence.sessionsHint', 'Positive-energy charging sessions'),
      context: <><Activity className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.sessionsHint', 'Positive-energy charging sessions')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'carbon-period-intensity',
      label: t('carbon.evidence.average', 'Energy-weighted intensity'),
      rawValue: resolved ? display.formatIntensity(period.energyWeightedIntensityGPerKwh) : null,
      description: t('carbon.evidence.averageHint', 'Derived from returned CO₂ and energy'),
      context: <><Gauge className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.averageHint', 'Derived from returned CO₂ and energy')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'carbon-period-gas',
      label: t('carbon.evidence.gas', 'Gas-car baseline'),
      rawValue: resolved ? display.formatKg(period.gasBaselineCo2Kg) : null,
      description: t('carbon.evidence.gasHint', 'Fixed 0.192 kg CO₂ per km'),
      context: <><Fuel className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.gasHint', 'Fixed 0.192 kg CO₂ per km')}</>,
    },
    {
      metricId: 'text', occurrenceId: 'carbon-period-net',
      label: netLabel,
      rawValue: resolved ? display.formatSignedKg(period.netAvoidedCo2Kg) : null,
      description: t('carbon.evidence.netHint', 'Gas baseline minus attributed charging CO₂'),
      context: <><CalendarRange className="h-5 w-5" aria-hidden="true" />{t('carbon.evidence.netHint', 'Gas baseline minus attributed charging CO₂')}</>,
    },
  ];

  return (
    <section
      data-testid="carbon-evidence-ledger"
      aria-label={t(
        'carbon.evidence.aria',
        'Selected-period carbon KPI and evidence ledger',
      )}
    >
      <LayoutCard
        title={t('carbon.evidence.title', 'Selected-period evidence ledger')}
        actions={<CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.period}>
          <StatStrip
            id="carbon-period-evidence-metrics"
            variant="embedded"
            metrics={metrics}
            period={analysis.window.availability === 'invalid' ? {
              kind: 'unknown',
              label: t('carbon.source.period', 'Selected-period summary'),
              reason: t('carbon.source.invalidWindow', 'The date-window labels or RFC3339 boundaries are invalid; period interpretation is withheld.'),
            } : {
              kind: 'analysis',
              label: t('carbon.source.periodScope', '{{start}} through {{end}} calendar labels', {
                start: analysis.window.startLabel, end: analysis.window.endLabel,
              }),
              start: analysis.window.startInstant,
              endExclusive: analysis.window.endInstantExclusive,
              timezone: analysis.window.timezone,
              completeness: 'unknown',
              provenance: t('carbon.source.period', 'Selected-period summary'),
            }}
          />
          {period.availability === 'empty' ? (
            <AlertBanner className="mt-4" variant="info">
              {t(
                'carbon.evidence.validEmpty',
                'The selected-period endpoint returned a valid zero-evidence response.',
              )}
            </AlertBanner>
          ) : period.availability === 'invalid' ? (
            <AlertBanner className="mt-4" variant="warning">
              {t(
                'carbon.evidence.invalid',
                'Some selected-period fields failed runtime validation; unknown values remain withheld.',
              )}
            </AlertBanner>
          ) : null}
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
