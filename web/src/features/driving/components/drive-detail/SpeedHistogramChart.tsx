import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import type { SpeedHistogramBucket } from './types';

interface SpeedHistogramChartProps {
  speedHistData: SpeedHistogramBucket[];
}

export function SpeedHistogramChart({ speedHistData }: SpeedHistogramChartProps) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <ChartContainer
        title={t('driveDetail.speedHistogram', 'Speed Histogram')}
        ariaLabel={t('driveDetail.speedHistogram.aria', 'Speed-bucket distribution histogram')}
        data={speedHistData.map((b) => ({ range: b.range, pct: b.pct }))}
        dataColumns={[
          { key: 'range', label: t('driveDetail.col.range', 'Speed range') },
          { key: 'pct', label: t('driveDetail.col.pct', '% of drive') },
        ]}
        height={220}
      >
        {speedHistData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={speedHistData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pct" fill="#a855f7" name={`% ${t('driveDetail.ofDrive', 'of drive')}`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
