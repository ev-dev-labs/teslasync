import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ChartTooltip,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';

interface ScoreCategoryDatum {
  name: string;
  value: number | null;
  max: number;
  fill: string;
}

export function ScoreCategoryChart({ data }: { data: ScoreCategoryDatum[] }) {
  const { t } = useTranslation();
  return (
    // chart-legend-audit:skip maximum bars are fixed category-capacity backdrops, not independently meaningful series
    <ChartCard
      title={t('driveScore.categoryBreakdown', 'Category Breakdown')}
      ariaLabel={t('driveScore.categoryBreakdown.aria', 'Drive score category breakdown horizontal bar chart')}
      data={data.map(({ name, value, max }) => ({ name, value, max }))}
      dataColumns={[
        { key: 'name', label: t('driveScore.col.category', 'Category') },
        { key: 'value', label: t('driveScore.col.value', 'Value') },
        { key: 'max', label: t('driveScore.col.max', 'Max') },
      ]}
      size="standard"
      toolbar
      exportable
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
          <XAxis type="number" domain={[0, 40]} stroke={chartTokens.axisStroke} fontSize={12} />
          <YAxis type="category" dataKey="name" width={110} stroke={chartTokens.axisStroke} fontSize={12} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
            {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Bar>
          <Bar dataKey="max" radius={[0, 6, 6, 0]} barSize={24} fill="#1e293b" opacity={0.3} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
