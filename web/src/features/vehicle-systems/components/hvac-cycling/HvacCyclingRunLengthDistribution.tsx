import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
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
        value: formatDuration(bin.lowerS, { precision: 2 }),
      });
    }
    if (bin.lowerS === 0) {
      return t('hvacCycling.distribution.upTo', '≤ {{value}}', {
        value: formatDuration(bin.upperS, { precision: 2 }),
      });
    }
    return t('hvacCycling.distribution.range', '{{lower}}–{{upper}}', {
      lower: formatDuration(bin.lowerS, { precision: 2 }),
      upper: formatDuration(bin.upperS, { precision: 2 }),
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BarChart3
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('hvacCycling.distribution.title', 'Run-length distribution')}
        </PanelTitle>
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
          <ChartContainer
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
          </ChartContainer>
          <Grid cols={{ default: 2, md: 4 }} gap={2} className="mt-3">
            <Quantile label={t('hvacCycling.distribution.onP25', 'On fragment P25')} value={formatDuration(on.p25S, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.onMedian', 'On fragment median')} value={formatDuration(on.medianS, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.onP90', 'On fragment P90')} value={formatDuration(on.p90S, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.onMax', 'Longest on fragment')} value={formatDuration(on.maxS, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.offP25', 'Off fragment P25')} value={formatDuration(off.p25S, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.offMedian', 'Off fragment median')} value={formatDuration(off.medianS, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.offP90', 'Off fragment P90')} value={formatDuration(off.p90S, { precision: 1 })} />
            <Quantile label={t('hvacCycling.distribution.offMax', 'Longest off fragment')} value={formatDuration(off.maxS, { precision: 1 })} />
          </Grid>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
