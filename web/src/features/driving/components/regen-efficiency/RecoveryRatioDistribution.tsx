import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
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
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import type {
  RegenEfficiencyModel,
  RegenRatioBucketKey,
} from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import type { RegenSectionState } from './types';

interface RecoveryRatioDistributionProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function RecoveryRatioDistribution({
  model,
  state,
}: RecoveryRatioDistributionProps) {
  const { t } = useTranslation();
  const bucketLabel = (key: RegenRatioBucketKey): string => {
    switch (key) {
      case 'below5':
        return t('regen.distribution.below5', '<5%');
      case 'from5To10':
        return t('regen.distribution.from5To10', '5–<10%');
      case 'from10To15':
        return t('regen.distribution.from10To15', '10–<15%');
      case 'from15To20':
        return t('regen.distribution.from15To20', '15–<20%');
      case 'from20To30':
        return t('regen.distribution.from20To30', '20–<30%');
      case 'from30':
        return t('regen.distribution.from30', '30%+');
    }
  };
  const rows = model.ratioDistribution.map((bucket) => ({
    bucket: bucketLabel(bucket.key),
    drives: bucket.eligibleCount,
    share: bucket.eligibleSharePct,
  }));
  const hasData =
    state.isResolved && model.accounting.eligibleCount > 0;
  const ariaDescription = state.isLoading
    ? t('regen.states.detailLoading', 'Detailed query loading.')
    : state.error
      ? t('regen.states.detailUnavailable', 'Detailed query unavailable.')
      : !state.isResolved
        ? t(
            'regen.states.detailPending',
            'Detailed data availability has not resolved.',
          )
        : t(
            'regen.distribution.summary',
            'Median {{median}} with an interquartile range from {{q1}} to {{q3}}.',
            {
              median:
                model.ratioStatistics.medianPct != null
                  ? fmtPercent(model.ratioStatistics.medianPct, 1)
                  : '—',
              q1:
                model.ratioStatistics.q1Pct != null
                  ? fmtPercent(model.ratioStatistics.q1Pct, 1)
                  : '—',
              q3:
                model.ratioStatistics.q3Pct != null
                  ? fmtPercent(model.ratioStatistics.q3Pct, 1)
                  : '—',
            },
          );

  return (
    <section
      aria-label={t(
        'regen.distribution.sectionAria',
        'Per-drive recovery-ratio distribution',
      )}
      data-testid="regen-distribution"
    >
      <ChartContainer
        title={t(
          'regen.distribution.title',
          'Recovery-ratio distribution',
        )}
        subtitle={t(
          'regen.distribution.subtitle',
          'Eligible detailed drives grouped by measured recovered energy ÷ drive energy.',
        )}
        ariaLabel={t(
          'regen.distribution.aria',
          'Counts of eligible detailed drives across six recovery-ratio buckets',
        )}
        ariaDescription={ariaDescription}
        loading={state.isLoading}
        height={300}
        exportable={state.isResolved && hasData}
        exportFilename="regen-ratio-distribution"
        data={state.isResolved ? rows : []}
        dataColumns={[
          {
            key: 'bucket',
            label: t('regen.distribution.bucket', 'Recovery bucket'),
          },
          {
            key: 'drives',
            label: t('regen.distribution.drives', 'Eligible drives'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'share',
            label: t('regen.distribution.share', 'Eligible share'),
            format: (value) => fmtPercent(value, 1),
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : !state.isResolved ? (
          <EmptyState
            className="h-full"
            icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'regen.states.detailPending',
              'Detailed data availability has not resolved.',
            )}
          />
        ) : !hasData ? (
          <EmptyState /* no-action: distribution requires eligible returned drives. */
            className="h-full"
            icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'regen.distribution.empty',
              'No eligible per-drive ratios are available for a distribution.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                dataKey="bucket"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      t(
                        'regen.distribution.driveValue',
                        '{{count}} eligible drives',
                        { count: typeof value === 'number' ? value : 0 },
                      )
                    }
                  />
                }
              />
              <Bar
                dataKey="drives"
                name={t(
                  'regen.distribution.driveSeries',
                  'Eligible detailed drives',
                )}
                fill={CHART_COLORS[5]}
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
      {state.isResolved ? (
        <DetailScopeNotice
          className="mt-3"
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        />
      ) : null}
    </section>
  );
}
