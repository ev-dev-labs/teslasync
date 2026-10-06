import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { EfficiencyChart } from './EfficiencyChart';
import type { DrivesPresentation } from './types';

/** Two original, independent scatter identities; no combined or synthesized series. */
export function EfficiencyScatter({ model, source, units, kind }: DrivesPresentation & { kind: 'speed' | 'temperature' }) {
  const { t } = useTranslation();
  const isSpeed = kind === 'speed';
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const data = isSpeed ? model.speedVsEff : model.tempVsEff;
  const title = isSpeed ? t('efficiency.speedVsEfficiency', 'Speed vs efficiency')
    : t('efficiency.tempVsEfficiency', 'Temperature vs efficiency');
  return <EfficiencyChart source={source} title={title}
    ariaLabel={isSpeed ? t('efficiency.speedVsEfficiency.aria', 'Speed versus efficiency scatter plot')
      : t('efficiency.tempVsEfficiency.aria', 'Temperature versus efficiency scatter plot')}
    data={data}
    dataColumns={[
      isSpeed
        ? { key: 'speed', label: t('efficiency.chartColumns.driveSpeed', 'Average drive speed ({{unit}})', { unit: units.unitPrefs.speed }), kind: 'measurement' }
        : { key: 'temp', label: t('efficiency.chartColumns.driveTemperature', 'Average outside temperature ({{unit}})', { unit: units.unitPrefs.temperature }), kind: 'measurement' },
      { key: 'efficiency', label: t('efficiency.chartColumns.driveEfficiency', 'Drive energy consumption ({{unit}})', { unit: efficiencyUnit }), kind: 'measurement' },
    ]}
    empty={data.length < 4}>
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
        <XAxis dataKey={isSpeed ? 'speed' : 'temp'}
          name={isSpeed ? t('efficiency.speed', 'Speed') : t('efficiency.temp', 'Temp')}
          unit={` ${isSpeed ? units.unitPrefs.speed : units.unitPrefs.temperature}`}
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`}
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <Tooltip content={<ChartTooltip />} />
        <Scatter data={data} fill={isSpeed ? '#f59e0b' : '#a855f7'} fillOpacity={0.6} />
      </ScatterChart>
    </ResponsiveContainer>
  </EfficiencyChart>;
}
