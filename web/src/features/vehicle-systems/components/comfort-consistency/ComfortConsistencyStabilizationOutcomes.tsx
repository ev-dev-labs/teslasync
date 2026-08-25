import { TimerReset } from 'lucide-react';
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
import { EmptyState } from '@/components/feedback';
import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyStabilizationOutcomesProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function OutcomeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function ComfortConsistencyStabilizationOutcomes({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyStabilizationOutcomesProps) {
  const { t } = useTranslation();
  const data = summary.overshootDistribution.map((bin) => ({
    band:
      bin.upperC == null
        ? t('comfortConsistency.stabilization.over', '> {{value}}', {
            value: formatDelta(bin.lowerC, { precision: 2 }),
          })
        : t('comfortConsistency.stabilization.range', '{{lower}}-{{upper}}', {
            lower: formatDelta(bin.lowerC, { precision: 2 }),
            upper: formatDelta(bin.upperC, { precision: 2 }),
          }),
    windows: bin.windows,
  }));

  return (
    <section data-testid="comfort-consistency-stabilization-outcomes">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <TimerReset className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.stabilization.title', 'Stabilization and overshoot outcomes')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.stabilization.subtitle',
            'Only active fragments whose first observed sample is outside the comfort band enter the stabilization denominator.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="runs"
          skeletonHeight={360}
        >
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.fragments', 'Active fragments')}
              value={fmtInt(summary.activeRunCount)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.inBandStarts', 'In-band-first fragments')}
              value={fmtInt(summary.insideBandStartRuns)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.candidates', 'Outside-band fragments')}
              value={fmtInt(summary.stabilizationWindows.length)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.hotCold', 'Hot / cold fragments')}
              value={`${fmtInt(summary.hotStartWindows)} / ${fmtInt(summary.coldStartWindows)}`}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.stabilized', 'Sustained-band observed')}
              value={fmtInt(summary.stabilizedWindows)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.notObserved', 'Not observed stabilized')}
              value={fmtInt(summary.unstabilizedWindows)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.censoredUnstabilized', 'Censored without stabilization')}
              value={fmtInt(summary.censoredUnstabilizedWindows)}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.medianTime', 'Median observed time to band')}
              value={formatDuration(summary.medianStabilizationS, { precision: 2 })}
            />
            <OutcomeMetric
              label={t('comfortConsistency.stabilization.medianOvershoot', 'Median observed overshoot')}
              value={formatDelta(summary.medianOvershootC)}
            />
          </Grid>
          {summary.stabilizationWindows.length === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="mt-4 py-5"
              icon={<TimerReset className="h-7 w-7" aria-hidden="true" />}
              message={t(
                'comfortConsistency.stabilization.empty',
                'No active fragment began outside the configured comfort band.',
              )}
            />
          ) : (
            <ChartContainer
              className="mt-4"
              title={t('comfortConsistency.stabilization.plotTitle', 'Observed overshoot distribution')}
              ariaLabel={t(
                'comfortConsistency.stabilization.aria',
                'Bar chart of outside-band fragments grouped by observed opposite-side overshoot',
              )}
              height={280}
              data={data}
              dataColumns={[
                { key: 'band', label: t('comfortConsistency.stabilization.band', 'Overshoot band') },
                { key: 'windows', label: t('comfortConsistency.stabilization.windows', 'Windows') },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                  <XAxis dataKey="band" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="windows"
                    name={t('comfortConsistency.stabilization.windows', 'Windows')}
                    fill={chartTokens.series[2]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
