import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { deriveDataState } from '@/api/dataState';
import { Grid, PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertDistanceToSI,
} from '@/lib/unitConversion';

import {
  MilestoneControls,
  MilestoneMethodology,
  MilestoneProgress,
  MonthlyDistanceChart,
  OdometerGrowthChart,
  PaceForecastScenarios,
  ReachedMilestones,
  UpcomingRoadmap,
  type MilestoneSectionState,
} from '../components/odometer-milestones';
import { MilestoneBrief as MilestoneKpis } from '../components/operationalbrief-a-m/MilestoneBrief';
import {
  DEFAULT_HISTORY_LIMIT,
  buildOdometerMilestones,
} from '../lib/odometerMilestones';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function MilestonesPage() {
  const { t } = useTranslation();
  usePageTitle(t('milestones.title', 'Odometer milestones'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const { unitPrefs } = useUnits();
  const [nowMs] = useState(() => Date.now());
  const [storedBaseKm, setStoredBaseKm] = useStoredNumber(
    'teslasync:milestones-base-km:v1',
    0,
  );
  const baseOdometerKm =
    Number.isFinite(storedBaseKm) && storedBaseKm >= 0
      ? storedBaseKm
      : 0;

  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DEFAULT_HISTORY_LIMIT,
  );
  const drives = drivesQuery.data ?? [];
  const source = deriveDataState(drivesQuery, { provenance: 'historical' });
  const milestoneUnitKm =
    convertDistanceToSI(1, unitPrefs.distance) / 1_000;
  const summary = useMemo(
    () =>
      buildOdometerMilestones(drives, {
        baseOdometerKm,
        nowMs,
        milestoneUnitKm,
        historyLimit: DEFAULT_HISTORY_LIMIT,
      }),
    [baseOdometerKm, drives, milestoneUnitKm, nowMs],
  );
  const baseDisplay = Math.round(
    convertDistanceFromSI(
      baseOdometerKm * 1_000,
      unitPrefs.distance,
    ),
  );

  function handleBaseChange(value: string): void {
    if (value.trim() === '') return;
    const displayValue = Number(value);
    if (!Number.isFinite(displayValue) || displayValue < 0) return;
    setStoredBaseKm(
      convertDistanceToSI(displayValue, unitPrefs.distance) / 1_000,
    );
  }

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('milestones.title', 'Odometer milestones')}
      />
    );
  }

  const sectionState: MilestoneSectionState = {
    isLoading: source.status === 'initial',
    error: source.fatalError,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('milestones.title', 'Odometer milestones')}
      subtitle={t(
        'milestones.subtitle',
        'Observed progress, unit-round milestones, and evidence-based forecasts',
      )}
      query={drivesQuery}
      contextActions={
        <MilestoneControls
          baseDisplay={baseDisplay}
          distanceUnit={unitPrefs.distance}
          onBaseChange={handleBaseChange}
        />
      }
    >
      <StaleRefreshWarning state={source} />
      <FadeIn>
        <MilestoneKpis summary={summary} {...sectionState}
          retained={source.status === 'stale' || source.isRefreshBlocked} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <MilestoneProgress
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <OdometerGrowthChart
            summary={summary}
            state={sectionState}
          />
          <MonthlyDistanceChart
            summary={summary}
            state={sectionState}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ReachedMilestones
            summary={summary}
            state={sectionState}
          />
          <UpcomingRoadmap
            summary={summary}
            state={sectionState}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <PaceForecastScenarios
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <MilestoneMethodology
          summary={summary}
          state={sectionState}
        />
      </FadeIn>
    </PageLayout>
  );
}
