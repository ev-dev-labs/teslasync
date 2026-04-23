import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { Select } from '@/components/ui';

import { useDrives, useDrivingCoach } from '@/api/hooks/useDriving';
import { useVehicles, useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
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
  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name ?? `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  /* ---- data hooks ---- */
  const vehicleIdNum = vehicleId ?? 0;
  const { data: motorLatest, isLoading: motorLoading } = useMotorLatest(vehicleIdNum, 5000);
  const { data: motorHistory } = useMotorHistory(vehicleIdNum, 200);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: coachData } = useDrivingCoach(vehicleIdStr);

  /* ---- settings ---- */
  const {
    convertDistance,
    convertSpeed,
    convertTemp,
    distanceUnit,
    speedUnit,
    tempUnit,
  } = useSettings();

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
      const driveDate = d.startDate?.slice(0, 10) ?? '';
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
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
            onChange={(e) => setSelectedVehicle(Number(e.target.value))}
            placeholder={t('dynamics.selectVehicle', 'Select vehicle')}
          />
        ) : undefined
      }
    >
      <div className="space-y-6">
        <LiveMotorStatus motorLatest={motorLatest} convertTemp={convertTemp} tempUnit={tempUnit} />
        <GForcePanel vehicleId={vehicleId} />
        <PedalUsage vehicleId={vehicleId} />
        <SpeedGearPanel
          motorLatest={motorLatest}
          filteredDrives={filteredDrives}
          convertSpeed={convertSpeed}
          speedUnit={speedUnit}
        />
        <AutopilotSection vehicleId={vehicleId} />
        <MotorHistoryCharts motorHistory={motorHistory} convertSpeed={convertSpeed} speedUnit={speedUnit} />
        <MotorEfficiencyInsights
          motorStats={motorStats}
          throttleStyle={throttleStyle}
          convertTemp={convertTemp}
          tempUnit={tempUnit}
        />
        <SummaryStats motorStats={motorStats} convertTemp={convertTemp} tempUnit={tempUnit} />
        <DrivingCoachSection coachData={coachData} />
        <DriveAnalyticsSection
          filteredDrives={filteredDrives}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          convertDistance={convertDistance}
          convertSpeed={convertSpeed}
          distanceUnit={distanceUnit}
          speedUnit={speedUnit}
        />
        <DrivingTips motorStats={motorStats} throttleStyle={throttleStyle} />
      </div>
    </PageContainer>
  );
}
