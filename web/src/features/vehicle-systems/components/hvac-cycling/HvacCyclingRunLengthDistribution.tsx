import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  EmbeddedChart,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { LayoutCard, Grid } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';
import type {
  HvacCyclingSummary,
  HvacRunLengthBin,
} from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingRunLengthDistributionProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

function Quantile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" className="mt-1">{value}</Text>
    </div>
  );
}

export function HvacCyclingRunLengthDistribution({
  summary,
  state,
  formatDuration,
}: HvacCyclingRunLengthDistributionProps) {
  const { t } = useTranslation();
  const binLabel = (bin: HvacRunLengthBin) => {
    if (bin.upperS == null) {
      return t('hvacCycling.distribution.over', '> {{value}}', {
        value: formatDuration(bin.lowerS),
      });
    }
    if (bin.lowerS === 0) {
      return t('hvacCycling.distribution.upTo', '≤ {{value}}', {
        value: formatDuration(bin.upperS),
      });
    }
    return t('hvacCycling.distribution.range', '{{lower}}–{{upper}}', {
      lower: formatDuration(bin.lowerS),
      upper: formatDuration(bin.upperS),
    });
  };
  const data = summary.runLengthDistribution.map((bin) => ({
    band: binLabel(bin),
    on: bin.onRuns,
    off: bin.offRuns,
    completeOn: bin.completeOnRuns,
  }));
  const on = summary.onRunQuantiles;
  const off = summary.offRunQuantiles;

  return (
    <section data-testid="hvac-cycling-run-distribution">
      <LayoutCard title={t('hvacCycling.distribution.title', 'Run-length distribution')}>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'hvacCycling.distribution.subtitle',
            'Observed run fragments by duration and state; quantiles include partial support and are labeled accordingly.',
          )}
        </Text>
        <HvacCyclingSectionBody
          summary={summary}
          state={state}
          requirement="runs"
          skeletonHeight={220}
        >
          <EmbeddedChart toolbar exportable size="standard"
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('hvacCycling.distribution.plotTitle', 'Run fragments by duration band')}
            ariaLabel={t(
              'hvacCycling.distribution.aria',
              'Grouped bar chart of observed on and off run fragments by duration band',
            )}
            height={220}
            chartKey="hvac-cycling-run-length"
            data={data}
            dataColumns={[
              { key: 'band', label: t('hvacCycling.distribution.band', 'Duration band') },
              { key: 'on', label: t('hvacCycling.distribution.on', 'On fragments') },
              { key: 'off', label: t('hvacCycling.distribution.off', 'Off fragments') },
              { key: 'completeOn', label: t('hvacCycling.distribution.complete', 'Complete on runs') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                <XAxis dataKey="band" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar
                  dataKey="on"
                  name={t('hvacCycling.distribution.on', 'On fragments')}
                  fill={chartTokens.series[0]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('on')}
                />
                <Bar
                  dataKey="off"
                  name={t('hvacCycling.distribution.off', 'Off fragments')}
                  fill={chartTokens.series[3]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('off')}
                />
                </BarChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
          <Grid cols={{ default: 2, md: 4 }} gap={2} className="mt-3">
            <Quantile label={t('hvacCycling.distribution.onP25', 'On fragment P25')} value={formatDuration(on.p25S)} />
            <Quantile label={t('hvacCycling.distribution.onMedian', 'On fragment median')} value={formatDuration(on.medianS)} />
            <Quantile label={t('hvacCycling.distribution.onP90', 'On fragment P90')} value={formatDuration(on.p90S)} />
            <Quantile label={t('hvacCycling.distribution.onMax', 'Longest on fragment')} value={formatDuration(on.maxS)} />
            <Quantile label={t('hvacCycling.distribution.offP25', 'Off fragment P25')} value={formatDuration(off.p25S)} />
            <Quantile label={t('hvacCycling.distribution.offMedian', 'Off fragment median')} value={formatDuration(off.medianS)} />
            <Quantile label={t('hvacCycling.distribution.offP90', 'Off fragment P90')} value={formatDuration(off.p90S)} />
            <Quantile label={t('hvacCycling.distribution.offMax', 'Longest off fragment')} value={formatDuration(off.maxS)} />
          </Grid>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
