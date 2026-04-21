import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Cpu, BatteryCharging } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Select } from '@/components/ui';
import { EmptyState } from '@/components/feedback';

import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useVehicles, useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
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
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(-30)
      .map((d) => ({
        date: formatDateShort(d.startDate),
        powerMax: d.powerMax ?? 0,
        powerMin: d.powerMin ?? 0,
        outsideTemp: d.outsideTempAvg ?? null,
        distance: d.distance,
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
      time: s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      stator: s.di_stator_temp != null ? convertTemp(s.di_stator_temp) : null,
      torque: s.di_torque ?? null,
      speed: s.vehicle_speed != null ? convertSpeed(s.vehicle_speed) : null,
      axle: s.di_axle_speed ?? null,
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
          {motorLatest && <LiveMotorStatus motorLatest={motorLatest} />}
          <StatorTempChart data={motorChartData} />
          <TorqueHistoryChart data={motorChartData} />
          <TemperatureTrendChart data={tempTrendData} />
          <PowerOutputChart data={chartData} />
          <HealthRecommendations overallHealth={overallHealth} />
          <DetailCards health={health} peakPower={peakPower} avgPowerMax={avgPowerMax} minRegenPower={minRegenPower} stats={stats} />
        </>
      ) : (
        <EmptyState message={t('drivetrain.noData', 'No drivetrain health data available yet')} />
      )}
    </PageContainer>
  );
}
