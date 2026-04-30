import { useTranslation } from 'react-i18next';
import { Activity, Zap, TrendingUp, Shield } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { MetricBar, InlineMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { TempSensor } from './constants';
import { tempSeverityColor, displayTemp } from './helpers';
import type { DrivingStats } from '@/types/driving';

interface ThermalLoadPanelProps {
  sensors: TempSensor[];
  peakPower: number;
  avgPowerMax: number;
  stats: DrivingStats | undefined;
}

export function ThermalLoadPanel({
  sensors,
  peakPower,
  avgPowerMax,
  stats,
}: ThermalLoadPanelProps) {
  const { t } = useTranslation();
  const { fmtTemp } = useSettings();

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="p-6">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <Activity className="mr-2 inline-block h-4 w-4" />
          {t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}
        </h3>
        <div className="space-y-4">
          {sensors.map((sensor) => (
            <MetricBar
              key={sensor.key}
              label={t(sensor.labelKey, sensor.defaultLabel)}
              value={sensor.value ?? 0}
              max={sensor.maxTemp}
              color={tempSeverityColor(sensor.value, sensor.maxTemp)}
              sublabel={displayTemp(sensor.value, fmtTemp)}
            />
          ))}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InlineMetric
            icon={<Zap className="h-4 w-4 text-purple-400" />}
            label={t('drivetrain.peakPower', 'Peak Power')}
            value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'}
          />
          <InlineMetric
            icon={<TrendingUp className="h-4 w-4 text-cyan-400" />}
            label={t('drivetrain.avgPower', 'Avg Power')}
            value={avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'}
          />
          <InlineMetric
            icon={<Activity className="h-4 w-4 text-green-400" />}
            label={t('drivetrain.drivesLabel', 'Drives')}
            value={stats ? fmtInt(stats.totalDrives) : '—'}
          />
          <InlineMetric
            icon={<Shield className="h-4 w-4 text-amber-400" />}
            label={t('drivetrain.regenRatio', 'Regen Ratio')}
            value={stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '—'}
          />
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
