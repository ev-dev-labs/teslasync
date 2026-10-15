import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartTooltip,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { ChartCard } from '@/components/layout';
import { chartTokens } from '@/lib/tokens';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import type { SpeedHistogramBucket } from './types';

interface SpeedHistogramChartProps {
  speedHistData: SpeedHistogramBucket[];
}

export function SpeedHistogramChart({ speedHistData }: SpeedHistogramChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const rangeLabel = `${t('driveDetail.col.range', 'Speed range')} (${speedUnit})`;

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
      <ChartCard
        title={`${t('driveDetail.speedHistogram', 'Speed histogram')} (${speedUnit})`}
        ariaLabel={`${t('driveDetail.speedHistogramAria', 'Speed-bucket distribution histogram')} (${speedUnit})`}
        data={tableData}
        dataColumns={[
          { key: 'range', label: rangeLabel },
          { key: 'pct', label: t('driveDetail.report.sampleShare', '% of speed samples') },
        ]}
        height={220}
        mobileHeight={220}
        toolbar
        exportable
        empty={buckets.length === 0}
        emptyMessage={t('driveDetail.noChartData', 'No telemetry data available')}
      >
        {buckets.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
              <XAxis dataKey="range" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} height={50} label={{ value: rangeLabel, position: 'insideBottom', fill: chartTokens.axisStroke }} />
              <YAxis domain={[0, 100]} tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pct" fill={chartTokens.series[0]} name={t('driveDetail.report.sampleShare', '% of speed samples')} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div role="status" className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
            <Text variant="caption">{t('driveDetail.noChartData', 'No telemetry data available')}</Text>
          </div>
        )}
      </ChartCard>
    </FadeIn>
  );
}
