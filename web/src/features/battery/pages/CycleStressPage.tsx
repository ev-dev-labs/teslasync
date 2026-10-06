import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout, Section } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

import {
  CycleStressComposition,
  CycleStressContinuity,
  CycleStressDepthDistribution,
  CycleStressDurationProfile,
  CycleStressEvidenceSupport,
  CycleStressExponentSensitivity,
  CycleStressMeanSocProfile,
  CycleStressMethodology,
  CycleStressMonthTrend,
  CycleStressSourceCoverage,
  CycleStressThresholdSensitivity,
  CycleStressTurningPointTimeline,
} from '../components/cycle-stress';
import {
  CycleStressAccounting,
  CycleStressDirectory,
  CycleStressSummary,
  cycleStressQueryState,
} from '../components/cycle-stress-modernization';
import {
  analyzeCycleStress,
  DEEP_CYCLE_THRESHOLD_PCT,
  DEFAULT_CYCLE_HISTORY_LIMIT,
  DEPTH_STRESS_EXPONENT,
} from '../lib/cycleStress';

const TWO_COLUMNS = { default: 1 } as const;
const PAIRED_CHARTS = 'min-w-0 items-stretch @[1024px]:grid-cols-2';

export default function CycleStressPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('cycleStress.title', 'Cycle Stress'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    DEFAULT_CYCLE_HISTORY_LIMIT,
  );
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DEFAULT_CYCLE_HISTORY_LIMIT,
  );
  const [nowMs] = useState(() => Date.now());
  const [deepThresholdPct, setDeepThresholdPct] = useState(
    DEEP_CYCLE_THRESHOLD_PCT,
  );
  const [exponent, setExponent] = useState(DEPTH_STRESS_EXPONENT);

  const sessions = useMemo<ChargingSession[]>(
    () => (vehicleId != null ? sessionsQuery.data ?? [] : []),
    [sessionsQuery.data, vehicleId],
  );
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const result = useMemo(
    () =>
      analyzeCycleStress(
        sessions,
        drives,
        nowMs,
        selectedTimeZone,
        {
          deepThresholdPct,
          exponent,
          historyLimit: DEFAULT_CYCLE_HISTORY_LIMIT,
        },
      ),
    [
      deepThresholdPct,
      drives,
      exponent,
      nowMs,
      selectedTimeZone,
      sessions,
    ],
  );

  const trust = cycleStressQueryState(vehicleId != null, sessionsQuery, drivesQuery);
  const { state } = trust;
  const locale = i18n.language;

  return (
    <PageLayout
      title={t('cycleStress.title', 'Cycle Stress')}
      subtitle={t(
        'cycleStress.subtitle',
        'Continuity-bounded SoC cycle reconstruction, sensitivity, source coverage, and accounting',
      )}
    >
      <FadeIn>
        <CycleStressSummary
          result={result}
          trust={trust}
          locale={locale}
          deepThresholdPct={deepThresholdPct}
          exponent={exponent}
          onDeepThresholdChange={setDeepThresholdPct}
          onExponentChange={setExponent}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Section id="cycle-stress-ranges"
          title={t('cycleStress.modernization.ranges', 'Cycle depth and calendar trend')}>
          <Grid cols={TWO_COLUMNS} gap={4} className={PAIRED_CHARTS}>
            <CycleStressDepthDistribution result={result} state={state} />
            <CycleStressMonthTrend
              result={result}
              state={state}
              locale={locale}
            />
          </Grid>
        </Section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Section id="cycle-stress-sensitivity"
          title={t('cycleStress.modernization.sensitivity', 'Sensitivity lenses')}>
          <Grid cols={TWO_COLUMNS} gap={4} className={PAIRED_CHARTS}>
            <CycleStressThresholdSensitivity
              result={result}
              state={state}
            />
            <CycleStressExponentSensitivity
              result={result}
              state={state}
            />
          </Grid>
        </Section>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Section id="cycle-stress-profiles"
          title={t('cycleStress.modernization.profiles', 'Operating profiles')}>
          <Grid cols={TWO_COLUMNS} gap={4} className={PAIRED_CHARTS}>
            <CycleStressMeanSocProfile result={result} state={state} />
            <CycleStressDurationProfile result={result} state={state} />
          </Grid>
        </Section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <CycleStressComposition
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <CycleStressTurningPointTimeline
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <CycleStressDirectory
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <CycleStressSourceCoverage
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.4}>
        <CycleStressContinuity
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.45}>
        <CycleStressEvidenceSupport
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.5}>
        <CycleStressAccounting
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.55}>
        <CycleStressMethodology result={result} />
      </FadeIn>
    </PageLayout>
  );
}
