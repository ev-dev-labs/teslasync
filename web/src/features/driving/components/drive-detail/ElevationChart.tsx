import { useTranslation } from 'react-i18next';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Area, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';

interface ElevationChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function ElevationChart({ chartData, stats }: ElevationChartProps) {
  const { t } = useTranslation();
  const { speedUnit } = useSettings();

  return (
    <FadeIn>
      <ChartContainer title={t('driveDetail.elevProfile', 'Elevation Profile')} height={220}>
        {chartData.length > 1 ? (
          <>
            <div className="flex items-center gap-4 mb-2 text-xs">
              <span className="flex items-center gap-1 text-green-400"><ArrowUpRight className="h-3 w-3" />{fmtNumber(stats.elevGain)} m {t('driveDetail.gain', 'gain')}</span>
              <span className="flex items-center gap-1 text-red-400"><ArrowDownRight className="h-3 w-3" />{fmtNumber(stats.elevLoss)} m {t('driveDetail.loss', 'loss')}</span>
              <span className="text-[var(--text-muted)]">{t('driveDetail.net', 'Net')}: {fmtNumber(stats.elevGain - stats.elevLoss)} m</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="elev" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis yAxisId="speed" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} name={`${t('driveDetail.elevation', 'Elevation')} (m)`} />
                <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="#a855f7" strokeWidth={1.5} dot={false} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} strokeOpacity={0.6} />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartContainer>
    </FadeIn>
  );
}
