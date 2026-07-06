import { useMemo } from 'react';
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

  // Null-safe: the drive-detail derivation may hand us `undefined`/`[]` before
  // telemetry resolves, despite the non-optional prop type. Guard once so the
  // `.length` check and the recharts `data` prop never touch a nullish value,
  // and keep a stable reference so <BarChart> isn't fed a fresh array each render.
  const buckets = useMemo(() => speedHistData ?? [], [speedHistData]);
  // Stable, plain-object rows for the screen-reader/forced-colors fallback table.
  const tableData = useMemo(
    () => buckets.map((b) => ({ range: b.range, pct: b.pct })),
    [buckets],
  );

  return (
    <FadeIn className="h-full">
      <ChartContainer
        title={t('driveDetail.speedHistogram', 'Speed Histogram')}
        ariaLabel={t('driveDetail.speedHistogram.aria', 'Speed-bucket distribution histogram')}
        data={tableData}
        dataColumns={[
          { key: 'range', label: t('driveDetail.col.range', 'Speed range') },
          { key: 'pct', label: t('driveDetail.col.pct', '% of drive') },
        ]}
        height={220}
        className="h-full"
      >
        {buckets.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pct" fill="#a855f7" name={`% ${t('driveDetail.ofDrive', 'of drive')}`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div role="status" className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartContainer>
    </FadeIn>
  );
}
