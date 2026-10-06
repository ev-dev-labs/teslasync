import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';

import { CardGrid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useTimezone } from '@/lib/timezone';
import type { ChargingSession } from '@/types/charging';

import {
  PackCapacityCoverage,
  PackCapacityEstimateTimeline,
  PackCapacityEvidenceSupport,
  PackCapacityFitDiagnostics,
  PackCapacityInfluenceTimeline,
  PackCapacityInnovationProfile,
  PackCapacityMethodology,
  PackCapacityMonthTrend,
  PackCapacityProcessSensitivity,
  PackCapacitySocWindowProfile,
  PackCapacityWindowSensitivity,
} from '../components/pack-capacity';
import {
  PackCapacityPlacement,
  PackCapacityMeasurementDirectory,
  PackCapacityRowAccounting,
  PackCapacitySourceNotice,
  PackCapacitySummary,
  packCapacitySourceState,
} from '../components/pack-capacity-modernization';
import {
  analyzePackCapacity,
  DEFAULT_CAPACITY_SOC_WINDOW_PCT,
  DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
  DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY,
} from '../lib/packCapacity';

export default function PackCapacityPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('packCapacity.title', 'Pack Capacity'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const { unitPrefs, formatEnergy } = useUnits();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
  );
  const sessionsSource = useDataState(sessionsQuery, { provenance: 'historical' });
  const [nowMs] = useState(() => Date.now());
  const [minSocWindowPct, setMinSocWindowPct] = useState(
    DEFAULT_CAPACITY_SOC_WINDOW_PCT,
  );
  const [
    processNoiseWhPerSqrtDay,
    setProcessNoiseWhPerSqrtDay,
  ] = useState(DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY);

  const sessions = useMemo<ChargingSession[]>(
    () => (vehicleId != null ? sessionsQuery.data ?? [] : []),
    [sessionsQuery.data, vehicleId],
  );
  const result = useMemo(
    () =>
      analyzePackCapacity(
        sessions,
        nowMs,
        selectedTimeZone,
        {
          minSocWindowPct,
          processNoiseWhPerSqrtDay,
          historyLimit: DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
        },
      ),
    [
      minSocWindowPct,
      nowMs,
      processNoiseWhPerSqrtDay,
      selectedTimeZone,
      sessions,
    ],
  );

  const vehicleSelected = vehicleId != null;
  const state = packCapacitySourceState(
    sessionsSource,
    vehicleSelected,
    sessionsQuery.isLoading || sessionsQuery.isFetching,
  );
  const locale = i18n.language;
  const energyUnit = unitPrefs.energy;

  return (
    <PageLayout
      title={t('packCapacity.title', 'Pack Capacity')}
      subtitle={t(
        'packCapacity.subtitle',
        'Charging-derived capacity evidence, uncertainty, sensitivity, diagnostics, and exact row accounting',
      )}
    >
      <FadeIn className="w-full min-w-0">
        <PackCapacitySummary
          result={result}
          state={state}
          locale={locale}
          formatEnergy={formatEnergy}
          minSocWindowPct={minSocWindowPct}
          processNoiseWhPerSqrtDay={processNoiseWhPerSqrtDay}
          onMinSocWindowChange={setMinSocWindowPct}
          onProcessNoiseChange={setProcessNoiseWhPerSqrtDay}
        />
        <PackCapacitySourceNotice
          source={sessionsSource}
          vehicleSelected={vehicleSelected}
        />
      </FadeIn>

      <FadeIn delay={0.05} className="w-full min-w-0">
        <PackCapacityEstimateTimeline
          result={result}
          state={state}
          locale={locale}
          energyUnit={energyUnit}
        />
      </FadeIn>

      <FadeIn delay={0.1} className="w-full min-w-0">
        <CardGrid
          label={t('packCapacity.modernization.profiles', 'Monthly and SoC-window evidence')}
          items={[
            {
              id: 'pack-capacity-month-trend',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityMonthTrend
                    result={result}
                    state={state}
                    locale={locale}
                    energyUnit={energyUnit}
                  />
                </PackCapacityPlacement>
              ),
            },
            {
              id: 'pack-capacity-soc-window-profile',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacitySocWindowProfile
                    result={result}
                    state={state}
                    energyUnit={energyUnit}
                  />
                </PackCapacityPlacement>
              ),
            },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.15} className="w-full min-w-0">
        <CardGrid
          label={t('packCapacity.modernization.sensitivity', 'Model sensitivity')}
          items={[
            {
              id: 'pack-capacity-window-sensitivity',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityWindowSensitivity
                    result={result}
                    state={state}
                    energyUnit={energyUnit}
                  />
                </PackCapacityPlacement>
              ),
            },
            {
              id: 'pack-capacity-process-sensitivity',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityProcessSensitivity
                    result={result}
                    state={state}
                    energyUnit={energyUnit}
                  />
                </PackCapacityPlacement>
              ),
            },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.2} className="w-full min-w-0">
        <CardGrid
          label={t('packCapacity.modernization.influence', 'Innovation and observation influence')}
          items={[
            {
              id: 'pack-capacity-innovation-profile',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityInnovationProfile result={result} state={state} />
                </PackCapacityPlacement>
              ),
            },
            {
              id: 'pack-capacity-influence-timeline',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityInfluenceTimeline
                    result={result}
                    state={state}
                    locale={locale}
                    energyUnit={energyUnit}
                  />
                </PackCapacityPlacement>
              ),
            },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.25} className="w-full min-w-0">
        <PackCapacityFitDiagnostics
          result={result}
          state={state}
          locale={locale}
          energyUnit={energyUnit}
          formatEnergy={formatEnergy}
        />
      </FadeIn>

      <FadeIn delay={0.3} className="w-full min-w-0">
        <PackCapacityMeasurementDirectory
          result={result}
          state={state}
          locale={locale}
          formatEnergy={formatEnergy}
        />
      </FadeIn>

      <FadeIn delay={0.35} className="w-full min-w-0">
        <CardGrid
          label={t('packCapacity.modernization.coverage', 'Coverage and evidence support')}
          items={[
            {
              id: 'pack-capacity-coverage',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityCoverage result={result} state={state} locale={locale} />
                </PackCapacityPlacement>
              ),
            },
            {
              id: 'pack-capacity-evidence-support',
              size: 'half',
              content: (
                <PackCapacityPlacement>
                  <PackCapacityEvidenceSupport result={result} state={state} locale={locale} />
                </PackCapacityPlacement>
              ),
            },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.4} className="w-full min-w-0">
        <PackCapacityRowAccounting
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.45} className="w-full min-w-0">
        <PackCapacityMethodology result={result} />
      </FadeIn>
    </PageLayout>
  );
}
