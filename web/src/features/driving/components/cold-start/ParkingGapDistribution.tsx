import { Clock3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  Cell,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type {
  ParkingGapBucket,
  ParkingGapBucketKey,
} from '../../lib/coldStart';
import type { ColdStartSectionState } from './types';

const BUCKET_COLORS: Record<ParkingGapBucketKey, string> = {
  warm: CHART_COLORS[1],
  ambiguous: CHART_COLORS[3],
  cold6To12: CHART_COLORS[0],
  cold12To24: CHART_COLORS[4],
  cold24Plus: CHART_COLORS[5],
};

interface ParkingGapDistributionProps {
  buckets: ParkingGapBucket[];
  analyzed: number;
  state: ColdStartSectionState;
  className?: string;
}

/** Coverage view showing exactly where warm, ambiguous, and cold gaps land. */
export function ParkingGapDistribution({
  buckets,
  analyzed,
  state,
  className,
}: ParkingGapDistributionProps) {
  const { t } = useTranslation();
  const labels = useMemo<Record<ParkingGapBucketKey, string>>(
    () => ({
      warm: t('coldStart.gaps.warm', '≤1 h · warm'),
      ambiguous: t('coldStart.gaps.ambiguous', '1–6 h · ambiguous'),
      cold6To12: t('coldStart.gaps.cold6To12', '6–12 h · cold'),
      cold12To24: t('coldStart.gaps.cold12To24', '12–24 h · cold'),
      cold24Plus: t('coldStart.gaps.cold24Plus', '24 h+ · cold'),
    }),
    [t],
  );
  const rows = useMemo(
    () =>
      buckets.map((bucket) => ({
        bucket: labels[bucket.key],
        drives: bucket.drives,
        share: Math.round(bucket.share * 1_000) / 10,
        color: BUCKET_COLORS[bucket.key],
      })),
    [buckets, labels],
  );
  const hasData = analyzed > 0;
  const drivesName = t('coldStart.gaps.drives', 'Drives');

  return (
    <section
      className={className}
      aria-label={t('coldStart.sections.gaps', 'Parking-gap classification coverage')}
      data-testid="cold-start-gaps"
    >
      <ChartContainer
        className="h-full"
        title={t('coldStart.gaps.title', 'Parking-gap distribution')}
        subtitle={t(
          'coldStart.gaps.subtitle',
          '{{count}} drives had a known preceding gap in the selected observed window.',
          { count: analyzed },
        )}
        ariaLabel={t(
          'coldStart.gaps.aria',
          'Drive counts split across warm, ambiguous, and three cold parking-gap buckets',
        )}
        loading={state.isLoading}
        height={340}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="cold-start-parking-gaps"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'bucket', label: t('coldStart.gaps.bucket', 'Gap bucket') },
          { key: 'drives', label: drivesName, format: (value) => fmtInt(value) },
          {
            key: 'share',
            label: t('coldStart.gaps.share', 'Share'),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : !hasData ? (
          <EmptyState /* no-action: gap coverage is derived automatically from the selected drive window. */
            className="h-full"
            icon={<Clock3 className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'coldStart.gaps.empty',
              'No usable preceding parking gaps are available to classify in this window.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 12, left: 8, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                type="number"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="bucket"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={112}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      t('coldStart.gaps.driveValue', '{{count}} drives', {
                        count: typeof value === 'number' ? value : 0,
                      })
                    }
                  />
                }
              />
              <Bar dataKey="drives" name={drivesName} radius={[0, 5, 5, 0]} maxBarSize={34}>
                {rows.map((row) => (
                  <Cell key={row.bucket} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </section>
  );
}
