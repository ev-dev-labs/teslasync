import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ChartTooltip,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';

interface ScoreDistributionDatum {
  range: string;
  count: number;
  color: string;
}

export function ScoreDistributionChart({ data }: { data: ScoreDistributionDatum[] }) {
  const { t } = useTranslation();
  return (
    <ChartCard
      title={t('driveScore.scoreDistribution', 'Score Distribution')}
      ariaLabel={t('driveScore.scoreDistribution.aria', 'Drive score distribution histogram bar chart')}
      data={data.map(({ range, count }) => ({ range, count }))}
      dataColumns={[
        { key: 'range', label: t('driveScore.col.range', 'Score range') },
        { key: 'count', label: t('driveScore.col.drives', 'Drives') },
      ]}
      size="standard"
      toolbar
      exportable
      height={240}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} vertical={false} />
          <XAxis dataKey="range" tick={{ fontSize: 11, fill: chartTokens.axisStroke }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: chartTokens.axisStroke }} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="count" name={t('driveScore.drives', 'Drives')} radius={[6, 6, 0, 0]}>
            {data.map((entry) => <Cell key={entry.range} fill={entry.color} fillOpacity={0.8} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
