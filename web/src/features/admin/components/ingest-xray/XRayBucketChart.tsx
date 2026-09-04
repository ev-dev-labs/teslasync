/**
 * Ingest X-Ray — bucketed sample-count chart.
 *
 * Bar chart of `count` per `bucket_start` time bucket. Rendered through
 * the shared `<ChartContainer>` so it picks up exportable PNG, CSV
 * download, fullscreen toggle, a11y fallback table, and the standard
 * loading / empty states for free.
 *
 * No direct `recharts` import — the shared charts barrel re-exports
 * BarChart/Bar/XAxis/YAxis/CartesianGrid/Tooltip/ResponsiveContainer.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BarChart,
  Bar,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartAnimationProps,
  chartGrid,
  chartMargin,
} from '@/components/charts';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { IngestXRayBucketPoint } from '@/types/admin-diagnostics';

interface XRayBucketChartProps {
  buckets: IngestXRayBucketPoint[];
  loading: boolean;
}

export function XRayBucketChart({ buckets, loading }: XRayBucketChartProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();

  // Pre-derive a numeric epoch so the X axis can sort + format cheaply
  // without re-parsing the ISO string on every tick.
  const series = useMemo(
    () =>
      (buckets ?? []).map((b) => ({
        ts: Date.parse(b.bucket_start),
        bucket_start: b.bucket_start,
        count: b.count,
      })),
    [buckets],
  );

  // Rows shared by the screen-reader / forced-colors fallback table AND the
  // CSV export. Memoised so the container receives a stable array identity and
  // doesn't redo its table/export bookkeeping on unrelated re-renders.
  const tableData = useMemo(
    () => series.map((s) => ({ bucket: s.bucket_start, count: s.count })),
    [series],
  );

  // Fallback table mirrors the visible chart: the bucket column renders the
  // SAME localized time the X axis shows (not the raw ISO string), and counts
  // use the same thousands-separated integer format. A null count surfaces as
  // an em dash so a sparse series never masks a gap.
  const dataColumns = useMemo(
    () => [
      {
        key: 'bucket',
        label: t('admin.xray.chart.cols.bucket', 'Bucket'),
        format: (v: unknown) => (typeof v === 'string' ? formatTime(v) : '—'),
      },
      {
        key: 'count',
        label: t('admin.xray.chart.cols.count', 'Samples'),
        format: (v: unknown) => (typeof v === 'number' ? fmtInt(v) : '—'),
      },
    ],
    [t, formatTime],
  );

  const isEmpty = !loading && series.length === 0;

  return (
    <ChartContainer
      title={t('admin.xray.chart.title', 'Samples per bucket')}
      subtitle={t(
        'admin.xray.chart.subtitle',
        'Time-series of ingested telemetry rows over the selected window.',
      )}
      ariaLabel={t(
        'admin.xray.chart.ariaLabel',
        'Bar chart of ingest sample counts per time bucket.',
      )}
      loading={loading}
      empty={isEmpty}
      height={300}
      data={tableData}
      dataColumns={dataColumns}
      exportable
      exportData={tableData}
      exportFilename="ingest-xray-buckets"
      fullscreen
    >
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={series} margin={chartMargin}>
          {chartGrid}
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => (Number.isFinite(v) ? formatTime(new Date(v)) : '—')}
            tick={axisTick}
          />
          <YAxis tick={axisTick} allowDecimals={false} />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={(v) =>
                  typeof v === 'number' && Number.isFinite(v)
                    ? formatTime(new Date(v))
                    : '—'
                }
                valueFormatter={(v) => fmtInt(v)}
              />
            }
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar
            dataKey="count"
            name={t('admin.xray.chart.tooltip', 'Samples')}
            fill={chartTokens.series[0]}
            radius={[4, 4, 0, 0]}
            {...chartAnimationProps()}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
