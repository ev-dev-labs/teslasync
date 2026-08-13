import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Cpu, BatteryCharging } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect, RangePicker } from '@/components/forms';

import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

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

  const { start: startDate, end: endDate, setRange } = useRangeState({
    persistKey: 'drivetrain-health.range',
  });

  const healthQuery = useDrivetrainHealth(vehicleIdStr);
  const {
    data: health,
    isLoading: healthLoading,
    isError: healthIsError,
    error: healthError,
    refetch: refetchHealth,
  } = healthQuery;
  const { data: drives, isLoading: drivesLoading } = useDrives(vehicleIdStr);
  const { data: stats, isLoading: statsLoading } = useDrivingStats(vehicleIdStr);
  const { data: motorLatest, isLoading: motorLatestLoading } = useMotorLatest(vehicleId ?? 0, 5_000);
  const { data: motorHistory, isLoading: motorHistoryLoading } = useMotorHistory(vehicleId ?? 0, 200);
  const { state: liveState } = useVehicleLive(vehicleId ?? undefined);

  const { unitPrefs } = useUnits();
  // Memoise the SI→display converters on the specific unit preference they
  // depend on. Fresh closures every render would give the derived-series
  // useMemo()s below (chartData / motorChartData) a new dependency identity on
  // each pass, silently defeating their memoisation and re-running the
  // filter/sort/map work on unrelated re-renders.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const hasHealth = health != null;
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
        distance: toDistanceDisplay(d.distanceM ?? 0),
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
  }, [motorHistory, toTemperatureDisplay, formatTime]);

  return (
    <PageContainer
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
      query={healthQuery}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={setRange}
            align="end"
            triggerTestId="drivetrain-health-range-picker"
          />
        </div>
      }
    >
      {/* 1 — Hero: overall drivetrain health status (alert + panel) */}
      <HealthOverview
        overallHealth={overallHealth}
        healthScore={healthScore}
        motorStatus={health?.motorStatus ?? ''}
        hasData={hasHealth}
        loading={healthLoading}
        error={healthIsError ? healthError : undefined}
        onRetry={refetchHealth}
      />

      {/* 2 — KPI band: temperature + health + peak-power metric cards */}
      <TemperatureMetricCards
        sensors={sensors}
        overallHealth={overallHealth}
        healthScore={healthScore}
        peakPower={peakPower}
        loading={healthLoading}
      />

      {/* 3 — Health score gauge + motor details + drive statistics */}
      <HealthGaugeGrid
        overallHealth={overallHealth}
        healthScore={healthScore}
        motorStatus={health?.motorStatus ?? '—'}
        sensors={sensors}
        stats={stats}
        hasHealth={hasHealth}
        loading={healthLoading}
        statsLoading={statsLoading}
      />

      {/* 4 — Thermal bento: gauges + load indicators side-by-side on wide screens */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
        <TemperatureGauges sensors={sensors} loading={healthLoading} />
        <ThermalLoadPanel
          sensors={sensors}
          peakPower={peakPower}
          avgPowerMax={avgPowerMax}
          stats={stats}
          loading={healthLoading}
        />
      </section>

      {/* 5 — Live motor telemetry band (full width) */}
      <LiveMotorStatus
        motorLatest={motorLatest}
        isolationResistance={liveState.isolationResistance}
        loading={motorLatestLoading}
      />

      {/* 6 — Charts bento: two per row on wide screens, stacked on mobile */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
        <StatorTempChart data={motorChartData} loading={motorHistoryLoading} />
        <TorqueHistoryChart data={motorChartData} loading={motorHistoryLoading} />
        <TemperatureTrendChart data={tempTrendData} loading={drivesLoading} />
        <PowerOutputChart data={chartData} loading={drivesLoading} />
      </section>

      {/* 7 — Detail band: temperature/power details + health recommendations */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <div className="xl:col-span-2">
          <DetailCards
            health={health}
            peakPower={peakPower}
            avgPowerMax={avgPowerMax}
            minRegenPower={minRegenPower}
            stats={stats}
            loading={healthLoading}
          />
        </div>
        <div className="xl:col-span-1">
          <HealthRecommendations overallHealth={overallHealth} />
        </div>
      </section>
    </PageContainer>
  );
}
