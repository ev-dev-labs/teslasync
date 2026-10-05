import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import { LinearGauge } from '@/components/charts';
import { StatGroup } from '@/components/data-display/stat-reference';
import { KVList } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import type { DrivingStats } from '@/types/driving';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { SourceBoundary } from './SourceBoundary';
import { finite, temperatureBand, type Sensor, type PowerSummary } from './model';

interface Props {
  sensors: readonly Sensor[];
  power: PowerSummary;
  stats?: DrivingStats;
  healthState: DataState<unknown>;
  statsState: DataState<unknown>;
  drivesState: DataState<unknown>;
  loading: boolean;
}

export function ThermalPanels({ sensors, power, stats, healthState, statsState, drivesState, loading }: Props) {
  const { t } = useTranslation();
  const { formatTemperature, unitPrefs } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const preferences = { units: unitPrefs, currency: { kind: 'symbol' as const, value: '$' } };
  const noSensors = t('drivetrain.noSensors', 'No temperature sensor data available yet');
  const period = { kind: 'snapshot' as const, label: t('drivetrain.modernization.snapshot', 'Latest health response'), observedAt: healthState.updatedAt ? new Date(healthState.updatedAt).toISOString() : null };
  // The linear interval fraction is equivalent to the old converted 0°C→ceiling
  // gauge. A percentage axis avoids a second display-unit conversion engine.
  return <CardGrid label={t('drivetrain.modernization.thermalPanels', 'Thermal gauges and load indicators')} items={[
    { id: 'temperature-gauges', size: 'half', content: <LayoutCard title={t('drivetrain.tempGauges', 'Temperature Gauges')}>
      <SourceBoundary state={healthState} label={t('drivetrain.tempGauges', 'Temperature Gauges')}
        loading={loading} empty={!healthState.data} emptyMessage={noSensors}>
        <div className="grid min-w-0 grid-cols-1 gap-4 @sm:grid-cols-2">
          {sensors.map(sensor => {
            const band = temperatureBand(sensor.value, sensor.maxTemp);
            return <div key={sensor.key} className="min-w-0 space-y-2">
              <LinearGauge label={t(sensor.labelKey, sensor.label)}
                value={sensor.value == null ? null : sensor.value / sensor.maxTemp * 100}
                min={0} max={100} unit="%" status={t(`drivetrain.modernization.band.${band}`, band)}
                tone={band === 'unknown' ? 'neutral' : band === 'critical' ? 'danger' : band === 'warning' ? 'warning' : 'success'} />
              <Text as="p" variant="bodySm">
                {formatTemperature(sensor.value)} · {t('drivetrain.ofMax', 'of max')} {formatTemperature(sensor.maxTemp)}
              </Text>
              <Text as="p" variant="bodySm">
                {t('drivetrain.modernization.gaugeScale', 'Gauge scale: {{minimum}} to {{maximum}}', { minimum: formatTemperature(0), maximum: formatTemperature(sensor.maxTemp) })}
              </Text>
            </div>;
          })}
        </div>
      </SourceBoundary>
    </LayoutCard> },
    { id: 'thermal-load', size: 'half', content: <LayoutCard title={t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}>
      <SourceBoundary state={healthState} label={t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}
        loading={loading} empty={!healthState.data} emptyMessage={noSensors}>
        <div className="space-y-4">
          {sensors.map(sensor => {
            const band = temperatureBand(sensor.value, sensor.maxTemp);
            return <div key={sensor.key} className="min-w-0">
              <LinearGauge label={t(sensor.labelKey, sensor.label)}
                value={sensor.value == null ? null : sensor.value / sensor.maxTemp * 100} max={100} unit="%"
                tone={band === 'unknown' ? 'neutral' : band === 'critical' ? 'danger' : band === 'warning' ? 'warning' : 'success'}
                status={t(`drivetrain.modernization.band.${band}`, band)} />
              <Text as="p" variant="bodySm">{formatTemperature(sensor.value)}</Text>
            </div>;
          })}
        </div>
        <Text as="p" variant="bodySm">
          {t(
            'drivetrain.modernization.gaugePolicy',
            'Component gauges compare Celsius readings with their original ceilings: {{motor}} for front/rear motor, {{inverter}} for inverter and {{battery}} for battery. Warning begins at 65% and critical at 85% of the ceiling.',
            {
              motor: formatTemperature(150),
              inverter: formatTemperature(120),
              battery: formatTemperature(60),
            },
          )}
        </Text>
      </SourceBoundary>
      {/* Independent neighbors remain visible when the health source fails. */}
      <SourceBoundary state={drivesState} label={t('drivetrain.powerSummary', 'Power Summary')}
        empty={false} emptyMessage={t('drivetrain.noData', 'No data')}>
        <StatGroup period={{ kind: 'unknown', label: t('drivetrain.modernization.driveSubset', 'Recent drives within the selected range') }}
          preferences={preferences} metrics={[
            { metricId: 'power', label: t('drivetrain.peakPower', 'Peak Power'), rawValue: power.peakPower },
            { metricId: 'power', label: t('drivetrain.avgPower', 'Avg Power'), rawValue: power.avgPowerMax },
          ]} />
      </SourceBoundary>
      <SourceBoundary state={statsState} label={t('drivetrain.driveStats', 'Drive Statistics')}
        empty={false} emptyMessage={t('drivetrain.noStats', 'No drive statistics available yet')}>
        <KVList items={[
          { label: t('drivetrain.drivesLabel', 'Drives'), value: finite(stats?.totalDrives) != null ? fmtNumber(stats?.totalDrives, 0) : '—' },
          { label: t('drivetrain.regenRatio', 'Regen Ratio'), value: finite(stats?.regenRatio) != null ? `${fmtNumber((stats?.regenRatio ?? 0) * 100)}%` : '—' },
        ]} />
      </SourceBoundary>
      <Text as="p" variant="bodySm">{period.label}</Text>
    </LayoutCard> },
  ]} />;
}
