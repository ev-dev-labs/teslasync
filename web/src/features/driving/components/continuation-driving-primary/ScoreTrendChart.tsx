import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout';
import {
  ChartLegend, ChartTooltip, AREA_DEFAULTS, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, renderAnnotationLines,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { COLOR } from '@/lib/colors';

interface ScoreTrendPoint {
  date: string;
  score: number;
  efficiency: number;
  smoothness: number;
  speed: number;
}

interface ScoreTrendChartProps {
  data: ScoreTrendPoint[];
  vehicleId: number | null;
  scoreColor: string;
  colors: { efficiency: string; smoothness: string; speed: string };
}

export function ScoreTrendChart({ data, vehicleId, scoreColor, colors }: ScoreTrendChartProps) {
  const { t } = useTranslation();
  return (
    <ChartCard
      title={t('driveScore.scoreTrend', 'Score Trend')}
      ariaLabel={t('driveScore.scoreTrend.aria', 'Drive score trend line chart with category breakdowns')}
      data={data.map(({ date, score, efficiency, smoothness, speed }) => ({
        date, score, efficiency, smoothness, speed,
      }))}
      dataColumns={[
        { key: 'date', label: t('driveScore.col.date', 'Date') },
        { key: 'score', label: t('driveScore.col.score', 'Score') },
        { key: 'efficiency', label: t('driveScore.col.efficiency', 'Efficiency') },
        { key: 'smoothness', label: t('driveScore.col.smoothness', 'Smoothness') },
        { key: 'speed', label: t('driveScore.col.speed', 'Speed') },
      ]}
      size="standard"
      toolbar
      exportable
      height={300}
      annotations={{ vehicleId, scope: 'efficiency', chartId: 'drive-score-trend' }}
      chartKey="drive-score-trend"
    >
      {({ annotations, hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
            <XAxis dataKey="date" stroke={chartTokens.axisStroke} fontSize={12} />
            <YAxis domain={[0, 100]} stroke={chartTokens.axisStroke} fontSize={12} />
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend state={hiddenSeries ?? undefined} />
            <ReferenceLine y={80} stroke={COLOR.GOOD} strokeDasharray="4 4"
              label={{ value: t('driveScore.gradeALine', 'A'), fill: COLOR.GOOD, fontSize: 11 }} />
            {renderAnnotationLines(annotations, (ts) => ts)}
            <Line {...AREA_DEFAULTS} dataKey="score" name={t('driveScore.totalScore', 'Total Score')}
              stroke={scoreColor} dot={{ r: 3, fill: scoreColor }} activeDot={{ r: 5 }}
              hide={hiddenSeries?.isHidden('score')} />
            <Line {...AREA_DEFAULTS} dataKey="efficiency" name={t('driveScore.efficiency', 'Efficiency')}
              stroke={colors.efficiency} strokeWidth={1} strokeDasharray="4 2"
              hide={hiddenSeries?.isHidden('efficiency')} />
            <Line {...AREA_DEFAULTS} dataKey="smoothness" name={t('driveScore.smoothness', 'Smoothness')}
              stroke={colors.smoothness} strokeWidth={1} strokeDasharray="4 2"
              hide={hiddenSeries?.isHidden('smoothness')} />
            <Line {...AREA_DEFAULTS} dataKey="speed" name={t('driveScore.speedDiscipline', 'Speed Discipline')}
              stroke={colors.speed} strokeWidth={1} strokeDasharray="4 2"
              hide={hiddenSeries?.isHidden('speed')} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
