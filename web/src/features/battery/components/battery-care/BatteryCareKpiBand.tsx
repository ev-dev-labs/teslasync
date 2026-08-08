import {
  BatteryFull,
  BatteryWarning,
  HeartPulse,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import type { CareScore } from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface BatteryCareKpiBandProps {
  care: CareScore;
  state: BatteryCareSectionState;
}

function percentage(value: number | null): string {
  return value != null ? fmtPercent(value * 100, 0) : '—';
}

/** Existing four-KPI summary, now calibrated against the larger evidence window. */
export function BatteryCareKpiBand({
  care,
  state,
}: BatteryCareKpiBandProps) {
  const { t } = useTranslation();
  const hasData =
    care.sessionsAnalyzed > 0 ||
    care.drivesAnalyzed > 0 ||
    care.energyMix.energySessions > 0;

  return (
    <BatteryCareSection
      title={t('batteryCare.summary.title', 'Observed care summary')}
      description={t(
        'batteryCare.summary.description',
        'Descriptive signals from the returned charging and drive windows',
      )}
      icon={<HeartPulse className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      emptyIcon={<HeartPulse className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.summary.empty',
        'No usable session-end or drive-arrival SoC evidence is available yet.',
      )}
      hasData={hasData}
      state={state}
      testId="battery-care-kpis"
      loadingHeight={112}
    >
      <section
        aria-label={t('batteryCare.kpis', 'Battery care summary metrics')}
        className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
      >
        <MetricCard
          label={t('batteryCare.score', 'Care Score')}
          value={care.score != null ? fmtInt(care.score) : '—'}
          subtitle={
            care.scoreReady
              ? t('batteryCare.of100', 'of 100')
              : t('batteryCare.summary.calibrating', 'calibrating evidence')
          }
          icon={<HeartPulse className="h-5 w-5" aria-hidden="true" />}
          color={
            care.score == null
              ? 'cyan'
              : care.score >= 80
                ? 'green'
                : care.score >= 60
                  ? 'amber'
                  : 'red'
          }
        />
        <MetricCard
          label={t(
            'batteryCare.fullCharges',
            'Charges to {{pct}}%+',
            { pct: care.fullChargePct },
          )}
          value={percentage(care.fullChargeShare)}
          subtitle={t(
            'batteryCare.ofSessions',
            'of {{count}} sessions',
            { count: care.sessionsAnalyzed },
          )}
          icon={<BatteryFull className="h-5 w-5" aria-hidden="true" />}
          color="amber"
        />
        <MetricCard
          label={t('batteryCare.deepDischarges', 'Deep Discharges')}
          value={percentage(care.deepDischargeShare)}
          subtitle={t(
            'batteryCare.summary.arrivalEvidence',
            'of {{count}} drive arrivals below 10%',
            { count: care.drivesAnalyzed },
          )}
          icon={<BatteryWarning className="h-5 w-5" aria-hidden="true" />}
          color="red"
        />
        <MetricCard
          label={t('batteryCare.dcShare', 'DC Fast Energy')}
          value={percentage(care.dcEnergyShare)}
          subtitle={t(
            'batteryCare.summary.classifiedEnergy',
            'of classified AC/DC energy',
          )}
          icon={<Zap className="h-5 w-5" aria-hidden="true" />}
          color="purple"
        />
      </section>
    </BatteryCareSection>
  );
}
