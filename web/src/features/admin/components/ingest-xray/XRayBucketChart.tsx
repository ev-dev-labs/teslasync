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
  CartesianGrid,
  ChartContainer,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  chartMargin,
} from '@/components/charts';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtInt } from '@/lib/numberFormat';
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
      height={260}
      data={series.map((s) => ({ bucket: s.bucket_start, count: s.count }))}
      dataColumns={[
        { key: 'bucket', label: t('admin.xray.chart.cols.bucket', 'Bucket') },
        {
          key: 'count',
          label: t('admin.xray.chart.cols.count', 'Samples'),
          format: (v) => (typeof v === 'number' ? fmtInt(v) : '—'),
        },
      ]}
      exportable
      exportFilename="ingest-xray-buckets"
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={series} margin={chartMargin}>
          <CartesianGrid {...chartGrid} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => formatTime(new Date(v))}
            tick={axisTick}
          />
          <YAxis tick={axisTick} allowDecimals={false} />
          <Tooltip
            labelFormatter={(v: number) => formatTime(new Date(v))}
            formatter={(v: number) => [fmtInt(v), t('admin.xray.chart.tooltip', 'Samples')]}
          />
          <Bar dataKey="count" fill="var(--accent-primary)" />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
