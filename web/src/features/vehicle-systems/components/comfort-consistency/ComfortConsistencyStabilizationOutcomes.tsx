import { TimerReset } from 'lucide-react';
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
import { EmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import { chartTokens } from '@/lib/tokens';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencyStabilizationOutcomesProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencyStabilizationOutcomes({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyStabilizationOutcomesProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const data = summary.overshootDistribution.map((bin) => ({
    band:
      bin.upperC == null
        ? t('comfortConsistency.stabilization.over', '> {{value}}', {
            value: formatDelta(bin.lowerC),
          })
        : t('comfortConsistency.stabilization.range', '{{lower}}-{{upper}}', {
            lower: formatDelta(bin.lowerC),
            upper: formatDelta(bin.upperC),
          }),
    windows: bin.windows,
  }));

  return (
    <section data-testid="comfort-consistency-stabilization-outcomes">
      <LayoutCard title={t('comfortConsistency.stabilization.title', 'Stabilization and overshoot outcomes')}>
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
          <VehicleOperationalBrief embedded id="comfort-consistency-stabilization-summary"
            title={t('comfortConsistency.stabilization.title', 'Stabilization and overshoot outcomes')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.stabilization.subtitle', 'Only active fragments whose first observed sample is outside the comfort band enter the stabilization denominator.') }}
            metrics={[
              ...[
                { key: 'fragments', label: t('comfortConsistency.stabilization.fragments', 'Active fragments'), value: summary.activeRunCount },
                { key: 'in-band', label: t('comfortConsistency.stabilization.inBandStarts', 'In-band-first fragments'), value: summary.insideBandStartRuns },
                { key: 'outside', label: t('comfortConsistency.stabilization.candidates', 'Outside-band fragments'), value: summary.stabilizationWindows.length },
                { key: 'stabilized', label: t('comfortConsistency.stabilization.stabilized', 'Sustained-band observed'), value: summary.stabilizedWindows },
                { key: 'not-observed', label: t('comfortConsistency.stabilization.notObserved', 'Not observed stabilized'), value: summary.unstabilizedWindows },
                { key: 'censored', label: t('comfortConsistency.stabilization.censoredUnstabilized', 'Censored without stabilization'), value: summary.censoredUnstabilizedWindows },
              ].map(fact => ({
                metricId: 'count' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) },
              })),
              { metricId: 'count', occurrenceId: 'hot-cold', label: t('comfortConsistency.stabilization.hotCold', 'Hot / cold fragments'), rawValue: summary.hotStartWindows,
                display: { formatter: raw => ({ value: `${fmtInt(raw)} / ${fmtInt(summary.coldStartWindows)}`, unit: '' }) } },
              { metricId: 'duration', occurrenceId: 'median-time', label: t('comfortConsistency.stabilization.medianTime', 'Median observed time to band'), rawValue: summary.medianStabilizationS,
                display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
              { metricId: 'number', occurrenceId: 'median-overshoot', label: t('comfortConsistency.stabilization.medianOvershoot', 'Median observed overshoot'), rawValue: summary.medianOvershootC,
                display: { formatter: raw => ({ value: formatDelta(raw), unit: '' }) } },
            ]}
          />
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
            <EmbeddedChart toolbar exportable size="standard"
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
            </EmbeddedChart>
          )}
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
