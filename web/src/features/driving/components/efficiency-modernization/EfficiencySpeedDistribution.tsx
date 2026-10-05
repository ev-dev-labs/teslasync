import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from '@/components/charts';
import { EfficiencyChart } from './EfficiencyChart';
import { efficiencyColor } from './model';
import type { DrivesPresentation } from './types';

export function EfficiencySpeedDistribution({ model, source, units }: DrivesPresentation) {
  const { t } = useTranslation();
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { speedDist } = model;
  return <EfficiencyChart source={source}
    title={t('efficiency.speedDist', 'Efficiency by speed range')}
    ariaLabel={t('efficiency.speedDist.aria', 'Efficiency by speed-range bar chart')}
    data={speedDist.map(b => ({ range: b.range, avgEff: b.avgEff }))}
    dataColumns={[
      { key: 'range', label: t('efficiency.col.range', 'Speed range') },
      { key: 'avgEff', label: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}` },
    ]}
    empty={speedDist.length === 0}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={speedDist}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
        <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="avgEff" name={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`} radius={[4, 4, 0, 0]}>
          {speedDist.map((entry, i) => <Cell key={i} fill={efficiencyColor(entry.avgEff)} fillOpacity={0.7} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </EfficiencyChart>;
}
