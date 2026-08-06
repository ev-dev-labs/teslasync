import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';

import { useDrives } from '@/api/hooks/useDriving';
import { useMotorLatest } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignalQueryInvalidation } from '@/hooks/useSignalQueryInvalidation';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { INTERVALS } from '@/lib/constants';
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
} from '../components/driving-dynamics';

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
   * Every panel now owns the query it renders, at a cadence matched to how
   * fast that data actually moves (live motor 5s, aggregate history 10s,
   * drives 30s, coach 5m). Only two things stay here: the drives list, which
   * the page-level date filter narrows for two different panels, and the
   * live-motor query, which PageContainer needs for the header freshness
   * chip. TanStack dedupes on the query key, so re-declaring the live-motor
   * subscription here shares the panels' cache entry rather than doubling
   * the request rate. */
  const motorLatestQuery = useMotorLatest(vehicleIdNum, INTERVALS.REALTIME);
  const { data: drives } = useDrives(vehicleIdStr, INTERVALS.STANDARD);

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

  /* ---- date filter (page-scoped: used by SpeedGear + DriveAnalytics) ---- */
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  /* ---- filtered drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter((d) => {
      const driveDate = d.startTs?.slice(0, 10) ?? '';
      return driveDate >= startDate && driveDate <= endDate;
    });
  }, [drives, startDate, endDate]);

  /* ================================================================ */
  /*  RENDER — full-width responsive bento                             */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.subtitle', 'Live motor telemetry, G-forces & driving analysis')}
      actions={<VehicleSelect />}
      query={motorLatestQuery}
    >
      <div className="space-y-6">
        {/* 1 — KPI band: full-width motor summary metrics */}
        <section aria-label={t('dynamics.section.summary', 'Motor summary metrics')}>
          <SummaryStats
            vehicleId={vehicleId}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
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

        {/* 3 — Driving inputs: speed/gear, g-force, autopilot */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('dynamics.section.inputs', 'Driving inputs')}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5"
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
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            toDistanceDisplay={toDistanceDisplay}
            toSpeedDisplay={toSpeedDisplay}
            distanceUnit={distanceUnit}
            speedUnit={speedUnit}
          />
        </section>

        {/* 8 — Driving style recommendations */}
        <FadeIn delay={0.15}>
          <section aria-label={t('dynamics.recommendations', 'Driving Style Recommendations')}>
            <DrivingTips vehicleId={vehicleId} />
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
