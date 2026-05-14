import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';

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
  const { data: motorLatest, isLoading: motorLoading } = useMotorLatest(vehicleIdNum, 5000);
  const { data: motorHistory } = useMotorHistory(vehicleIdNum, 200);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: coachData } = useDrivingCoach(vehicleIdStr);

  /* ---- settings ---- */
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

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
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.subtitle', 'Live motor telemetry, G-forces & driving analysis')}
      loading={motorLoading}
      error={null}
      actions={<VehicleSelect />}
    >
      <div className="space-y-6">
        <LiveMotorStatus motorLatest={motorLatest} toTemperatureDisplay={toTemperatureDisplay} tempUnit={tempUnit} />
        <GForcePanel vehicleId={vehicleId} />
        <PedalUsage vehicleId={vehicleId} />
        <SpeedGearPanel
          motorLatest={motorLatest}
          filteredDrives={filteredDrives}
          toSpeedDisplay={toSpeedDisplay}
          speedUnit={speedUnit}
        />
        <AutopilotSection vehicleId={vehicleId} />
        <MotorHistoryCharts motorHistory={motorHistory} toSpeedDisplay={toSpeedDisplay} speedUnit={speedUnit} />
        <MotorEfficiencyInsights
          motorStats={motorStats}
          throttleStyle={throttleStyle}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />
        <SummaryStats motorStats={motorStats} toTemperatureDisplay={toTemperatureDisplay} tempUnit={tempUnit} />
        <DrivingCoachSection coachData={coachData} />
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
        <DrivingTips motorStats={motorStats} throttleStyle={throttleStyle} />
      </div>
    </PageContainer>
  );
}
