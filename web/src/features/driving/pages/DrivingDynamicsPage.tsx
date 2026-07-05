import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';

import { useDrives, useDrivingCoach } from '@/api/hooks/useDriving';
import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { computeMotorStats, getThrottleStyle } from '../components/driving-dynamics/helpers';
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

export default function DrivingDynamicsPage() {
  const { t } = useTranslation();
  usePageTitle(t('dynamics.title', 'Driving Dynamics'));

  /* ---- vehicle selection ---- */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- data hooks ---- */
  const vehicleIdNum = vehicleId ?? 0;
  // Keep the whole query object so PageContainer can render the freshness
  // chip for the live motor stream (5s poll) in the header.
  const motorLatestQuery = useMotorLatest(vehicleIdNum, 5000);
  const motorLatest = motorLatestQuery.data;
  const { data: motorHistory } = useMotorHistory(vehicleIdNum, 200);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: coachData } = useDrivingCoach(vehicleIdStr);

  /* ---- settings ---- */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  // Stable SI→display converters so the memoized derives inside child
  // sections (e.g. DriveAnalyticsSection's speed/accel useMemos) don't
  // recompute on every 5s live-motor poll — they only change when the
  // user actually flips a unit preference.
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

  /* ---- motor stats (cross-section) ---- */
  const motorStats = useMemo(() => computeMotorStats(motorHistory), [motorHistory]);
  const throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null;

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
            motorStats={motorStats}
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
              motorLatest={motorLatest}
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
              motorLatest={motorLatest}
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
            motorStats={motorStats}
            throttleStyle={throttleStyle}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
          />
        </section>

        {/* 5 — Motor telemetry history charts (reflow to more columns) */}
        <section aria-label={t('dynamics.section.history', 'Motor history')}>
          <MotorHistoryCharts
            motorHistory={motorHistory}
            toSpeedDisplay={toSpeedDisplay}
            speedUnit={speedUnit}
          />
        </section>

        {/* 6 — Driving coach (score, style, trend, patterns, per-drive) */}
        <section aria-label={t('dynamics.coach.title', 'Driving Coach')}>
          <DrivingCoachSection coachData={coachData} />
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
            <DrivingTips motorStats={motorStats} />
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
