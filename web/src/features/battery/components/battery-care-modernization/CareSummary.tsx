import { HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import type { StatPeriod } from '@/lib/metric-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CareScore } from '../../lib/batteryCare';
import { CareSection } from './CareSection';
import type { CareSectionState } from './state';

export function CareSummary({ care, state }: { care: CareScore; state: CareSectionState }) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('batteryCare.summary.title', 'Observed care summary'),
    reason: t(
      'batteryCare.summary.description',
      'Descriptive signals from the returned charging and drive windows',
    ),
  };
  const scoreStatus = care.scoreReady
    ? t('batteryCare.of100', 'of 100')
    : t('batteryCare.summary.calibrating', 'calibrating evidence');
  const scoreTone = care.score == null
    ? 'neutral'
    : care.score >= 80 ? 'success' : care.score >= 60 ? 'warning' : 'danger';
  const metrics: StatMetric[] = [
    {
      metricId: 'score',
      occurrenceId: 'battery-care-score',
      rawValue: care.score,
      display: { precision: 0, units: { locale } },
      label: t('batteryCare.score', 'Care Score'),
      description: t(
        'batteryCare.risk.disclaimer',
        'This descriptive habit index is not a battery-health measurement or a degradation estimate.',
      ),
      context: <Badge variant={scoreTone}>{scoreStatus}</Badge>,
    },
    {
      metricId: 'percent',
      occurrenceId: 'battery-care-full-charges',
      rawValue: care.fullChargeShare == null ? null : care.fullChargeShare * 100,
      display: { precision, units: { locale } },
      label: t('batteryCare.fullCharges', 'Charges to {{pct}}%+', { pct: care.fullChargePct }),
      description: t(
        'batteryCare.targets.description',
        'Observed session-end SoC; this does not measure how long the pack remained at a level',
      ),
      context: t('batteryCare.ofSessions', 'of {{count}} sessions', { count: care.sessionsAnalyzed }),
    },
    {
      metricId: 'percent',
      occurrenceId: 'battery-care-deep-arrivals',
      rawValue: care.deepDischargeShare == null ? null : care.deepDischargeShare * 100,
      display: { precision, units: { locale } },
      label: t('batteryCare.deepDischarges', 'Deep Discharges'),
      description: t(
        'batteryCare.arrivals.description',
        'Observed end-of-drive SoC, without assumptions about subsequent parking or charging',
      ),
      context: t('batteryCare.summary.arrivalEvidence', 'of {{count}} drive arrivals below 10%', {
        count: care.drivesAnalyzed,
      }),
    },
    {
      metricId: 'percent',
      occurrenceId: 'battery-care-dc-energy',
      rawValue: care.dcEnergyShare == null ? null : care.dcEnergyShare * 100,
      display: { precision, units: { locale } },
      label: t('batteryCare.dcShare', 'DC Fast Energy'),
      description: t(
        'batteryCare.energy.denominator',
        'The DC KPI uses classified AC/DC energy only; unclassified energy stays visible here and can withhold the score.',
      ),
      context: t('batteryCare.summary.classifiedEnergy', 'of classified AC/DC energy'),
    },
  ];
  return (
    <CareSection
      title={t('batteryCare.summary.title', 'Observed care summary')}
      description={t('batteryCare.summary.description', 'Descriptive signals from the returned charging and drive windows')}
      icon={<HeartPulse className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t('batteryCare.summary.empty', 'No usable session-end or drive-arrival SoC evidence is available yet.')}
      hasData={care.sessionsAnalyzed > 0 || care.drivesAnalyzed > 0 || care.energyMix.energySessions > 0}
      state={state}
      testId="battery-care-kpis"
      loadingHeight={112}
    >
      <section aria-label={t('batteryCare.kpis', 'Battery care summary metrics')}>
        <BatteryEvidenceBrief
        id="battery-care-summary"
        title={t('batteryCare.summary.title', 'Observed care summary')}
        metrics={metrics}
        period={period}
        retained={state.sources.some(source => source.state.status === 'stale')}
        />
      </section>
    </CareSection>
  );
}
