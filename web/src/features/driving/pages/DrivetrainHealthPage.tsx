import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Cpu, BatteryCharging } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Select } from '@/components/ui';
import { EmptyState } from '@/components/feedback';

import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useVehicles, useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';

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
  usePageTitle(t('drivetrain.title', 'Drivetrain Health'));

  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  const { data: vehicles } = useVehicles();
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { data: health, isLoading: healthLoading } = useDrivetrainHealth(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: stats } = useDrivingStats(vehicleIdStr);
  const { data: motorLatest } = useMotorLatest(vehicleId ?? 0, 5_000);
  const { data: motorHistory } = useMotorHistory(vehicleId ?? 0, 200);
  const { state: liveState } = useVehicleLive(vehicleId ?? undefined);

  const { convertTemp, convertSpeed } = useSettings();

  const vehicleOptions = useMemo(() => {
    if (!vehicles?.length) return [];
    return vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }));
  }, [vehicles]);

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
    return drives
      .slice()
      .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime())
      .slice(-30)
      .map((d) => ({
        date: formatDateShort(d.startTs),
        powerMax: (d.avgPowerW ?? 0) / 1000,
        powerMin: 0,
        outsideTemp: d.outsideTempAvgC ?? null,
        distance: d.distanceM / 1609.344,
      }));
  }, [drives]);

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
      time: s.ts ? new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      stator: s.motor_temp_c_front != null ? convertTemp(s.motor_temp_c_front) : null,
      statorRel: s.motor_temp_c_rear != null ? convertTemp(s.motor_temp_c_rear) : null,
      statorRer: s.inverter_temp_c != null ? convertTemp(s.inverter_temp_c) : null,
      torque: s.torque_nm_front ?? s.torque_nm_rear ?? null,
      speed: null, // no direct power signal in motor pivot; field unused by charts
      axle: s.motor_rpm_front ?? s.motor_rpm_rear ?? null,
    }));
  }, [motorHistory, convertTemp, convertSpeed]);

  return (
    <PageContainer
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
      loading={healthLoading}
      error={null}
      actions={
        vehicleOptions.length > 0 ? (
          <Select
            value={String(vehicleId ?? '')}
            onChange={(e) => setSelectedVehicle(e.target.value ? Number(e.target.value) : null)}
            options={[
              { value: '', label: t('drivetrain.allVehicles', 'All Vehicles') },
              ...vehicleOptions,
            ]}
          />
        ) : undefined
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
