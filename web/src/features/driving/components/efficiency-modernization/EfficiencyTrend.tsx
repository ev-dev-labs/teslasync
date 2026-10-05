import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, renderAnnotationLines, AREA_DEFAULTS, areaGradient,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { EfficiencyChart } from './EfficiencyChart';
import type { DrivesPresentation } from './types';

export function EfficiencyTrend({ model, source, units, selectedVehicleId }: DrivesPresentation & { selectedVehicleId: number | null }) {
  const { t } = useTranslation();
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { dailyTrend } = model;
  return <EfficiencyChart source={source}
    title={t('efficiency.dailyTrend', { unit: efficiencyUnit, defaultValue: 'Daily Efficiency ({{unit}})' })}
    ariaLabel={t('efficiency.dailyTrend.aria', 'Daily efficiency trend area chart')}
    data={dailyTrend.map(d => ({ date: d.date, efficiency: d.efficiency }))}
    dataColumns={[
      { key: 'date', label: t('efficiency.col.date', 'Date') },
      { key: 'efficiency', label: efficiencyUnit },
    ]}
    empty={dailyTrend.length < 3}
    annotations={{ vehicleId: selectedVehicleId, scope: 'efficiency', chartId: 'efficiency-daily-trend' }}>
    {({ annotations: chartAnnotations }) => (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dailyTrend}>
          {areaGradient('effGrad', '#00f0ff')}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip content={<ChartTooltip />} />
          {renderAnnotationLines(chartAnnotations, ts => ts)}
          <Area {...AREA_DEFAULTS} dataKey="efficiency" stroke="#00f0ff" fill="url(#effGrad)" name={efficiencyUnit} />
        </AreaChart>
      </ResponsiveContainer>
    )}
  </EfficiencyChart>;
}
