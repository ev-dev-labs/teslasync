import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { QueryError, Skeleton } from '@/components/feedback';
import { Badge, SectionTitle, Text } from '@/components/ui';

import { FadeIn } from '@/components/motion';

import { useDrives } from '@/api/hooks/useDriving';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignalQueryInvalidation } from '@/hooks/useSignalQueryInvalidation';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlString } from '@/hooks/useUrlState';
import { INTERVALS } from '@/lib/constants';
import { useTimezone } from '@/lib/timezone';
import { convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI } from '@/lib/unitConversion';
import {
  LiveMotorStatus,
  GForcePanel,
  PedalUsage,
  SpeedGearPanel,
  AutopilotSection,
  MotorHistoryCharts,
  MotorEfficiencyInsights,
  SummaryStats,
  DrivingCoachSection,
  DriveAnalyticsSection,
  DrivingTips,
  GrokDynamicsBriefing,
  DynamicsTripToolbar,
  RideOverview,
  PowertrainSummary,
} from '../components/driving-dynamics';
import {
  isOpenDrive,
  mergeOpenDrives,
  motorWindowForDrive,
  pickDynamicsDrive,
} from '../components/driving-dynamics/pickDynamicsDrive';

/**
 * Tesla signal fields that feed each live query on this page, taken from the
 * backend projections: `motorMappings` in internal/api/motor/handler.go and
 * `driveDynamicsMappings` in internal/api/drivedyn/handler.go. When one of
 * these arrives on the `signal_change` SSE channel the matching query is
 * invalidated, so the live panels update within the coalescing window instead
 * of waiting out their poll interval.
 */
const MOTOR_SIGNAL_FIELDS = [
  'DiMotorCurrentF',
  'DiMotorCurrentR',
  'DiTorqueActualF',
  'DiTorqueActualR',
  'DiTorquemotor',
  'DiAxleSpeedF',
  'DiAxleSpeedR',
  'DiStatorTempF',
  'DiStatorTempR',
  'DiHeatsinkTF',
  'DiHeatsinkTR',
  'DiInverterTF',
  'DiInverterTR',
  'DiStateF',
  'DiStateR',
  'DiVBatF',
  'DiVBatR',
  'Gear',
] as const;

const DRIVE_DYNAMICS_SIGNAL_FIELDS = [
  'LateralAcceleration',
  'LongitudinalAcceleration',
  'PedalPosition',
  'BrakePedalPos',
  'BrakePedal',
] as const;

const CRUISE_SIGNAL_FIELDS = ['CruiseSetSpeed', 'CruiseFollowDistance', 'VehicleSpeed'] as const;

export default function DrivingDynamicsPage() {
  const { t } = useTranslation();
  usePageTitle(t('dynamics.title', 'Driving Dynamics'));

  /* ---- vehicle selection ---- */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const vehicleIdNum = vehicleId ?? 0;

  /* Selected-drive evidence and current vehicle state are separate sources.
   * The page freshness indicator follows the selector, never parked motors. */
  const timezone = useTimezone('vehicle');
  const [driveParam, setDriveParam] = useUrlString('drive');

  /* ---- push updates ----
   * Polling bounds staleness at the interval; SSE collapses it to the
   * coalescing window so a gear change or a throttle stab shows up almost
   * immediately instead of up to 5s later. */
  useSignalQueryInvalidation({
    vehicleId: vehicleId ?? undefined,
    bindings: [
      { fields: MOTOR_SIGNAL_FIELDS, queryKey: ['motor-latest', vehicleIdNum] },
      { fields: DRIVE_DYNAMICS_SIGNAL_FIELDS, queryKey: ['drive-dynamics-latest', vehicleIdNum] },
      { fields: CRUISE_SIGNAL_FIELDS, queryKey: ['signal-observations', vehicleId ?? undefined] },
    ],
  });

  /* ---- settings ---- */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  // Stable SI→display converters so the memoized derives inside child
  // sections (e.g. DriveAnalyticsSection's speed/accel useMemos) don't
  // recompute on every live poll — they only change when the user
  // actually flips a unit preference.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distanceUnit),
    [distanceUnit],
  );
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, speedUnit),
    [speedUnit],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );

  /* ---- shared date filter for selection and deeper range analytics ---- */
  const { start: startDate, end: endDate, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'driving-dynamics.range',
    timezone,
  });

  const rangeDrivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: 1000,
    refetchInterval: INTERVALS.STANDARD,
  });
  const latestDrivesQuery = useDrives(vehicleIdStr, {
    limit: 5,
    refetchInterval: INTERVALS.STANDARD,
  });

  const filteredDrives = useMemo(() => {
    // The server owns timezone-aware, instant-bounded range filtering.
    // Comparing the UTC date slice again drops trips near local midnight.
    const inRange = rangeDrivesQuery.data ?? [];
    return mergeOpenDrives(inRange, latestDrivesQuery.data ?? []);
  }, [rangeDrivesQuery.data, latestDrivesQuery.data]);

  const selectedDrive = useMemo(
    () => pickDynamicsDrive(filteredDrives, driveParam),
    [filteredDrives, driveParam],
  );
  const selectedDriveId = selectedDrive ? String(selectedDrive.id) : '';

  const historyQuery = useMemo<MotorHistoryQuery>(() => {
    if (!selectedDrive) return { enabled: false };
    const window = motorWindowForDrive(selectedDrive);
    if (!window) return { enabled: false };
    return {
      ...window,
      enabled: true,
      refetchInterval: isOpenDrive(selectedDrive) ? INTERVALS.STANDARD : false,
    };
  }, [selectedDrive]);

  /* ================================================================ */
  /* Ride first → sampled evidence → current vehicle → wider context. */
  /* Every group stays visible when one independent source is absent. */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.review.subtitle', 'Understand one ride: energy outcome, powertrain evidence, and the signals behind it.')}
      query={rangeDrivesQuery}
      busy={rangeDrivesQuery.isLoading}
    >
      <div className="min-w-0 space-y-8 sm:space-y-10">
        <section aria-label={t('dynamics.section.trip', 'Trip review')} className="space-y-4">
          <DynamicsTripToolbar
            startDate={startDate}
            endDate={endDate}
            drives={filteredDrives}
            selectedDriveId={selectedDriveId}
            onSelectDrive={(id) => setDriveParam(id)}
          />
          {rangeDrivesQuery.isLoading ? (
            <Skeleton className="h-12" />
          ) : rangeDrivesQuery.isError ? (
            <QueryError error={rangeDrivesQuery.error} onRetry={() => void rangeDrivesQuery.refetch()} />
          ) : null}
          {latestDrivesQuery.isError ? (
            <QueryError error={latestDrivesQuery.error} onRetry={() => void latestDrivesQuery.refetch()} />
          ) : null}
          <FadeIn>
            <RideOverview drive={selectedDrive} />
          </FadeIn>
          <FadeIn delay={0.05}>
            <PowertrainSummary vehicleId={vehicleId} historyQuery={historyQuery} />
          </FadeIn>
        </section>

        {/* Selected ride: sample-level measurements, then detailed traces. */}
        <section aria-labelledby="dynamics-evidence-heading" className="min-w-0 space-y-4 sm:space-y-5">
          <div className="space-y-2">
            <SectionTitle id="dynamics-evidence-heading">
              {t('dynamics.review.evidence', 'Inside this ride')}
            </SectionTitle>
            <Text as="p" variant="bodySm" color="secondary">
              {t('dynamics.review.evidenceDescription', 'Power delivery, recovered power, axle load, and temperature — sampled only within the selected trip window.')}
            </Text>
          </div>
          <SummaryStats
            vehicleId={vehicleId}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
            historyQuery={historyQuery}
          />
          <MotorEfficiencyInsights
            vehicleId={vehicleId}
            historyQuery={historyQuery}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
          />
          <MotorHistoryCharts
            vehicleId={vehicleId}
            toSpeedDisplay={toSpeedDisplay}
            speedUnit={speedUnit}
            historyQuery={historyQuery}
          />
          <DrivingTips vehicleId={vehicleId} historyQuery={historyQuery} />
        </section>

        {/* Current state is deliberately below the historical ride review.
         * These subscriptions keep polling/SSE behaviour, but never fill gaps
         * in the trip summary with unrelated parked readings. */}
        <section aria-labelledby="dynamics-live-heading" className="min-w-0 space-y-4 sm:space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle id="dynamics-live-heading">
                {t('dynamics.review.live', 'Vehicle now')}
              </SectionTitle>
              <Badge variant="info" size="sm">{t('dynamics.review.liveBadge', 'Current signals · not trip history')}</Badge>
            </div>
            <Text as="p" variant="bodySm" color="secondary">
              {t('dynamics.review.liveDescription', 'Latest reported motor, pedal, G-force, gear, and cruise state for this vehicle. These readings may be parked or older than now and do not describe the selected ride.')}
            </Text>
          </div>
          <FadeIn delay={0.05}>
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
              <LiveMotorStatus
                vehicleId={vehicleId}
                toTemperatureDisplay={toTemperatureDisplay}
                tempUnit={tempUnit}
              />
              <PedalUsage vehicleId={vehicleId} />
            </div>
          </FadeIn>
          <GrokDynamicsBriefing vehicleId={vehicleId} />
          <FadeIn delay={0.1}>
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 3xl:grid-cols-3 xl:gap-5">
              <SpeedGearPanel
                vehicleId={vehicleId}
                filteredDrives={filteredDrives}
                toSpeedDisplay={toSpeedDisplay}
                speedUnit={speedUnit}
              />
              <GForcePanel vehicleId={vehicleId} />
              <AutopilotSection vehicleId={vehicleId} />
            </div>
          </FadeIn>
        </section>

        {/* Wider context retains every coach/analytics function except the
         * redundant per-drive scores list (still available to other callers). */}
        <section aria-labelledby="dynamics-context-heading" className="min-w-0 space-y-5 sm:space-y-6">
          <div className="space-y-2">
            <SectionTitle id="dynamics-context-heading">
              {t('dynamics.review.context', 'Beyond this ride')}
            </SectionTitle>
            <Text as="p" variant="bodySm" color="secondary">
              {t('dynamics.review.contextDescription', 'Vehicle coaching covers the last 30 days. Speed and power analytics cover loaded trips in the selected date range, plus any current drive. Neither is a score for this ride.')}
            </Text>
          </div>
          <DrivingCoachSection vehicleId={vehicleIdStr} showPerDriveScores={false} />
          <div className="space-y-4 sm:space-y-5">
            <SectionTitle>
              {t('dynamics.review.rangeAnalytics', 'Date-range trip context')}
            </SectionTitle>
            <DriveAnalyticsSection
              filteredDrives={filteredDrives}
              toDistanceDisplay={toDistanceDisplay}
              toSpeedDisplay={toSpeedDisplay}
              distanceUnit={distanceUnit}
              speedUnit={speedUnit}
            />
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
