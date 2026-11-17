import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  EmbeddedChart,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { LayoutCard } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyDeviationDistributionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

function Quantile({ label, value }: { label: string; value: string }) {
  return (
    <div data-app-part="metric" data-app-metric="tile" data-surface-variant="standalone" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel data-app-part="metric-label">{label}</MetricLabel>
      <div data-app-part="metric-reading" className="mt-1">
        <Text data-app-part="metric-value" as="p" variant="body">{value}</Text>
      </div>
    </div>
  );
}

export function ComfortConsistencyDeviationDistribution({
  summary,
  state,
  formatDelta,
}: ComfortConsistencyDeviationDistributionProps) {
  const { t } = useTranslation();
  const data = summary.deviationDistribution.map((bin) => ({
    band:
      bin.upperC == null
        ? t('preconditioningEffectiveness.distribution.atLeast', 'At least {{lower}}', {
            lower: formatDelta(bin.lowerC),
          })
        : t('comfortConsistency.deviation.range', '{{lower}}-{{upper}}', {
            lower: formatDelta(bin.lowerC),
            upper: formatDelta(bin.upperC),
          }),
    samples: bin.samples,
  }));

  return (
    <section data-testid="comfort-consistency-deviation-distribution">
      <LayoutCard title={t('comfortConsistency.deviation.title', 'Absolute deviation distribution')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.deviation.subtitle',
            'Active-HVAC sample counts by absolute cabin-to-mean-setpoint difference; sample cadence can bias this view.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="samples"
          skeletonHeight={320}
        >
          <EmbeddedChart toolbar exportable size="standard"
            title={t('comfortConsistency.deviation.plotTitle', 'Active samples by deviation band')}
            ariaLabel={t(
              'comfortConsistency.deviation.aria',
              'Bar chart of active HVAC samples grouped by absolute cabin temperature deviation',
            )}
            height={300}
            data={data}
            dataColumns={[
              { key: 'band', label: t('comfortConsistency.deviation.band', 'Deviation band') },
              { key: 'samples', label: t('comfortConsistency.deviation.samples', 'Samples') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis
                  dataKey="band"
                  tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 11 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="samples"
                  name={t('comfortConsistency.deviation.samples', 'Samples')}
                  fill={chartTokens.series[4]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
          <div data-app-part="metric-grid" className="mt-4 grid min-w-0 grid-cols-2 items-stretch gap-3 xl:grid-cols-4 [&>*]:min-w-0">
            <Quantile
              label={t('comfortConsistency.deviation.mean', 'Sample mean')}
              value={formatDelta(summary.meanAbsDeviationC)}
            />
            <Quantile
              label={t('comfortConsistency.deviation.median', 'Sample median')}
              value={formatDelta(summary.medianAbsDeviationC)}
            />
            <Quantile
              label={t('comfortConsistency.deviation.p90', 'Sample P90')}
              value={formatDelta(summary.p90AbsDeviationC)}
            />
            <Quantile
              label={t('comfortConsistency.deviation.weighted', 'Duration-weighted mean')}
              value={formatDelta(summary.durationWeightedMeanAbsDeviationC)}
            />
          </div>
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
