import { useTranslation } from 'react-i18next';
import { Activity, Flame, Thermometer, ThermometerSnowflake, ThermometerSun } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import type { ChargingTelemetry } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { Grid } from '@/components/layout';

export interface HealthThermalPanelProps {
  state: DataState<ChargingTelemetry | null>;
  loading: boolean;
  retry: () => void;
  formatNumber: (value: number) => string;
  toTemperatureDisplay: (value: number) => number;
  tempUnit: string;
}

/** Latest BMS telemetry is independent of the lifetime health model. Neither a
 * model failure nor a failed telemetry refresh may erase its retained values. */
export function HealthThermalPanel({
  state, loading, retry, formatNumber: fmtNumber, toTemperatureDisplay, tempUnit,
}: HealthThermalPanelProps) {
  const { t } = useTranslation();
  const chargingLive = state.data;
  return (
    <GlassPanel className="min-w-0 h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('battery.thermal.title', 'Thermal Monitoring')}
      </PanelTitle>
      <StaleRefreshWarning state={state} label={t('battery.thermal.title', 'Thermal Monitoring')} />
      {state.fatalError && <QueryError error={state.fatalError} onRetry={retry} />}
      {loading && !state.hasData ? <Skeleton className="h-40 rounded-xl" /> : (
        <Grid minItemWidth="wide" gap={4} className="min-w-0">
          <MetricCard
            label={t('battery.thermal.moduleTempMax', 'Module Temp (Max)')}
            wrapLabel
            value={chargingLive?.module_temp_max != null
              ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_max))} ${tempUnit}` : '—'}
            subtitle={chargingLive?.num_module_temp_max != null
              ? t('battery.thermal.moduleNumber', 'Module #{{n}}', { n: chargingLive.num_module_temp_max }) : undefined}
            icon={<ThermometerSun className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('battery.thermal.moduleTempMin', 'Module Temp (Min)')}
            wrapLabel
            value={chargingLive?.module_temp_min != null
              ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_min))} ${tempUnit}` : '—'}
            subtitle={chargingLive?.num_module_temp_min != null
              ? t('battery.thermal.moduleNumber', 'Module #{{n}}', { n: chargingLive.num_module_temp_min }) : undefined}
            icon={<ThermometerSnowflake className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('battery.thermal.heater', 'Battery Heater')}
            wrapLabel
            value={chargingLive?.battery_heater_on == null ? '—' : chargingLive.battery_heater_on
              ? t('common.on', 'On') : t('common.off', 'Off')}
            icon={<Flame className="h-5 w-5" aria-hidden="true" />}
            color={chargingLive?.battery_heater_on ? 'red' : 'green'}
          />
          <MetricCard
            label={t('battery.thermal.tempSpread', 'Temperature Spread')}
            wrapLabel
            value={chargingLive?.module_temp_max != null && chargingLive?.module_temp_min != null
              ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_max) -
                  toTemperatureDisplay(chargingLive.module_temp_min))} ${tempUnit}` : '—'}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
        </Grid>
      )}
    </GlassPanel>
  );
}
