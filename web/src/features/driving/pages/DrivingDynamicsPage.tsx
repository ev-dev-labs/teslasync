import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';

import { useDrives } from '@/api/hooks/useDriving';
import { useMotorLatest, type MotorHistoryQuery } from '@/api/hooks/useVehicles';
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

  /* ---- page-owned data ----
   * Live cockpit stays on /latest. History panels share one drive-window
   * /motor query. The drives list is server-scoped to the date filter, plus
   * a tiny latest page so an in-progress drive is never dropped. */
  const motorLatestQuery = useMotorLatest(vehicleIdNum, INTERVALS.REALTIME);
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

  /* ---- shared date filter (used by SpeedGear + DriveAnalytics) ---- */
  const {
    start: startDate,
    end: endDate,
    startInstant,
    endInstantExclusive,
    setRange,
  } = useRangeState({
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
    const inRange = (rangeDrivesQuery.data ?? []).filter((d) => {
      const driveDate = d.startTs?.slice(0, 10) ?? '';
      return driveDate >= startDate && driveDate <= endDate;
    });
    return mergeOpenDrives(inRange, latestDrivesQuery.data ?? []);
  }, [rangeDrivesQuery.data, latestDrivesQuery.data, startDate, endDate]);

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
  /*  RENDER — full-width responsive bento                             */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.subtitle', 'Live motor telemetry, G-forces, and Grok’s powertrain read')}
      contextActions={
        <>
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={setRange}
            align="end"
            triggerTestId="driving-dynamics-range"
          />
        </>
      }
      query={motorLatestQuery}
    >
      <div className="space-y-6">
        <section aria-label={t('dynamics.section.trip', 'Trip review')}>
          <DynamicsTripToolbar
            startDate={startDate}
            endDate={endDate}
            drives={filteredDrives}
            selectedDriveId={selectedDriveId}
            onSelectDrive={(id) => setDriveParam(id)}
          />
        </section>

        {/* 1 — KPI band: full-width motor summary metrics */}
        <section aria-label={t('dynamics.section.summary', 'Motor summary metrics')}>
          <SummaryStats
            vehicleId={vehicleId}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
            historyQuery={historyQuery}
          />
        </section>

        {/* 2 — Live cockpit: hero motor gauges beside pedal usage */}
        <FadeIn delay={0.05}>
          <section
            aria-label={t('dynamics.section.live', 'Live cockpit')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5"
          >
            <LiveMotorStatus
              vehicleId={vehicleId}
              toTemperatureDisplay={toTemperatureDisplay}
              tempUnit={tempUnit}
            />
            <PedalUsage vehicleId={vehicleId} />
          </section>
        </FadeIn>

        {/* 2b — Grok: Tesla powertrain briefing from the same live signals */}
        <FadeIn delay={0.07}>
          <section aria-label={t('dynamics.grok.section', "Grok's powertrain read")}>
            <GrokDynamicsBriefing vehicleId={vehicleId} />
          </section>
        </FadeIn>

        {/* 3 — Driving inputs: speed/gear, g-force, autopilot */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('dynamics.section.inputs', 'Driving inputs')}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 3xl:grid-cols-3 xl:gap-5"
          >
            <SpeedGearPanel
              vehicleId={vehicleId}
              filteredDrives={filteredDrives}
              toSpeedDisplay={toSpeedDisplay}
              speedUnit={speedUnit}
            />
            <GForcePanel vehicleId={vehicleId} />
            <AutopilotSection vehicleId={vehicleId} />
          </section>
        </FadeIn>

        {/* 4 — Motor efficiency insights (3-up band) */}
        <section aria-label={t('dynamics.section.efficiency', 'Motor efficiency')}>
          <MotorEfficiencyInsights
            vehicleId={vehicleId}
            historyQuery={historyQuery}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
          />
        </section>

        {/* 5 — Motor telemetry history charts (reflow to more columns) */}
        <section aria-label={t('dynamics.section.history', 'Motor history')}>
          <MotorHistoryCharts
            vehicleId={vehicleId}
            toSpeedDisplay={toSpeedDisplay}
            speedUnit={speedUnit}
            historyQuery={historyQuery}
          />
        </section>

        {/* 6 — Driving coach (score, style, trend, patterns, per-drive) */}
        <section aria-label={t('dynamics.coach.title', 'Driving Coach')}>
          <DrivingCoachSection vehicleId={vehicleIdStr} />
        </section>

        {/* 7 — Drive analytics (range filter + distribution + profile) */}
        <section
          aria-label={t('dynamics.driveAnalytics', 'Drive Analytics')}
          className="space-y-6"
        >
          <DriveAnalyticsSection
            filteredDrives={filteredDrives}
            toDistanceDisplay={toDistanceDisplay}
            toSpeedDisplay={toSpeedDisplay}
            distanceUnit={distanceUnit}
            speedUnit={speedUnit}
          />
        </section>

        {/* 8 — Driving style recommendations */}
        <FadeIn delay={0.15}>
          <section aria-label={t('dynamics.recommendations', 'Driving Style Recommendations')}>
            <DrivingTips vehicleId={vehicleId} historyQuery={historyQuery} />
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
