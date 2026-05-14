import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Cpu, BatteryCharging } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { VehicleSelect, RangePicker } from '@/components/forms';

import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUrlString, useUrlBatch } from '@/hooks/useUrlState';
import { convertDistanceFromSI, convertTempFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

import {
  HEALTH_SCORE,
  type TempSensor,
  type ChartDataPoint,
  type MotorChartDataPoint,
} from '../components/drivetrain-health/constants';
import {
  HealthOverview,
  HealthGaugeGrid,
  TemperatureGauges,
  TemperatureMetricCards,
  ThermalLoadPanel,
  LiveMotorStatus,
  StatorTempChart,
  TorqueHistoryChart,
  TemperatureTrendChart,
  PowerOutputChart,
  HealthRecommendations,
  DetailCards,
} from '../components/drivetrain-health';

export default function DrivetrainHealthPage() {
  const { t } = useTranslation();
  const { formatTime, formatDateShort } = useDateFormat();
  usePageTitle(t('drivetrain.title', 'Drivetrain Health'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  const { data: health, isLoading: healthLoading } = useDrivetrainHealth(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: stats } = useDrivingStats(vehicleIdStr);
  const { data: motorLatest } = useMotorLatest(vehicleId ?? 0, 5_000);
  const { data: motorHistory } = useMotorHistory(vehicleId ?? 0, 200);
  const { state: liveState } = useVehicleLive(vehicleId ?? undefined);

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const overallHealth = health?.overallHealth ?? 'good';
  const healthScore = HEALTH_SCORE[overallHealth];

  const sensors: TempSensor[] = useMemo(() => {
    if (!health) return [];
    return [
      { key: 'frontMotor', labelKey: 'drivetrain.frontMotor', defaultLabel: 'Front Motor', value: health.frontMotorTempC, maxTemp: 150, color: '#06b6d4', icon: <Zap className="h-4 w-4" /> },
      { key: 'rearMotor', labelKey: 'drivetrain.rearMotor', defaultLabel: 'Rear Motor', value: health.rearMotorTempC, maxTemp: 150, color: '#8b5cf6', icon: <Zap className="h-4 w-4" /> },
      { key: 'inverter', labelKey: 'drivetrain.inverter', defaultLabel: 'Inverter', value: health.inverterTempC, maxTemp: 120, color: '#f59e0b', icon: <Cpu className="h-4 w-4" /> },
      { key: 'battery', labelKey: 'drivetrain.battery', defaultLabel: 'Battery', value: health.batteryTempC, maxTemp: 60, color: '#10b981', icon: <BatteryCharging className="h-4 w-4" /> },
    ];
  }, [health]);

  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!drives?.length) return [];
    // Filter drives to selected date range; chart shows the resulting series
    // (capped at 30 points so the trend stays readable on small viewports).
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${endDate}T23:59:59`).getTime();
    return drives
      .filter((d) => {
        const t = new Date(d.startTs).getTime();
        return Number.isFinite(t) && t >= startMs && t <= endMs;
      })
      .slice()
      .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime())
      .slice(-30)
      .map((d) => ({
        date: formatDateShort(d.startTs),
        powerMax: (d.avgPowerW ?? 0) / 1000,
        powerMin: 0,
        outsideTemp: d.outsideTempAvgC ?? null,
        distance: toDistanceDisplay(d.distanceM),
      }));
  }, [drives, startDate, endDate, toDistanceDisplay, formatDateShort]);

  const tempTrendData = useMemo(() => chartData.filter((d) => d.outsideTemp !== null), [chartData]);

  const avgPowerMax = useMemo(() => {
    if (!chartData.length) return 0;
    return chartData.reduce((acc, d) => acc + d.powerMax, 0) / chartData.length;
  }, [chartData]);

  const peakPower = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.max(...chartData.map((d) => d.powerMax));
  }, [chartData]);

  const minRegenPower = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.min(...chartData.map((d) => d.powerMin));
  }, [chartData]);

  const motorChartData: MotorChartDataPoint[] = useMemo(() => {
    const history = motorHistory ?? [];
    if (history.length === 0) return [];
    return history.map((s) => ({
      time: s.ts ? formatTime(s.ts) : '',
      stator: s.motor_temp_c_front != null ? toTemperatureDisplay(s.motor_temp_c_front) : null,
      statorRel: s.motor_temp_c_rear != null ? toTemperatureDisplay(s.motor_temp_c_rear) : null,
      statorRer: s.inverter_temp_c != null ? toTemperatureDisplay(s.inverter_temp_c) : null,
      torque: s.torque_nm_front ?? s.torque_nm_rear ?? null,
      speed: null, // no direct power signal in motor pivot; field unused by charts
      axle: s.motor_rpm_front ?? s.motor_rpm_rear ?? null,
    }));
  }, [motorHistory, toTemperatureDisplay, toSpeedDisplay, formatTime]);

  return (
    <PageContainer
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
      loading={healthLoading}
      error={null}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
            align="end"
            triggerTestId="drivetrain-health-range-picker"
          />
        </div>
      }
    >
      {health ? (
        <>
          <HealthOverview overallHealth={overallHealth} healthScore={healthScore} motorStatus={health.motorStatus} />
          <HealthGaugeGrid overallHealth={overallHealth} healthScore={healthScore} motorStatus={health.motorStatus} sensors={sensors} stats={stats} />
          <TemperatureGauges sensors={sensors} />
          <TemperatureMetricCards sensors={sensors} overallHealth={overallHealth} healthScore={healthScore} peakPower={peakPower} />
          <ThermalLoadPanel sensors={sensors} peakPower={peakPower} avgPowerMax={avgPowerMax} stats={stats} />
          {motorLatest && <LiveMotorStatus motorLatest={motorLatest} isolationResistance={liveState.isolationResistance} />}
          <StatorTempChart data={motorChartData} />
          <TorqueHistoryChart data={motorChartData} />
          <TemperatureTrendChart data={tempTrendData} />
          <PowerOutputChart data={chartData} />
          <HealthRecommendations overallHealth={overallHealth} />
          <DetailCards health={health} peakPower={peakPower} avgPowerMax={avgPowerMax} minRegenPower={minRegenPower} stats={stats} />
        </>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('drivetrain.noData', 'No drivetrain health data available yet')} />
      )}
    </PageContainer>
  );
}
