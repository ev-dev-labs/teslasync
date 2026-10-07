import { useTranslation } from 'react-i18next';
import { Activity, Zap, TrendingUp, Shield } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricBar, InlineMetric } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

import type { TempSensor } from './constants';
import { tempSeverityColor, displayTemp } from './helpers';
import type { DrivingStats } from '@/types/driving';

interface ThermalLoadPanelProps {
  sensors: TempSensor[];
  peakPower: number;
  avgPowerMax: number;
  stats: DrivingStats | undefined;
  loading?: boolean;
}

export function ThermalLoadPanel({
  sensors,
  peakPower,
  avgPowerMax,
  stats,
  loading = false,
}: ThermalLoadPanelProps) {
  const { t } = useTranslation();
  const { formatTemperature: formatTemperatureUnit } = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision });

  // Null-safe: the prop is typed as an array, but a transient render (before
  // the parent's derived memo resolves, or a partial API response) can hand us
  // `undefined`. Guard once so `.length`/`.map` below never throw — matching
  // the sibling HealthGaugeGrid contract for the same `sensors` source.
  const sensorList = sensors ?? [];

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}
        </PanelTitle>
        {loading ? (
          <Skeleton height={200} />
        ) : sensorList.length === 0 ? (
          <EmptyState /* no-action: transient — awaiting first thermal telemetry */
            message={t('drivetrain.noSensors', 'No temperature sensor data available yet')}
          />
        ) : (
          <>
            <div className="space-y-4">
              {sensorList.map((sensor) => (
                <MetricBar
                  key={sensor.key}
                  label={t(sensor.labelKey, sensor.defaultLabel)}
                  value={sensor.value ?? 0}
                  max={sensor.maxTemp}
                  color={tempSeverityColor(sensor.value, sensor.maxTemp)}
                  sublabel={displayTemp(sensor.value, formatTemperature)}
                />
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InlineMetric
                icon={<Zap className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                label={t('drivetrain.peakPower', 'Peak Power')}
                value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'}
              />
              <InlineMetric
                icon={<TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                label={t('drivetrain.avgPower', 'Avg Power')}
                value={avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'}
              />
              <InlineMetric
                icon={<Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
                label={t('drivetrain.drivesLabel', 'Drives')}
                value={stats ? fmtInt(stats.totalDrives) : '—'}
              />
              <InlineMetric
                icon={<Shield className="h-4 w-4 text-amber-300" aria-hidden="true" />}
                label={t('drivetrain.regenRatio', 'Regen Ratio')}
                value={stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '—'}
              />
            </div>
          </>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
