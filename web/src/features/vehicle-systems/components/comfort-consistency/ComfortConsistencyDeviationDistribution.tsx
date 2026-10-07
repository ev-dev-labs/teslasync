import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
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
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
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
        ? t('comfortConsistency.deviation.over', '> {{value}}', {
            value: formatDelta(bin.lowerC, { precision: 2 }),
          })
        : t('comfortConsistency.deviation.range', '{{lower}}-{{upper}}', {
            lower: formatDelta(bin.lowerC, { precision: 2 }),
            upper: formatDelta(bin.upperC, { precision: 2 }),
          }),
    samples: bin.samples,
  }));

  return (
    <section data-testid="comfort-consistency-deviation-distribution">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BarChart3
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('comfortConsistency.deviation.title', 'Absolute deviation distribution')}
        </PanelTitle>
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
          <ChartContainer
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
          </ChartContainer>
          <Grid cols={{ default: 2, xl: 4 }} gap={3} className="mt-4">
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
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
