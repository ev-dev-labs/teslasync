import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { deriveDataState } from '@/api/dataState';
import { Grid, PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Code, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
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
  const { tz } = useDateFormat();
  const [nowMs] = useState(() => Date.now());
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DEFAULT_HISTORY_LIMIT,
  );
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const source = deriveDataState(drivesQuery, { provenance: 'historical' });
  const milestoneUnitKm =
    convertDistanceToSI(1, unitPrefs.distance) / 1_000;
  const options = useMemo(() => ({
    nowMs, milestoneUnitKm, timezone: tz, historyLimit: DEFAULT_HISTORY_LIMIT,
  }), [nowMs, milestoneUnitKm, tz]);
  const observation = useMemo(() => {
    try {
      return { summary: buildOdometerMilestones(drives, { ...options, baseOdometerKm: 0 }), error: null };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { summary: null, error };
    }
  }, [drives, options]);
  const first = observation.summary?.cumulativeSeries[0];
  const origin = drivesQuery.data == null || observation.error
    ? 'unresolved'
    : first ? `${first.timestampMs}:${first.driveId}` : 'empty';
  const calibrationKey = `teslasync:milestones-base-km:v2:vehicle:${vehicleIdStr ?? 'none'}:origin:${origin}`;
  const [storedBaseKm, setStoredBaseKm, storedRaw] = useStoredNumber(calibrationKey, 0);
  const [, , legacyRaw] = useStoredNumber('teslasync:milestones-base-km:v1', 0);
  const [rejectedEdit, setRejectedEdit] = useState<{ key: string; committed: number } | null>(null);
  const unassigned = legacyRaw != null && storedRaw == null;
  const calibration = useMemo(() => {
    try {
      const baseOdometerKm = storedRaw == null ? storedBaseKm
        : storedRaw.trim() === '' ? NaN : Number(storedRaw);
      return {
        summary: buildOdometerMilestones(drives, { ...options, baseOdometerKm }),
        error: null,
      };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { summary: null, error };
    }
  }, [drives, options, storedBaseKm, storedRaw]);
  // Error shells require a model shape, never a successful zero substitute.
  const summary = calibration.summary ?? observation.summary
    ?? buildOdometerMilestones([], { ...options, baseOdometerKm: 0 });
  const savedError = calibration.error ? t(
    'milestones.controls.invalidCalibration',
    'The saved calibration cannot be used with this returned history window. It has been preserved. Enter a valid reading to recover.',
  ) : unassigned ? t(
    'milestones.controls.unassignedCalibration',
    'A previous calibration is saved without a vehicle or history-window assignment. It has not been applied. Enter a reading for this vehicle and returned history window; the previous value will be preserved.',
  ) : undefined;
  const editError = rejectedEdit?.key === calibrationKey && rejectedEdit.committed === storedBaseKm
    ? t('common.invalidNumber', 'Enter a valid number') : undefined;
  const baseDisplay = savedError ? null : convertDistanceFromSI(storedBaseKm * 1_000, unitPrefs.distance);

  function handleBaseChange(value: string): boolean {
    const displayValue = Number(value);
    if (origin === 'unresolved' || vehicleId == null) return false;
    const candidateBaseKm =
      convertDistanceToSI(displayValue, unitPrefs.distance) / 1_000;
    try {
      // Validate the complete observed total with the model's existing guardrails.
      buildOdometerMilestones(drives, {
        ...options, baseOdometerKm: value.trim() === '' ? NaN : candidateBaseKm,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      setRejectedEdit({ key: calibrationKey, committed: storedBaseKm });
      return false;
    }
    setRejectedEdit(null);
    setStoredBaseKm(candidateBaseKm);
    return true;
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
    error: source.fatalError ?? observation.error ?? (savedError ? new RangeError(savedError) : null),
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
        <div
          role="group"
          aria-label={t('milestones.controls.baseLabel', 'Window-start odometer')}
          className="flex min-w-0 flex-col items-end gap-2"
        >
          <MilestoneControls
            baseDisplay={baseDisplay}
            distanceUnit={unitPrefs.distance}
            onBaseChange={handleBaseChange}
            calibrationKey={calibrationKey}
            error={editError ?? savedError}
            disabled={origin === 'unresolved'}
            onCancel={() => setRejectedEdit(null)}
          />
          {legacyRaw != null && <Text variant="bodySm">
            {t(
              'milestones.controls.unassignedCalibration',
              'A previous calibration is saved without a vehicle or history-window assignment. It has not been applied. Enter a reading for this vehicle and returned history window; the previous value will be preserved.',
            )} <Code>{legacyRaw}</Code> {t('milestones.units.km', 'km')}
          </Text>}
        </div>
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
